const defaultBuilders = require('discord-buttons');
const { randomBytes } = require('crypto');
const {
  readTemplate, extractTemplate, scoreRace, raceAwards, penaltyDeduction, rankGroups, ordinal,
} = require('./scoreTable');

// Same team order as generateTemplate's blue, red, green and yellow colors.
const teamMarkers = ['🟦', '🟥', '🟩', '🟨'];
const highIqEmoji = '<:highiq:1560812252356026499>';

// Inject Discord/database boundaries so every flow can be exercised offline.
function createLobbyScoring({
  Lobby, Room, Player, drawTable, withRoomLock, pointsFor,
  builders = defaultBuilders, log = console.error,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  getSubmissionChannel = () => null, resultContainsBannedPlayer, getStaffRole = () => null,
}) {
  const { MessageButton, MessageActionRow, MessageMenu } = builders;
  const scorekeeperChanges = new Map();
  const penaltyHistory = new Map();
  const submissionOffers = new Map();
  const sentSubmissions = new Map();
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
  const isWar = (doc) => !isBattle(doc) && /_(?:3v3|4v4)$/.test(doc.type);
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
      throw new Error('Players on the same team cannot share a tie. Use Undo ↩️ or Reset ❌ to correct the entry.');
    }
  }

  async function update(doc, values) {
    // Do not save a stale whole lobby document over room, roster or draft updates.
    const saved = await Lobby.findOneAndUpdate({ _id: doc._id, started: true }, { $set: values }, { new: true });
    if (!saved) throw new Error('This lobby has ended.');
    Object.assign(doc, values);
    return doc;
  }

  async function currentLobby(lobbyId, guild, channel) {
    const doc = await Lobby.findOne({ _id: lobbyId, guild: guild.id, started: true });
    if (!doc) throw new Error('This lobby has ended.');
    const room = await Room.findOne({ guild: guild.id, lobby: doc._id });
    if (!room || doc.scoringChannelId !== channel.id || channel.name.toLowerCase() !== `lobby-room-${room.number}`) {
      throw new Error('Use scoring in this lobby\'s current room.');
    }
    return doc;
  }

  async function locked(lobbyId, guild, channel, userId, work, requireEnabled = true, acknowledged = null) {
    return withRoomLock(guild.id, async () => {
      if (acknowledged) {
        const error = await acknowledged;
        if (error) throw error;
      }
      const doc = await currentLobby(lobbyId, guild, channel);
      if (doc.scorekeeperId !== userId) throw new Error('Only the selected scorekeeper can use this.');
      if (!eligible(doc)) throw new Error('Button scoring is not available for this lobby format.');
      if (requireEnabled && !doc.scoringEnabled) throw new Error('Enable **High IQ Scoring** from the scorekeeper announcement first.');
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

  function endBlockReason(doc) {
    if (!doc.started || !doc.scoringEnabled) return null;
    if (doc.scoringRecoveryId) return 'Restore the scoring backup with the recovery button before ending this lobby.';
    let completed = 0;
    try {
      if (!Number.isSafeInteger(doc.trackCount) || doc.trackCount < 1) throw new Error('Invalid race count.');
      // The startup template contains zero placeholders for every race. Only a
      // committed results message proves that any races have actually been saved.
      if (doc.scoringMessageId) completed = validate(doc, doc.scoringBackup).races;
    } catch (error) {
      return 'The saved High IQ Scoring record could not be verified. Use `!l score` to check or recover scores before ending this lobby.';
    }
    if (completed !== doc.trackCount) {
      return `Only ${completed}/${doc.trackCount} ${raceWord(doc)}s have been scored. Complete scoring with \`!l score\` and **Save scores ✅** before ending this lobby.`;
    }
    if (doc.scoringPanelId) return 'Finish and save the unfinished scoring entry before ending this lobby. Use `!l score` to continue.';
    return null;
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

  function panelPayload(doc, state, history = penaltyHistory.get(idOf(doc)) || []) {
    const count = doc.scoringRoster.length;
    const order = state.groups.flat();
    const teams = teamAssignments(doc);
    const pending = state.tie ? state.groups[state.groups.length - 1] : [];
    const remaining = doc.scoringRoster.map((player) => player.discordId).filter((id) => !order.includes(id));
    const invalid = state.groups.some((group) => invalidTie(teams, group));
    const complete = order.length === count && !state.tie && !invalid;
    const penalties = state.penalties || [];
    const ranked = rankGroups(state.groups, isBattle(doc));
    let next = isBattle(doc) ? state.groups.length + 1 : order.length + 1;
    if (state.tie) next = ranked[ranked.length - 1].place;
    let prompt = 'Double-check the finishing order, then press **Save scores ✅**.';
    if (state.tie) prompt = `Select players tied for ${ordinal(next)} place.\nPress **Tie done** after selecting at least two players.`;
    else if (order.length < count) prompt = next === 8 ? 'Select 8th place 🐢' : `Select ${ordinal(next)} place player`;
    if (state.penaltyMode) prompt = state.penaltyPlayer
      ? `Adjust penalties for ${mention(state.penaltyPlayer)}. ${isWar(doc) ? '**Laphit** adds a deduction from -1 to -10' : 'Each **-4 points** press adds one deduction'}; **Last place (0 pts)** toggles the last-place penalty.\nPress **Penalty done** to return to the score review.`
      : `Select a player below to adjust their penalties, then press **${isWar(doc) ? 'Laphit' : '-4 points'}** or **Last place (0 pts)**.`;
    if (state.laphitMenu) prompt = `Select a Laphit deduction for ${mention(state.penaltyPlayer)}, or choose **Cancel**.`;
    if (invalid) prompt += '\nTeammates cannot share a tie. Use **Undo ↩️** or **Reset ❌** to correct the entry.';
    else if (teams === null) prompt += '\nTeam assignments are unavailable. Ties are disabled.';
    const components = [];
    for (let i = 0; i < count; i += 2) {
      components.push(row(...doc.scoringRoster.slice(i, i + 2).map((player) => button(
        control(doc, 'pick', player.discordId), player.name.slice(0, 80), Boolean(state.laphitMenu) || (!state.penaltyMode && (order.includes(player.discordId)
          || (state.tie && (teams === null || sameTeam(teams, player.discordId, pending))))),
        state.penaltyMode && state.penaltyPlayer === player.discordId ? 'blurple' : 'grey',
        teams && teamMarkers[teams.get(player.discordId)],
      ))));
    }
    if (state.laphitMenu) {
      const menu = new MessageMenu().setID(state.laphitMenu).setPlaceholder('Select Laphit penalty')
        .setMinValues(1).setMaxValues(1).addOptions(
          ...Array.from({ length: 10 }, (_, i) => ({ label: `-${i + 1}`, value: `-${i + 1}` })),
          { label: 'Cancel', value: 'cancel' },
        );
      components.push(row(menu));
    } else if (state.penaltyMode) {
      components.push(row(button(control(doc, 'undo'), 'Undo ↩️', !history.length),
        button(control(doc, isWar(doc) ? 'laphit' : 'minus'), isWar(doc) ? 'Laphit' : '-4 points', !state.penaltyPlayer),
        button(control(doc, 'last'), 'Last place (0 pts)', !state.penaltyPlayer,
          penalties.some((entry) => entry.playerId === state.penaltyPlayer && entry.last) ? 'red' : 'grey'),
        button(control(doc, 'penaltydone'), 'Penalty done')));
    } else {
      const controls = [button(control(doc, 'undo'), 'Undo ↩️', !order.length && !state.tie),
        button(control(doc, 'reset'), 'Reset ❌', !order.length && !state.tie),
        state.tie ? button(control(doc, 'done'), 'Tie done', pending.length < 2 || invalid)
          : button(control(doc, 'tie'), 'Tie ⚖️', !canStartTie(teams, remaining))];
      if (!isBattle(doc)) controls.push(button(control(doc, 'penalty'), 'Penalty 💀', !complete));
      controls.push(button(control(doc, 'save'), 'Save scores ✅', !complete, 'green'));
      components.push(row(...controls));
    }
    const fields = [{
      name: penalties.length ? 'Original finishing order' : 'Finishing order',
      value: order.length ? ranked.flatMap(({ place, players }) => players.map((id) => {
        const player = doc.scoringRoster.find((entry) => entry.discordId === id);
        return `${place}\\. ${player.name} ${mention(id)}${players.length > 1 ? ' (Tied)' : ''}`;
      })).join('\n') : 'No players selected yet.',
    }];
    if (state.penaltyMode) fields.push({ name: 'Penalty player', value: state.penaltyPlayer ? mention(state.penaltyPlayer) : 'Select a player below.' });
    if (penalties.length) fields.push({ name: 'Penalties', value: penalties.map((entry) =>
      `${mention(entry.playerId)}: ${penaltyDeduction(entry) ? `-${penaltyDeduction(entry)}` : '0'} points${entry.last ? '; last place' : ''}`).join('\n') });
    if (penalties.length && complete) {
      const awards = raceAwards(state.groups, pointsFor(doc.type, count), isBattle(doc), penalties);
      fields.push({ name: 'Adjusted scores', value: [...awards].sort((a, b) => a[1].place - b[1].place)
        .map(([id, award]) => `${award.place}\\. ${mention(id)} — ${award.cell}${award.cell.includes('-') ? ` = ${award.total}` : ''} pts`).join('\n') });
    }
    return {
      content: '',
      allowedMentions: { parse: [] },
      components,
      embed: {
        title: isBattle(doc) ? `Battle ${state.race}/${doc.trackCount} — ${mapLabel(doc, state.race)}`
          : `Race ${state.race} / ${doc.trackCount} — ${mapLabel(doc, state.race)}`,
        description: `${prompt}\n[Previous scores](${url(doc, state.source)})`,
        fields,
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
    const field = (embed.fields || []).find((entry) => ['Finishing order', 'Original finishing order'].includes(entry.name));
    if (!field) throw new Error('The unfinished scoring selections are missing.');
    const lines = field.value === 'No players selected yet.' ? [] : field.value.split('\n');
    // Accept older unescaped panels as well as literal place numbers and tie labels.
    const selected = lines.map((line) => line.match(/^(\d+)\\?\. .* <@!?(\d+)>(?: \(Tied\))?$/));
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
    const penaltyField = (embed.fields || []).find((entry) => entry.name === 'Penalties');
    const penalties = penaltyField ? penaltyField.value.split('\n').map((line) => {
      const match = line.match(/^<@!?(\d+)>: (-?\d+) points(; last place)?$/);
      const deduction = match && -Number(match[2]);
      if (!match || !doc.scoringRoster.some((player) => player.discordId === match[1])
        || !Number.isSafeInteger(deduction) || deduction < 0 || (!isWar(doc) && deduction % 4 !== 0) || (!deduction && !match[3])) {
        throw new Error('The unfinished penalties are invalid.');
      }
      return { playerId: match[1], count: isWar(doc) ? 0 : deduction / 4,
        ...(isWar(doc) ? { laphit: deduction } : {}), last: Boolean(match[3]) };
    }) : [];
    if (new Set(penalties.map((entry) => entry.playerId)).size !== penalties.length) throw new Error('The unfinished penalties are invalid.');
    const targetField = (embed.fields || []).find((entry) => entry.name === 'Penalty player');
    const target = targetField && targetField.value.match(/^<@!?(\d+)>$/);
    if (targetField && ((!target && targetField.value !== 'Select a player below.')
      || (target && !doc.scoringRoster.some((player) => player.discordId === target[1]))
      || order.length !== doc.scoringRoster.length || tiePrompt)) throw new Error('The unfinished penalty selection is invalid.');
    if (isBattle(doc) && (penalties.length || targetField)) throw new Error('Penalties are not available in battle modes.');
    const menus = (message.components || []).flatMap((entry) => entry.components || [])
      .filter((entry) => entry && entry.type === 3 && typeof entry.custom_id === 'string'
        && entry.custom_id.startsWith(control(doc, 'lapvalue', '')));
    const laphitMenu = menus.length ? menus[0].custom_id : null;
    if (menus.length > 1 || (laphitMenu && (!isWar(doc) || !target
      || !laphitMenu.startsWith(control(doc, 'lapvalue', `${target[1]}-`))
      || !/^[a-f0-9]{16}$/.test(laphitMenu.slice(control(doc, 'lapvalue', `${target[1]}-`).length))))) {
      throw new Error('The unfinished Laphit menu is invalid.');
    }
    return {
      race: Number(race[1]), source: source[1], groups, tie: Boolean(tiePrompt),
      penalties, penaltyMode: Boolean(targetField), penaltyPlayer: target ? target[1] : null, laphitMenu,
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

  const submissionButtons = (doc, disabled = false) => [row(
    button(control(doc, 'submit'), 'Submit scores', disabled, 'green'),
    button(control(doc, 'submitmanual'), "I'll do it myself", disabled),
  )];
  const submissionLink = (doc, record) => `https://discord.com/channels/${doc.guild}/${record.channelId}/${record.messageId}`;
  const submittedResult = (doc) => sentSubmissions.get(idOf(doc)) || (doc.scoringSubmissionMessageId ? {
    messageId: doc.scoringSubmissionMessageId, channelId: doc.scoringSubmissionChannelId, sourceId: doc.scoringSubmissionSourceId,
  } : null);

  async function closeSubmissionOffer(doc, content) {
    const offer = submissionOffers.get(idOf(doc));
    if (!offer || offer.closed) return;
    offer.closed = true;
    await offer.message.edit({ content, components: submissionButtons(doc, true), allowedMentions: { parse: [] } })
      .catch((error) => log('Could not update the score submission prompt:', error));
  }

  async function offerSubmission(doc, channel) {
    if (!doc.ranked || !doc.scoringEnabled || endBlockReason(doc)) return;
    const submitted = submittedResult(doc);
    if (submitted) {
      await channel.send(`${submitted.sourceId !== doc.scoringMessageId
        ? 'Scores were re-saved after submission. Check the existing submission with staff:' : 'Scores already submitted:'} ${submissionLink(doc, submitted)}`);
      return;
    }
    const previous = submissionOffers.get(idOf(doc));
    if (previous && previous.sourceId === doc.scoringMessageId) return;
    await closeSubmissionOffer(doc, 'The saved scores changed. Use the latest submission prompt.');
    const destination = await getSubmissionChannel(doc.guild);
    if (!destination) throw new Error('The configured results-submissions channel could not be found.');
    const message = await channel.send({
      content: `Submit finished scores to <#${destination.id}> ?`,
      components: submissionButtons(doc), allowedMentions: { parse: [] },
    });
    submissionOffers.set(idOf(doc), { message, sourceId: doc.scoringMessageId, channelId: destination.id, closed: false });
  }

  async function tryOfferSubmission(doc, channel) {
    try { await offerSubmission(doc, channel); } catch (error) {
      log('Could not offer score submission:', error);
      await channel.send(`Scores are saved, but automatic submission is unavailable: ${error.message} Submit them manually or retry with \`!l score\`.`).catch(log);
    }
  }

  async function submitScores(doc, channel, messageId, manual) {
    if (!doc.ranked) throw new Error('Automatic submission is only available for ranked lobbies using High IQ Scoring.');
    const offer = submissionOffers.get(idOf(doc));
    if (!offer || offer.message.id !== messageId || offer.closed || offer.sourceId !== doc.scoringMessageId) {
      throw new Error('This score submission prompt is no longer current. Use `!l score` to continue.');
    }
    const blocked = endBlockReason(doc);
    if (blocked) throw new Error(blocked);
    if (manual) {
      await closeSubmissionOffer(doc, `Submit the finished scores yourself to <#${offer.channelId}>.`);
      return;
    }
    const existing = submittedResult(doc);
    if (existing) {
      await closeSubmissionOffer(doc, `Scores already submitted: ${submissionLink(doc, existing)}`);
      return;
    }
    const destination = await getSubmissionChannel(doc.guild);
    if (!destination || destination.id !== offer.channelId) throw new Error('The results-submissions channel is unavailable. Submit scores manually or ask staff to check the channel.');
    const table = await loadTable(doc, channel);
    if (!table) throw new Error('Restore the scoring backup before submitting scores.');
    if (table.races !== doc.trackCount) throw new Error('Save every race or round before submitting scores.');
    const text = table.lines.join('\n');
    if (typeof resultContainsBannedPlayer !== 'function') throw new Error('Submission validation is unavailable. Ask staff to check the bot.');
    if (await resultContainsBannedPlayer(text)) throw new Error('This score table contains a player banned from ranked lobbies. It cannot be submitted.');
    const posted = await destination.send({
      content: `${mention(doc.scorekeeperId)}\n\`\`\`\n${text}\n\`\`\``,
      allowedMentions: { parse: [], users: [doc.scorekeeperId] },
    });
    const record = { messageId: posted.id, channelId: destination.id, sourceId: doc.scoringMessageId };
    // A successful send must not be repeated if recording its reference fails.
    sentSubmissions.set(idOf(doc), record);
    try {
      await update(doc, { scoringSubmissionMessageId: record.messageId,
        scoringSubmissionChannelId: record.channelId, scoringSubmissionSourceId: record.sourceId });
      sentSubmissions.delete(idOf(doc));
    } catch (error) { log('Scores were submitted, but their message reference could not be saved:', error); }
    await closeSubmissionOffer(doc, `Scores submitted: ${submissionLink(doc, record)}`);
  }

  function forgetSubmission(doc) {
    submissionOffers.delete(idOf(doc));
    sentSubmissions.delete(idOf(doc));
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
        ? [row(button(control(current, 'activate'), 'Enable High IQ Scoring'))] : [];
      const announcement = await channel.send({
        content: `${mention(userId)} has volunteered to do scores.${
          components.length ? '\nScore like you used to, or try new **High IQ Scoring** with button below.' : ''}`,
        components,
        allowedMentions: { users: [userId] },
      });
      await update(current, { scoringOfferId: announcement.id });
    });
  }

  async function open(doc, channel, args) {
    if (args.length && (args.length !== 2 || args[0] !== 'edit' || !/^[1-9]\d*$/.test(args[1]))) {
      throw new Error('Use `!l score`, `!l score edit 3` or `!l score help`.');
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
    if (race > doc.trackCount) {
      await channel.send(`All ${doc.trackCount} ${raceWord(doc)}s are scored. Use \`!l score edit 3\` to make a correction.`);
      return tryOfferSubmission(doc, channel);
    }
    if (!doc.scoringTracks[race - 1] || ['-', '*N/A*'].includes(doc.scoringTracks[race - 1])) {
      throw new Error('The track/arena list is not ready. Finish drafting before scoring.');
    }
    const state = {
      race, source: sourceId(doc), groups: [], tie: false,
    };
    penaltyHistory.delete(idOf(doc));
    const panel = await channel.send(panelPayload(doc, state));
    await update(doc, { scoringPanelId: panel.id });
    await closeSubmissionOffer(doc, 'Scores are being corrected. Save the correction before submitting.');
    return panel;
  }

  async function command(message, args) {
    try {
      if (args.length === 1 && args[0].toLowerCase() === 'help') {
        return await showHelp(message.guild.id, message.channel);
      }
      const number = message.channel.name.match(/^lobby-room-(\d+)$/i);
      const room = number && await Room.findOne({ guild: message.guild.id, number: Number(number[1]) });
      if (!room || !room.lobby) throw new Error('Use `!l score` in an active lobby room with a selected scorekeeper.');
      return await locked(String(room.lobby), message.guild, message.channel, message.author.id,
        (current) => open(current, message.channel, args));
    } catch (error) {
      return message.channel.warn(error.message);
    }
  }

  function showHelp(guildId, channel) {
    const staff = getStaffRole(guildId);
    return channel.send({
      content: [
        '**High IQ Scoring Guide**',
        '',
        'Use `!l score` to start scoring, and to continue scoring after each race',
        'To do scores, press player name buttons in the order of their position',
        '',
        'Press **Save scores ✅** when you are done scoring a race',
        'Press **Undo ↩️** to undo one score from current race',
        'Press **Reset ❌** to undo all scores from current race',
        'Use `!l score edit #` to edit a previous race. Replace `#` with race number',
        '',
        'If you have ties, press **Tie ⚖️** to start selecting tied players',
        'Press **Tie done** when you are done selecting tied players',
        '',
        'If you have penalties, first finish scoring the entire race',
        'Before saving scores, press **Penalty 💀** penalties are added one by one',
        'Select a player, then press the type of penalty you wish to give them',
        'Press **Penalty done** to return to the review, then **Save scores ✅**',
        '',
        'If you want to change scorekeepers, use `!l change scorekeeper @player` to give scorekeeping to someone else in the lobby',
        '',
        `If you have any questions, ping ${staff ? `<@&${staff.id}>` : '@Staff'} and ask away`,
      ].join('\n'),
      allowedMentions: { parse: [] },
    });
  }

  async function closeScorekeeperChange(lobbyId, pending, content) {
    if (scorekeeperChanges.get(lobbyId) !== pending) return;
    scorekeeperChanges.delete(lobbyId);
    clearTimer(pending.timer);
    if (pending.collector) pending.collector.stop('closed');
    await pending.message.edit({
      content,
      allowedMentions: { parse: [] },
      components: pending.kind === 'vote' ? [] : [row(button(`score:${lobbyId}:acceptkeeper`, 'Accept scorekeeper duty', true, 'green'))],
    }).catch((error) => log('Could not update scorekeeper change request:', error));
  }

  function scorekeeperContinuation(doc) {
    if (doc.scoringPanelId) return ` Continue the unfinished entry: ${url(doc, doc.scoringPanelId)}`;
    if (doc.scoringEnabled) return ' Type `!l score` to continue scoring.';
    return doc.scoringOfferId ? ` [Enable High IQ Scoring](${url(doc, doc.scoringOfferId)}) when ready.` : '';
  }

  async function finishScorekeeperVote(lobbyId, pending, guild, channel) {
    if (scorekeeperChanges.get(lobbyId) !== pending) return;
    const expired = () => now() >= pending.expiresAt;
    const cancel = (text) => closeScorekeeperChange(lobbyId, pending, text);
    if (expired()) return cancel('Scorekeeper vote timed out. The current scorekeeper keeps control.');
    let doc;
    try {
      doc = await currentLobby(lobbyId, guild, channel);
      if (doc.scorekeeperId !== pending.from || doc.players.length !== pending.players.length
        || pending.players.some((id) => !doc.players.includes(id)) || !eligible(doc)) {
        throw new Error('The scorekeeper or lobby players changed.');
      }
    } catch (error) {
      return cancel(`Scorekeeper vote cancelled: ${error.message}`);
    }
    if (expired()) return cancel('Scorekeeper vote timed out. The current scorekeeper keeps control.');
    if (pending.message.deleted || pending.collector.ended) return cancel('Scorekeeper vote cancelled.');
    const voters = pending.collector.users;
    if (voters.size < pending.required || (pending.to !== pending.requester && !voters.has(pending.to))) return;
    await update(doc, { scorekeeperId: pending.to });
    return cancel(`${mention(pending.to)} is now the scorekeeper after the lobby vote.${scorekeeperContinuation(doc)}`);
  }

  async function startScorekeeperVote(doc, message, target) {
    const requester = message.author.id;
    const required = Math.ceil((doc.players.length - 1) * 0.75) - (requester === target.id ? 1 : 0);
    const request = await message.channel.send({
      content: `${mention(requester)} has nominated ${mention(target.id)} as the new scorekeeper.\n`
        + `I need ✅ reactions from ${required} other lobby players within 120 seconds. The requester is already counted.`
        + (requester === target.id ? '' : ` ${mention(target.id)} must also react ✅; their vote counts toward the requirement.`)
        + `\n${doc.players.map(mention).join(' ')}`,
      allowedMentions: { parse: [], users: doc.players },
    });
    const lobbyId = idOf(doc);
    const pending = { kind: 'vote', from: doc.scorekeeperId, to: target.id, requester, required,
      players: [...doc.players], message: request, expiresAt: now() + 120000 };
    scorekeeperChanges.set(lobbyId, pending);
    try {
      const collector = request.createReactionCollector((reaction, user) => reaction.emoji.name === '✅'
        && !user.bot && user.id !== requester && pending.players.includes(user.id)
        && scorekeeperChanges.get(lobbyId) === pending, { time: 120000, dispose: true });
      pending.collector = collector;
      collector.on('collect', () => withRoomLock(message.guild.id,
        () => finishScorekeeperVote(lobbyId, pending, message.guild, message.channel))
        .catch(async (error) => {
          log('Could not transfer scorekeeper after a vote:', error);
          await message.channel.warn(error.message).catch(log);
        }));
      collector.on('end', (collected, reason) => {
        if (scorekeeperChanges.get(lobbyId) !== pending) return;
        return withRoomLock(message.guild.id, () => closeScorekeeperChange(lobbyId, pending,
          reason === 'time' ? 'Scorekeeper vote timed out. The current scorekeeper keeps control.' : 'Scorekeeper vote cancelled.')).catch(log);
      });
      await request.react('✅');
      return request;
    } catch (error) {
      await closeScorekeeperChange(lobbyId, pending, 'Scorekeeper vote could not start. The current scorekeeper keeps control.');
      throw error;
    }
  }

  async function changeScorekeeper(message, args) {
    try {
      const target = args.length === 1 && args[0].match(/^<@!?(\d+)>$/);
      const user = target && message.mentions.users.get(target[1]);
      if (!user || user.bot) {
        throw new Error('Use `!l change scorekeeper @player` and mention one human player in the lobby.');
      }
      const number = message.channel.name.match(/^lobby-room-(\d+)$/i);
      const room = number && await Room.findOne({ guild: message.guild.id, number: Number(number[1]) });
      if (!room || !room.lobby) throw new Error('Use `!l change scorekeeper @player` in your active lobby room.');
      const lobbyId = String(room.lobby);
      return await withRoomLock(message.guild.id, async () => {
        const doc = await currentLobby(lobbyId, message.guild, message.channel);
        if (!eligible(doc)) throw new Error('Button scoring is not available for this lobby format.');
        const staff = message.member && message.member.isStaff();
        if (!staff && !doc.players.includes(message.author.id)) throw new Error('Only lobby players or staff can change the scorekeeper.');
        if (!doc.players.includes(user.id)) throw new Error('The new scorekeeper must be a player in this lobby.');
        if (user.id === doc.scorekeeperId) throw new Error('That player is already the scorekeeper.');
        const previous = scorekeeperChanges.get(lobbyId);
        if (staff) {
          await update(doc, { scorekeeperId: user.id });
          const text = `${mention(user.id)} is now the scorekeeper, assigned by ${mention(message.author.id)}.${scorekeeperContinuation(doc)}`;
          if (previous) await closeScorekeeperChange(lobbyId, previous, 'Scorekeeper change cancelled by a staff assignment.');
          return message.channel.send({ content: text, allowedMentions: { parse: [], users: [user.id] } }).catch(log);
        }
        if (previous) {
          if (now() < previous.expiresAt) throw new Error('A scorekeeper change is already awaiting acceptance or votes in this lobby.');
          await closeScorekeeperChange(lobbyId, previous, 'Scorekeeper change timed out. The current scorekeeper keeps control.');
        }
        if (message.author.id !== doc.scorekeeperId) return startScorekeeperVote(doc, message, user);
        const request = await message.channel.send({
          content: `${mention(user.id)}, ${mention(doc.scorekeeperId)} has asked you to take over scorekeeping. Accept within 1 minute.`,
          allowedMentions: { users: [user.id] },
          components: [row(button(control(doc, 'acceptkeeper'), 'Accept scorekeeper duty', false, 'green'))],
        });
        const pending = { from: doc.scorekeeperId, to: user.id, message: request, expiresAt: now() + 60000 };
        scorekeeperChanges.set(lobbyId, pending);
        // Release the shared room lock while the player decides.
        pending.timer = setTimer(() => withRoomLock(message.guild.id, () => closeScorekeeperChange(lobbyId, pending,
          'Scorekeeper change timed out. The current scorekeeper keeps control.')).catch(log), 60000);
        if (pending.timer.unref) pending.timer.unref();
        return request;
      });
    } catch (error) {
      return message.channel.warn(error.message);
    }
  }

  async function acceptScorekeeperChange(lobbyId, interaction, acknowledged) {
    return withRoomLock(interaction.guild.id, async () => {
      const error = await acknowledged;
      if (error) throw error;
      const pending = scorekeeperChanges.get(lobbyId);
      if (!pending || pending.collector || pending.message.id !== interaction.message.id
        || pending.message.channel.id !== interaction.message.channel.id) {
        throw new Error('This scorekeeper change request is no longer active.');
      }
      if (now() >= pending.expiresAt) {
        await closeScorekeeperChange(lobbyId, pending, 'Scorekeeper change timed out. The current scorekeeper keeps control.');
        throw new Error('This scorekeeper change request has expired.');
      }
      if (interaction.clicker.id !== pending.to) throw new Error('Only the invited player can accept scorekeeper duty.');
      const doc = await currentLobby(lobbyId, interaction.guild, interaction.message.channel);
      if (doc.scorekeeperId !== pending.from || !doc.players.includes(pending.to)) {
        await closeScorekeeperChange(lobbyId, pending, 'Scorekeeper change cancelled because the scorekeeper or lobby players changed.');
        throw new Error('The scorekeeper or lobby players changed. Request a new transfer.');
      }
      await update(doc, { scorekeeperId: pending.to });
      await closeScorekeeperChange(lobbyId, pending,
        `${mention(pending.to)} has accepted scorekeeper duty from ${mention(pending.from)}.${scorekeeperContinuation(doc)}`);
    });
  }

  async function activate(doc, channel, messageId) {
    if (doc.scoringOfferId !== messageId) throw new Error('This activation button is no longer current.');
    if (doc.scoringEnabled) return '**High IQ Scoring** is already enabled. Run `!l score` to continue.';
    await update(doc, { scoringEnabled: true });
    const announcement = await fetchMessage(doc, channel, messageId);
    await announcement.edit({ components: [row(button(control(doc, 'activate'), 'High IQ Scoring enabled', true))] });
    const staff = getStaffRole(doc.guild);
    await channel.send({
      content: `${mention(doc.scorekeeperId)} **High IQ Scoring** ${highIqEmoji} enabled! Use \`!l score\` to start scoring the first ${raceWord(doc)}\n`
      + 'To do scores, press player name buttons in the order of their position, then press **Save scores** ✅\n\n'
      + `Use \`!l score\` again after each ${raceWord(doc)}. To edit a previous ${raceWord(doc)}, `
      + `use \`!l score edit #\`, and replace \`#\` with the ${raceWord(doc)} number\n`
      + `Use \`!l score help\` or ping ${staff ? `<@&${staff.id}>` : '@Staff'} if you need help!`,
      allowedMentions: { parse: [], users: [doc.scorekeeperId] },
    });
    return '**High IQ Scoring** enabled.';
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
    penaltyHistory.delete(idOf(doc));
    await deletePanel(doc, channel, oldPanel);
    await tryOfferSubmission(doc, channel);
    return 'Backup restored. Run `!l score` to continue.';
  }

  async function editPanel(doc, channel, messageId, action, playerId, values) {
    if (doc.scoringPanelId !== messageId) throw new Error('This panel is no longer active. Run `!l score` to continue.');
    const panel = await fetchMessage(doc, channel, messageId);
    const state = readPanel(doc, panel);
    const order = state.groups.flat();
    const teams = teamAssignments(doc);
    let history = penaltyHistory.get(idOf(doc)) || [];
    if (state.source !== sourceId(doc)) throw new Error('The saved scores changed. Reopen the scoring entry before continuing.');
    if (isBattle(doc) && ['penalty', 'minus', 'last', 'penaltydone', 'laphit', 'lapvalue'].includes(action)) {
      throw new Error('Penalties are not available in battle modes.');
    }
    if (state.laphitMenu && action !== 'lapvalue') throw new Error('Select a Laphit deduction or Cancel before continuing.');
    if (['laphit', 'lapvalue'].includes(action) && !isWar(doc)) throw new Error('Laphit penalties are only available in racing 3v3/4v4 lobbies.');
    if (action === 'minus' && isWar(doc)) throw new Error('Use Laphit to choose the deduction for this war lobby.');
    if (state.penaltyMode && !['pick', 'minus', 'last', 'penaltydone', 'undo', 'laphit', 'lapvalue'].includes(action)) {
      throw new Error('Press Penalty done to return to the finishing order before continuing.');
    }
    if (action === 'penalty') {
      if (order.length !== doc.scoringRoster.length || state.tie) throw new Error('Finish entering every player and confirm any tie before applying penalties.');
      validateTieTeams(teams, state.groups);
      state.penaltyMode = true;
      state.penaltyPlayer = null;
    } else if (action === 'laphit') {
      if (!state.penaltyMode || !state.penaltyPlayer) throw new Error('Open Penalty 💀 and select a player first.');
      state.laphitMenu = control(doc, 'lapvalue', `${state.penaltyPlayer}-${randomBytes(8).toString('hex')}`);
    } else if (['minus', 'last', 'lapvalue'].includes(action)) {
      if (!state.penaltyMode || !state.penaltyPlayer) throw new Error('Open Penalty 💀 and select a player first.');
      if (action === 'lapvalue') {
        if (!state.laphitMenu || state.laphitMenu !== control(doc, 'lapvalue', playerId)) throw new Error('This Laphit menu is no longer active.');
        if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string'
          || !/^(?:-[1-9]|-10|cancel)$/.test(values[0])) throw new Error('Choose one Laphit deduction from -1 to -10, or Cancel.');
        state.laphitMenu = null;
        if (values[0] === 'cancel') {
          await panel.edit(panelPayload(doc, state, history));
          return 'Laphit entry cancelled.';
        }
      }
      const before = state.penalties.find((entry) => entry.playerId === state.penaltyPlayer)
        || { playerId: state.penaltyPlayer, count: 0, last: false };
      const changed = { ...before };
      if (action === 'minus') changed.count += 1;
      else if (action === 'lapvalue') changed.laphit = (changed.laphit || 0) - Number(values[0]);
      else changed.last = !changed.last;
      if (!Number.isSafeInteger(penaltyDeduction(changed))) throw new Error('Invalid player penalty.');
      history = [...history, before];
      state.penalties = state.penalties.filter((entry) => entry.playerId !== changed.playerId);
      if (penaltyDeduction(changed) || changed.last) state.penalties.push(changed);
    } else if (action === 'penaltydone') {
      if (!state.penaltyMode) throw new Error('There is no penalty entry in progress.');
      state.penaltyMode = false;
      state.penaltyPlayer = null;
    } else if (action === 'undo' && state.penaltyMode) {
      const before = history[history.length - 1];
      if (!before) throw new Error('There is no penalty action to undo.');
      history = history.slice(0, -1);
      state.penalties = state.penalties.filter((entry) => entry.playerId !== before.playerId);
      if (penaltyDeduction(before) || before.last) state.penalties.push(before);
      state.penaltyPlayer = before.playerId;
    } else if (action === 'pick') {
      if (!doc.scoringRoster.some((player) => player.discordId === playerId)) throw new Error('Invalid player.');
      if (state.penaltyMode) state.penaltyPlayer = playerId;
      else if (order.includes(playerId)) return 'That player is already selected.';
      else if (state.tie) {
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
      if (state.groups[state.groups.length - 1].length < 2) throw new Error('Select at least two players before pressing Tie done.');
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
      state.penalties = [];
      history = [];
    } else if (action === 'save') {
      if (state.tie) throw new Error('Press Tie done to confirm the tied players before saving scores.');
      validateTieTeams(teams, state.groups);
      const table = await loadTable(doc, channel);
      if (!table) return 'Scoring is paused. Check the recovery message in the room.';
      const text = scoreRace(table, doc.scoringRoster, state.groups, state.race,
        pointsFor(doc.type, doc.players.length), isBattle(doc), state.penalties);
      const completed = Math.max(table.races, state.race);
      const posted = await postResults(doc, channel, text,
        `✅ ${raceTitle(doc)} ${state.race} saved — ${mapLabel(doc, state.race)}. ${completed} / ${doc.trackCount} ${raceWord(doc)}s scored.${
          completed === doc.trackCount ? `\nAll ${raceWord(doc)}s scored. Double-check the final scores before submitting.` : ''}`);
      await update(doc, {
        scoringMessageId: posted.id, scoringBackup: text, scoringPanelId: null, scoringRecoveryId: null,
      });
      penaltyHistory.delete(idOf(doc));
      await deletePanel(doc, channel, panel.id);
      if (completed === doc.trackCount) await tryOfferSubmission(doc, channel);
      return 'Scores saved.';
    } else throw new Error('Unknown scoring action.');
    await panel.edit(panelPayload(doc, state, history));
    if (history.length) penaltyHistory.set(idOf(doc), history);
    else penaltyHistory.delete(idOf(doc));
    return 'Scoring entry updated.';
  }

  async function handleButton(interaction) {
    const match = interaction.id.match(/^score:([^:]+):([a-z]+)(?::([^:]+))?$/);
    if (!match) return;
    try {
      // Acknowledge before database work or a queued lock can exceed Discord's deadline.
      const acknowledged = interaction.reply.defer().then(() => null, (error) => error);
      const { channel } = interaction.message;
      if (match[2] === 'acceptkeeper') return await acceptScorekeeperChange(match[1], interaction, acknowledged);
      // Reserve the queue immediately: acknowledgements may complete out of order.
      await locked(match[1], interaction.guild, channel, interaction.clicker.id,
        async (doc) => {
          if (match[2] === 'activate') return activate(doc, channel, interaction.message.id);
          if (match[2] === 'restore') return restore(doc, channel, interaction.message.id);
          if (['submit', 'submitmanual'].includes(match[2])) return submitScores(doc, channel, interaction.message.id, match[2] === 'submitmanual');
          return editPanel(doc, channel, interaction.message.id, match[2], match[3], interaction.values);
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

  function handleMenu(interaction) {
    if (!/^score:[^:]+:lapvalue:/.test(interaction.id)) return;
    return handleButton(interaction);
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
    initialise, selectScorekeeper, command, changeScorekeeper, handleButton, handleMenu, eligible, setTracks, endBlockReason, forgetSubmission,
  };
}

module.exports = { createLobbyScoring };
