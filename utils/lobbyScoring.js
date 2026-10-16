const defaultBuilders = require('discord-buttons');
const {
  readTemplate, extractTemplate, scoreRace, rankGroups, ordinal,
} = require('./scoreTable');

// Same team order as generateTemplate's blue, red, green and yellow colors.
const teamMarkers = ['🟦', '🟥', '🟩', '🟨'];

// Inject Discord/database boundaries so every flow can be exercised offline.
function createLobbyScoring({
  Lobby, Room, Player, drawTable, withRoomLock, pointsFor,
  builders = defaultBuilders, log = console.error,
}) {
  const { MessageButton, MessageActionRow } = builders;
  const idOf = (doc) => String(doc.id || doc._id);
  const button = (id, label, disabled = false, style = 'grey', emoji = null) => {
    const result = new MessageButton().setID(id).setLabel(label).setStyle(style)
      .setDisabled(disabled);
    return emoji ? result.setEmoji(emoji) : result;
  };
  const row = (...buttons) => new MessageActionRow().addComponents(...buttons);
  const control = (doc, action, suffix = '') => `score:${idOf(doc)}:${action}${suffix ? `:${suffix}` : ''}`;
  const mention = (id) => `<@!${id}>`;
  const url = (doc, messageId) => `https://discord.com/channels/${doc.guild}/${doc.scoringChannelId}/${messageId}`;
  const sourceId = (doc) => doc.scoringMessageId || doc.scoringTemplateMessageId;
  const isBattle = (doc) => doc.type.startsWith('battle');
  const raceWord = (doc) => (isBattle(doc) ? 'round' : 'race');
  const raceTitle = (doc) => (isBattle(doc) ? 'Battle' : 'Race');
  const mapLabel = (doc, race) => {
    const arena = doc.scoringTracks[race - 1];
    if (!isBattle(doc)) return arena;
    const mode = (doc.scoringBattleModes || [])[race - 1];
    return `${arena} — ${mode ? mode.replace(/Last Kart Driving/g, 'LKD') : 'Mode unavailable'}`;
  };
  const externalDraft = (doc) => doc.trackOption === 'draft'
    && !['race_ffa', 'race_duos', 'race_itemless_ffa', 'race_itemless_duos'].includes(doc.type);
  const eligible = (doc) => doc.mode !== 'tournament' && doc.type !== 'race_survival'
    && !externalDraft(doc) && Boolean(pointsFor(doc.type, doc.players.length))
    && doc.players.length === pointsFor(doc.type, doc.players.length).length;

  function teamAssignments(doc) {
    const teams = new Map();
    if (!/_(?:duos|3v3|4v4)$/.test(doc.type)) return teams;
    if (!Array.isArray(doc.teamList)) return null;
    const roster = new Set(doc.scoringRoster.map((player) => player.discordId));
    for (const [index, members] of doc.teamList.entries()) {
      if (!Array.isArray(members)) return null;
      for (const member of members) {
        const id = String(member);
        if (!roster.has(id) || teams.has(id)) return null;
        teams.set(id, index);
      }
    }
    return teams.size === roster.size ? teams : null;
  }

  const sameTeam = (teams, id, group) => teams.has(id) && group.some((other) => teams.get(other) === teams.get(id));
  const invalidTie = (teams, group) => group.length > 1
    && (teams === null || group.some((id, i) => sameTeam(teams, id, group.slice(0, i))));
  const canStartTie = (teams, remaining) => teams !== null && remaining.length >= 2
    && remaining.some((id) => !sameTeam(teams, id, [remaining[0]]));

  function validateTieTeams(teams, groups) {
    if (!groups.some((group) => group.length > 1)) return;
    if (teams === null) throw new Error('Team assignments are missing or invalid. Tie entry is unavailable.');
    if (groups.some((group) => invalidTie(teams, group))) {
      throw new Error('Players on the same team cannot share a tie. Use Undo↩️ or Reset❌ to correct the entry.');
    }
  }

  async function update(doc, values) {
    // Do not save a stale whole lobby document over room, roster or draft updates.
    const saved = await Lobby.findOneAndUpdate({ _id: doc._id, started: true }, { $set: values }, { new: true });
    if (!saved) throw new Error('This lobby has ended.');
    Object.assign(doc, values);
    return doc;
  }

  async function locked(lobbyId, guild, channel, userId, work, requireEnabled = true, acknowledged = null) {
    return withRoomLock(guild.id, async () => {
      if (acknowledged) {
        const error = await acknowledged;
        if (error) throw error;
      }
      const doc = await Lobby.findOne({ _id: lobbyId, guild: guild.id, started: true });
      if (!doc) throw new Error('This lobby has ended.');
      if (doc.scorekeeperId !== userId) throw new Error('Only the selected scorekeeper can use this.');
      if (!eligible(doc)) throw new Error('Button scoring is not available for this lobby format.');
      const room = await Room.findOne({ guild: guild.id, lobby: doc._id });
      if (!room || doc.scoringChannelId !== channel.id || channel.name.toLowerCase() !== `lobby-room-${room.number}`) {
        throw new Error('Use scoring in this lobby\'s current room.');
      }
      if (requireEnabled && !doc.scoringEnabled) throw new Error('Enable High IQ scoring from the scorekeeper announcement first.');
      return work(doc);
    });
  }

  async function fetchMessage(doc, channel, messageId) {
    const message = await channel.messages.fetch(messageId, true, true);
    if (message.author.id !== channel.client.user.id) throw new Error('The scoring message was not posted by this bot.');
    return message;
  }

  function validate(doc, text, initial = false) {
    const table = readTemplate(text, doc.scoringRoster, initial);
    if (table.races > doc.trackCount) throw new Error('The score table contains too many races.');
    return table;
  }

  async function offerRecovery(doc, channel, error) {
    const content = `${mention(doc.scorekeeperId)} I could not read the saved scores: ${error.message}\n${
      doc.scoringBackup ? 'Scoring is paused. Restore the last database backup below.' : 'Scoring is paused. Ask staff to check the missing template.'}`;
    const message = await channel.send({
      content,
      allowedMentions: { users: [doc.scorekeeperId] },
      components: doc.scoringBackup ? [row(button(control(doc, 'restore'), 'Restore scores from backup'))] : [],
    });
    await update(doc, { scoringRecoveryId: message.id });
    return null;
  }

  async function loadTable(doc, channel) {
    try {
      const source = await fetchMessage(doc, channel, sourceId(doc));
      return validate(doc, extractTemplate(source), !doc.scoringMessageId);
    } catch (error) {
      return offerRecovery(doc, channel, error);
    }
  }

  async function recoverBattleModes(doc, channel) {
    if (!isBattle(doc)) return;
    if (doc.scoringBattleModes && doc.scoringBattleModes.length === doc.scoringTracks.length
      && doc.scoringBattleModes.every((mode) => mode && mode.trim())) return;
    try {
      // Older active lobbies still have the actual announced schedule in their pinned start message.
      const pinned = await channel.messages.fetchPinned();
      const candidates = [];
      const starts = Array.from(pinned.values()).filter((message) => message.author.id === channel.client.user.id
        && (!doc.startedAt || message.createdTimestamp >= new Date(doc.startedAt).getTime()));
      for (const message of starts) {
        for (const embed of message.embeds || []) {
          const fields = embed.fields || [];
          const arenas = fields.find((field) => field.name === 'Arenas');
          const modes = fields.find((field) => field.name === 'Modes');
          if (arenas && modes && arenas.value.replace(/\r/g, '').trim() === doc.scoringTracks.join('\n')) {
            const names = modes.value.replace(/\r/g, '').trim().split('\n');
            if (names.length === doc.scoringTracks.length && names.every((name) => name.trim())) candidates.push(names);
          }
        }
      }
      if (candidates.length === 1) await update(doc, { scoringBattleModes: candidates[0] });
    } catch (error) {
      log('Could not recover the announced battle mode list:', error);
    }
  }

  function panelPayload(doc, state) {
    const count = doc.scoringRoster.length;
    const order = state.groups.flat();
    const teams = teamAssignments(doc);
    const pending = state.tie ? state.groups[state.groups.length - 1] : [];
    const remaining = doc.scoringRoster.map((player) => player.discordId).filter((id) => !order.includes(id));
    const invalid = state.groups.some((group) => invalidTie(teams, group));
    const ranked = rankGroups(state.groups, isBattle(doc));
    let next = isBattle(doc) ? state.groups.length + 1 : order.length + 1;
    if (state.tie) next = ranked[ranked.length - 1].place;
    let prompt = 'Double-check the finishing order, then press **Save scores✅**.';
    if (state.tie) prompt = `Select players tied for ${ordinal(next)} place.\nPress **Tie done⚖️** after selecting at least two players.`;
    else if (order.length < count) prompt = next === 8 ? 'Select 8th place 🐢' : `Select ${ordinal(next)} place player`;
    if (invalid) prompt += '\nTeammates cannot share a tie. Use **Undo↩️** or **Reset❌** to correct the entry.';
    else if (teams === null) prompt += '\nTeam assignments are unavailable. Ties are disabled.';
    const components = [];
    for (let i = 0; i < count; i += 2) {
      components.push(row(...doc.scoringRoster.slice(i, i + 2).map((player) => button(
        control(doc, 'pick', player.discordId), player.name.slice(0, 80), order.includes(player.discordId)
          || (state.tie && (teams === null || sameTeam(teams, player.discordId, pending))),
        'grey', teams && teamMarkers[teams.get(player.discordId)],
      ))));
    }
    components.push(row(button(control(doc, 'undo'), 'Undo↩️', !order.length && !state.tie),
      button(control(doc, 'reset'), 'Reset❌', !order.length && !state.tie),
      state.tie ? button(control(doc, 'done'), 'Tie done⚖️', pending.length < 2 || invalid)
        : button(control(doc, 'tie'), 'Tie⚖️', !canStartTie(teams, remaining)),
      button(control(doc, 'save'), 'Save scores✅', order.length !== count || state.tie || invalid, 'green')));
    return {
      content: '',
      allowedMentions: { parse: [] },
      components,
      embed: {
        title: isBattle(doc) ? `Battle ${state.race}/${doc.trackCount} — ${mapLabel(doc, state.race)}`
          : `Race ${state.race} / ${doc.trackCount} — ${mapLabel(doc, state.race)}`,
        description: `${prompt}\n[Previous scores](${url(doc, state.source)})`,
        fields: [{
          name: 'Finishing order',
          value: order.length ? ranked.flatMap(({ place, players }) => players.map((id) => {
            const player = doc.scoringRoster.find((entry) => entry.discordId === id);
            return `${place}. ${player.name} ${mention(id)}`;
          })).join('\n') : 'No players selected yet.',
        }],
      },
    };
  }

  function readPanel(doc, message) {
    const embed = (message.embeds || [])[0];
    const race = embed && embed.title.match(/^(?:Race|Round|Battle) (\d+)\s*\/\s*\d+ — /);
    const source = embed && embed.description.match(/\[Previous scores\]\(https:\/\/discord.com\/channels\/[^/]+\/[^/]+\/([^/)]+)\)/);
    if (!race || !source || Number(race[1]) < 1 || Number(race[1]) > doc.trackCount) {
      throw new Error('The unfinished scoring panel could not be read.');
    }
    const field = (embed.fields || []).find((entry) => entry.name === 'Finishing order');
    if (!field) throw new Error('The unfinished scoring selections are missing.');
    const lines = field.value === 'No players selected yet.' ? [] : field.value.split('\n');
    const selected = lines.map((line) => line.match(/^(\d+)\. .* <@!?(\d+)>$/));
    if (selected.some((match) => !match)) {
      throw new Error('The unfinished scoring selections are invalid.');
    }
    const order = selected.map((match) => match[2]);
    if (new Set(order).size !== order.length || order.length > doc.scoringRoster.length
      || order.some((id) => !doc.scoringRoster.some((player) => player.discordId === id))) {
      throw new Error('The unfinished scoring selections are invalid.');
    }
    const groups = [];
    let currentPlace = 0;
    let nextPlace = 1;
    for (const match of selected) {
      const place = Number(match[1]);
      if (!Number.isSafeInteger(place) || place < 1 || place > doc.scoringRoster.length) {
        throw new Error('The unfinished scoring positions are invalid.');
      }
      if (place !== currentPlace) {
        if (place !== nextPlace) throw new Error('The unfinished scoring positions are invalid.');
        groups.push([]);
        currentPlace = place;
        if (isBattle(doc)) nextPlace += 1;
      }
      groups[groups.length - 1].push(match[2]);
      if (!isBattle(doc)) nextPlace += 1;
    }
    const tiePrompt = embed.description.match(/^Select players tied for (\d+)(?:st|nd|rd|th) place\./);
    if (!tiePrompt && embed.description.startsWith('Select players tied for ')) {
      throw new Error('The unfinished tie position is invalid.');
    }
    if (tiePrompt) {
      const place = Number(tiePrompt[1]);
      if (place < 1 || place > doc.scoringRoster.length) throw new Error('The unfinished tie position is invalid.');
      if (place === nextPlace && order.length <= doc.scoringRoster.length - 2) groups.push([]);
      else if (place !== currentPlace) throw new Error('The unfinished tie position is invalid.');
    }
    return {
      race: Number(race[1]), source: source[1], groups, tie: Boolean(tiePrompt),
    };
  }

  async function deletePanel(doc, channel, panelId) {
    if (!panelId) return;
    try {
      await (await fetchMessage(doc, channel, panelId)).delete();
    } catch (error) {
      if (error.code !== 10008) {
        log('Could not remove the saved scoring panel:', error);
        await channel.send('Scores were saved, but I could not remove the old panel. Its controls are inactive.');
      }
    }
  }

  async function postResults(doc, channel, text, status) {
    if (text.length + 8 > 4096) throw new Error('The score template is too long to display in one code block.');
    const image = await drawTable(text);
    return channel.send({
      content: status,
      allowedMentions: { parse: [] },
      embed: { description: `\`\`\`\n${text}\n\`\`\``, image: { url: `attachment://${image.name}` } },
      files: [image],
    });
  }

  async function initialise(doc, channel, templateMessage, tracks, battleModes = []) {
    if (!eligible(doc)) return;
    const text = extractTemplate(templateMessage);
    const table = readTemplate(text, null, true);
    if (table.rows.length !== doc.players.length) throw new Error('The startup template is missing lobby players.');
    const players = [];
    for (const discordId of doc.players) {
      const player = await Player.findOne({ discordId });
      if (!player) throw new Error('A scoring player record is missing.');
      players.push({ discordId, name: player.rankedName });
    }
    const roster = table.rows.map((entry) => {
      const matches = players.filter((player) => player.name === entry.name);
      if (matches.length !== 1) throw new Error('Scoring needs a unique ranked name for every player.');
      return { ...matches[0], prefix: entry.prefix };
    });
    await update(doc, {
      scoringChannelId: channel.id,
      scoringTemplateMessageId: templateMessage.id,
      scoringRoster: roster,
      scoringTracks: tracks,
      scoringBattleModes: isBattle(doc) ? battleModes : [],
      scoringBackup: text,
    });
  }

  async function selectScorekeeper(doc, channel, userId) {
    await withRoomLock(doc.guild, async () => {
      const current = await Lobby.findOne({ _id: doc._id, started: true });
      if (!current || !current.players.includes(userId)) return;
      if (current.scorekeeperId && current.scorekeeperId !== userId) return;
      const room = await Room.findOne({ guild: doc.guild, lobby: doc._id });
      if (!room || channel.name.toLowerCase() !== `lobby-room-${room.number}`) return;
      // Persist the accepted human ID, not whichever reaction user happens to be cached last.
      await update(current, { scorekeeperId: userId });
      const components = eligible(current) && current.scoringTemplateMessageId
        ? [row(button(control(current, 'activate'), 'Enable High IQ scoring'))] : [];
      const announcement = await channel.send({
        content: `${mention(userId)} has volunteered to do scores. Please make sure you keep the lobby updated about mid-match scores.${
          components.length ? '\nScore like you used to, or try new HIGH IQ scoring with button below.' : ''}`,
        components,
        allowedMentions: { users: [userId] },
      });
      await update(current, { scoringOfferId: announcement.id });
    });
  }

  async function open(doc, channel, args) {
    if (args.length && (args.length !== 2 || args[0] !== 'edit' || !/^[1-9]\d*$/.test(args[1]))) {
      throw new Error('Use `!l score` or `!l score edit 3`.');
    }
    await recoverBattleModes(doc, channel);
    if (doc.scoringPanelId) {
      try {
        const panel = await fetchMessage(doc, channel, doc.scoringPanelId);
        const state = readPanel(doc, panel);
        // Refresh controls too, so pre-tie panels expose Tie immediately on resume.
        await panel.edit(panelPayload(doc, state));
        return channel.send(`Continue your unfinished entry: ${url(doc, panel.id)}`);
      } catch (error) {
        if (error.code !== 10008) throw error;
        await update(doc, { scoringPanelId: null });
        await channel.send('The unfinished panel was deleted. Please re-enter this unsaved race.');
      }
    }
    const table = await loadTable(doc, channel);
    if (!table) return null;
    const race = args.length ? Number(args[1]) : table.races + 1;
    if (args.length && race > table.races) throw new Error('That race has not been scored yet.');
    if (race > doc.trackCount) return channel.send(`All ${doc.trackCount} ${raceWord(doc)}s are scored. Use \`!l score edit 3\` to make a correction.`);
    if (!doc.scoringTracks[race - 1] || ['-', '*N/A*'].includes(doc.scoringTracks[race - 1])) {
      throw new Error('The track/arena list is not ready. Finish drafting before scoring.');
    }
    const state = {
      race, source: sourceId(doc), groups: [], tie: false,
    };
    const panel = await channel.send(panelPayload(doc, state));
    await update(doc, { scoringPanelId: panel.id });
    return panel;
  }

  async function command(message, args) {
    try {
      const number = message.channel.name.match(/^lobby-room-(\d+)$/i);
      const room = number && await Room.findOne({ guild: message.guild.id, number: Number(number[1]) });
      if (!room || !room.lobby) throw new Error('Use `!l score` in an active lobby room with a selected scorekeeper.');
      return await locked(String(room.lobby), message.guild, message.channel, message.author.id,
        (current) => open(current, message.channel, args));
    } catch (error) {
      return message.channel.warn(error.message);
    }
  }

  async function activate(doc, channel, messageId) {
    if (doc.scoringOfferId !== messageId) throw new Error('This activation button is no longer current.');
    if (doc.scoringEnabled) return 'Button scoring is already enabled. Run `!l score` to continue.';
    await update(doc, { scoringEnabled: true });
    const announcement = await fetchMessage(doc, channel, messageId);
    await announcement.edit({ components: [row(button(control(doc, 'activate'), 'Button scoring enabled', true))] });
    await channel.send({
      content: `${mention(doc.scorekeeperId)} HIGH IQ scoring enabled! Type \`!l score\` to start scoring the first ${raceWord(doc)}. `
      + `Tap players in finishing order, double-check, then press **Save scores✅**. Run \`!l score\` again after each ${raceWord(doc)}. `
      + 'For a tie, press **Tie⚖️** before selecting those players, then press **Tie done⚖️**.',
      allowedMentions: { users: [doc.scorekeeperId] },
    });
    return 'Button scoring enabled.';
  }

  async function restore(doc, channel, messageId) {
    if (doc.scoringRecoveryId !== messageId || !doc.scoringBackup) throw new Error('This recovery offer is no longer current.');
    const table = validate(doc, doc.scoringBackup, !doc.scoringMessageId);
    const restored = await postResults(doc, channel, doc.scoringBackup,
      `Scores restored from backup: ${table.races} / ${doc.trackCount} ${raceWord(doc)}s scored.`);
    const oldPanel = doc.scoringPanelId;
    const values = { scoringRecoveryId: null, scoringPanelId: null };
    values[doc.scoringMessageId ? 'scoringMessageId' : 'scoringTemplateMessageId'] = restored.id;
    await update(doc, values);
    await deletePanel(doc, channel, oldPanel);
    return 'Backup restored. Run `!l score` to continue.';
  }

  async function editPanel(doc, channel, messageId, action, playerId) {
    if (doc.scoringPanelId !== messageId) throw new Error('This panel is no longer active. Run `!l score` to continue.');
    const panel = await fetchMessage(doc, channel, messageId);
    const state = readPanel(doc, panel);
    const order = state.groups.flat();
    const teams = teamAssignments(doc);
    if (state.source !== sourceId(doc)) throw new Error('The saved scores changed. Reopen the scoring entry before continuing.');
    if (action === 'pick') {
      if (!doc.scoringRoster.some((player) => player.discordId === playerId)) throw new Error('Invalid player.');
      if (order.includes(playerId)) return 'That player is already selected.';
      if (state.tie) {
        if (teams === null) throw new Error('Team assignments are missing or invalid. Tie entry is unavailable.');
        const pending = state.groups[state.groups.length - 1];
        validateTieTeams(teams, [[...pending, playerId]]);
        pending.push(playerId);
      } else state.groups.push([playerId]);
    } else if (action === 'tie') {
      if (state.tie) return 'Tie entry is already active.';
      if (doc.scoringRoster.length - order.length < 2) throw new Error('A tie needs at least two remaining players.');
      if (teams === null) throw new Error('Team assignments are missing or invalid. Tie entry is unavailable.');
      const remaining = doc.scoringRoster.map((player) => player.discordId).filter((id) => !order.includes(id));
      if (!canStartTie(teams, remaining)) throw new Error('The remaining players are on the same team and cannot tie.');
      state.groups.push([]);
      state.tie = true;
    } else if (action === 'done') {
      if (!state.tie) throw new Error('There is no unfinished tie.');
      if (state.groups[state.groups.length - 1].length < 2) throw new Error('Select at least two players before pressing Tie done⚖️.');
      validateTieTeams(teams, [state.groups[state.groups.length - 1]]);
      state.tie = false;
    } else if (action === 'undo') {
      const last = state.groups[state.groups.length - 1];
      if (state.tie && last.length) last.pop();
      else if (state.tie || (last && last.length === 1)) {
        state.groups.pop();
        state.tie = false;
      } else if (last) {
        last.pop();
        state.tie = true;
      }
    } else if (action === 'reset') {
      state.groups = [];
      state.tie = false;
    } else if (action === 'save') {
      if (state.tie) throw new Error('Press Tie done⚖️ to confirm the tied players before saving scores.');
      validateTieTeams(teams, state.groups);
      const table = await loadTable(doc, channel);
      if (!table) return 'Scoring is paused. Check the recovery message in the room.';
      const text = scoreRace(table, doc.scoringRoster, state.groups, state.race, pointsFor(doc.type, doc.players.length), isBattle(doc));
      const completed = Math.max(table.races, state.race);
      const posted = await postResults(doc, channel, text,
        `✅ ${raceTitle(doc)} ${state.race} saved — ${mapLabel(doc, state.race)}. ${completed} / ${doc.trackCount} ${raceWord(doc)}s scored.${
          completed === doc.trackCount ? `\nAll ${raceWord(doc)}s scored. Double-check the final scores before submitting.` : ''}`);
      await update(doc, {
        scoringMessageId: posted.id, scoringBackup: text, scoringPanelId: null, scoringRecoveryId: null,
      });
      await deletePanel(doc, channel, panel.id);
      return 'Scores saved.';
    } else throw new Error('Unknown scoring action.');
    await panel.edit(panelPayload(doc, state));
    return 'Scoring entry updated.';
  }

  async function handleButton(interaction) {
    const match = interaction.id.match(/^score:([^:]+):([a-z]+)(?::([^:]+))?$/);
    if (!match) return;
    try {
      // Acknowledge before database work or a queued lock can exceed Discord's deadline.
      const acknowledged = interaction.reply.defer().then(() => null, (error) => error);
      const { channel } = interaction.message;
      // Reserve the queue immediately: acknowledgements may complete out of order.
      await locked(match[1], interaction.guild, channel, interaction.clicker.id,
        async (doc) => {
          if (match[2] === 'activate') return activate(doc, channel, interaction.message.id);
          if (match[2] === 'restore') return restore(doc, channel, interaction.message.id);
          return editPanel(doc, channel, interaction.message.id, match[2], match[3]);
        }, match[2] !== 'activate', acknowledged);
    } catch (error) {
      log('Could not process scoring button:', error);
      if (interaction.reply.has) {
        // A followup keeps errors private without adding a reply for every successful pick.
        await interaction.client.api.webhooks(interaction.applicationID, interaction.token).post({
          data: { content: error.message, flags: 64, allowed_mentions: { parse: [] } },
        }).catch(log);
      }
    }
  }

  async function setTracks(doc, tracks) {
    return withRoomLock(doc.guild, async () => {
      const current = await Lobby.findOne({ _id: doc._id, started: true });
      if (!current) throw new Error('This lobby has ended.');
      if (current.scoringEnabled && (current.scoringPanelId || current.scoringMessageId)) {
        throw new Error('Tracks cannot be rerolled after button scoring has started.');
      }
      await update(current, { scoringTracks: tracks });
    });
  }

  return {
    initialise, selectScorekeeper, command, handleButton, eligible, setTracks,
  };
}

module.exports = { createLobbyScoring };
