const AsyncLock = require('async-lock');
const { seedGames, nextGames, scoreOrder } = require('./ffaBracket');
const { readTemplate } = require('./scoreTable');
const { rulesets } = require('../db/rulesets');
const { engineStyles } = require('../db/engine_styles');

function createFfaTournament({ Lobby, Game, Room, Sequence, Player, Rank, client,
  scoring, withRoomLock, findRoomChannel, clearRoomMemberPermissions,
  releaseRoom, generateTracks, generateTemplate, renderOverview, removeOtherQueues, endTournament, cancelTournament,
  log = console.error }) {
  const jobs = new AsyncLock();
  const keeperPrompts = new Map();
  const keeperDescription = 'One player from this game must react with ✅ to volunteer to keep scores. There is no scorekeeper timeout.';
  function forgetKeepers(tournamentId) {
    for (const [id, prompt] of keeperPrompts) {
      if (String(prompt.tournamentId) === String(tournamentId)) keeperPrompts.delete(id);
    }
  }
  const supports = (doc) => doc.mode === 'tournament' && doc.type === 'race_ffa'
    && [16, 32, 64].includes(doc.maxPlayerCount);
  const stage = (count) => ({ 64: 'Round of 64', 32: 'Quarterfinals', 16: 'Semifinals', 8: 'Final' }[count]);
  const activeParent = (id) => Lobby.findOne({ _id: id, started: true, ffaManaged: true,
    ffaPhase: { $nin: ['ending', 'cancelled'] } });
  const patchGame = (id, values) => Game.findOneAndUpdate({ _id: id, started: true }, { $set: values }, { new: true });
  const fieldsFor = (name, lines, inline = true) => {
    const fields = [];
    for (const line of lines) {
      if (line.length > 1024) throw new Error(`${name} contains an entry longer than Discord's field limit.`);
      const last = fields[fields.length - 1];
      if (last && last.value.length + line.length + 1 <= 1024) last.value += `\n${line}`;
      else fields.push({ name: fields.length ? `${name} (continued)` : name, value: line || '-', inline });
    }
    return fields;
  };

  async function overview(id) {
    const parent = await activeParent(id);
    if (!parent) return;
    const games = await Game.find({ tournamentId: parent._id, round: parent.ffaRound }).sort({ match: 1 });
    const channel = client.guilds.cache.get(parent.guild).channels.cache.get(parent.channel);
    const message = await channel.messages.fetch(parent.message);
    const embed = await renderOverview(parent);
    embed.author = { name: `${parent.getTitle()} — ${stage(parent.players.length)}` };
    embed.fields.push({ name: 'Round progress', value: `${games.filter((game) => game.finished).length}/${parent.ffaGroups.length} games confirmed${parent.ffaPhase === 'preparing' ? ' · Preparing rooms' : ''}.`, inline: false });
    const links = games.map((game) => `Match ${game.match}: ${game.scoringChannelId
      ? `<#${game.scoringChannelId}>` : 'Preparing room'}${game.finished ? ' · Finished' : ''}`);
    if (links.length) embed.fields.push({ name: 'Game rooms', value: links.join('\n') });
    await message.edit({ embed, components: [] });
  }

  async function seed(parent) {
    if (parent.players.length !== parent.maxPlayerCount) throw new Error('Fill the selected FFA tournament size before starting.');
    await Lobby.findOneAndUpdate({ _id: parent._id, started: true }, { $set: { ffaPhase: 'preparing' } });
    const seeds = [];
    for (const discordId of parent.players) {
      const player = await Player.findOne({ discordId });
      if (!player) throw new Error(`Missing player profile: ${discordId}`);
      const rank = await Rank.findOne({ name: player.rankedName });
      const ratings = rank ? Object.values(rank.toObject ? rank.toObject() : rank)
        .filter((value) => value && Number.isFinite(value.rank)).map((value) => value.rank) : [];
      seeds.push({ discordId, rating: ratings.length ? Math.max(...ratings) : 1200 });
    }
    return Lobby.findOneAndUpdate({ _id: parent._id, started: true, ffaManaged: { $ne: true } }, {
      $set: { ffaManaged: true, ffaOriginalPlayers: [...parent.players], ffaSeeds: seeds,
        ffaGroups: seedGames(seeds), ffaRound: 1, ffaPhase: 'preparing', ffaTracks: [] },
    }, { new: true });
  }

  async function reserve(parent) {
    return withRoomLock(parent.guild, async () => {
      parent = await activeParent(parent._id);
      if (!parent) return [];
      const guild = client.guilds.cache.get(parent.guild);
      const existing = await Room.find({ guild: parent.guild, lobby: parent._id }).sort({ number: 1 });
      const currentGames = await Game.find({ tournamentId: parent._id, round: parent.ffaRound });
      const currentIds = new Set(currentGames.map((game) => String(game._id)));
      const result = [];
      const used = new Set();
      for (let index = 0; index < parent.ffaGroups.length; index += 1) {
        const game = await Game.findOneAndUpdate({ tournamentId: parent._id, round: parent.ffaRound, match: index + 1 }, {
          $setOnInsert: { tournamentId: parent._id, guild: parent.guild, creator: parent.creator,
            round: parent.ffaRound, match: index + 1, final: parent.players.length === 8,
            players: parent.ffaGroups[index], type: parent.type, mode: 'standard', started: true,
            ranked: parent.ranked, trackOption: parent.trackOption, trackCount: parent.trackCount,
            scoringRoster: [], scoringTracks: parent.ffaTracks, teamList: [], qualifiers: [],
            finished: false, completed: false, posted: false, scoringEnabled: false },
        }, { upsert: true, new: true });
        // Preserve a game's assignment on partial preparation/restart. Pool order
        // alone could move a scored game when an earlier room was released.
        let room = existing.find((entry) => String(entry.tournamentGame) === String(game._id));
        if (!room && game.posted) throw new Error(`Match ${game.match}'s reserved room is missing. Ask staff to check its assignment.`);
        if (!room) room = existing.find((entry) => !used.has(entry.number)
          && !currentIds.has(String(entry.tournamentGame)));
        if (!room) room = await Room.findOne({ guild: parent.guild, lobby: null }).sort({ number: 1 });
        if (!room) {
          const sequence = await Sequence.findOneAndUpdate({ guild: parent.guild, name: 'rooms' },
            { $inc: { number: 1 } }, { upsert: true, new: true });
          room = new Room({ guild: parent.guild, number: sequence.number });
        }
        if (room.cleanupAt) await releaseRoom(guild, room);
        room.lobby = parent._id;
        room.tournamentGame = game._id;
        room.cleanupAt = null;
        await room.save();
        await patchGame(game._id, { roomNumber: room.number });
        used.add(room.number);
        result.push({ game, room });
      }
      for (const room of existing.filter((entry) => !used.has(entry.number))) await releaseRoom(guild, room);
      return result;
    });
  }

  // Recover sends whose Discord response arrived before a database write failed.
  async function trackedSend(channel, game, field, kind, payload) {
    const marker = `FFA ${game.id || game._id} · ${kind}`;
    let message;
    if (game[field]) {
      try { message = await channel.messages.fetch(game[field], true, true); } catch (error) {
        if (error.code !== 10008) throw error;
      }
    }
    if (!message) {
      const recent = await channel.messages.fetch({ limit: 50 });
      message = [...recent.values()].find((item) => item.author.id === client.user.id
        && item.embeds.some((embed) => embed.footer && embed.footer.text === marker));
    }
    if (!message) {
      payload.embed = { ...payload.embed, footer: { text: marker } };
      message = await channel.send(payload);
    }
    if (!await patchGame(game._id, { [field]: message.id })) throw new Error('Tournament game ended during posting.');
    game[field] = message.id;
    return message;
  }

  async function postGame(parent, game, room) {
    const channel = await findRoomChannel(parent, room.number);
    if (!channel) throw new Error('A tournament room is no longer assigned.');
    return withRoomLock(parent.guild, async () => {
      const current = await activeParent(parent._id);
      const assigned = await Room.findOne({ guild: parent.guild, number: room.number,
        lobby: parent._id, tournamentGame: game._id });
      if (!current || current.ffaRound !== game.round || !assigned) throw new Error('Tournament assignment changed.');
      if (game.scoringChannelId && game.scoringChannelId !== channel.id) game.posted = false;
      if (!game.posted) {
        const fresh = await clearRoomMemberPermissions(channel);
        for (const id of new Set([...game.players, parent.creator])) {
          await fresh.createOverwrite(await fresh.guild.members.fetch(id), { VIEW_CHANNEL: true, SEND_MESSAGES: true });
        }
        const pinned = await channel.messages.fetchPinned();
        for (const message of pinned.values()) if (message.author.id === client.user.id) await message.unpin();
      }
      await patchGame(game._id, { scoringChannelId: channel.id, posted: game.posted });
      game = await Game.findOne({ _id: game._id, started: true });
      if (!game) throw new Error('Tournament game ended during preparation.');
      if (!game.posted) {
        const [psns, , template] = await generateTemplate(game.players, parent, []);
        const roster = game.players.map((id) => `<@${id}>`).join('\n');
        const ruleset = rulesets.find((entry) => entry.id === parent.ruleset);
        const engine = engineStyles.find((entry) => entry.key === parent.engineRestriction);
        const card = await trackedSend(channel, game, 'cardMessageId', 'game', {
          content: game.players.map((id) => `<@${id}>`).join(', '),
          embed: { color: parent.getColor(), title: `${stage(parent.players.length)} · Match ${game.match}`,
            fields: [{ name: 'Players', value: roster, inline: true },
              ...fieldsFor('PSN IDs & Ranks', psns),
              ...fieldsFor('Tracks', parent.ffaTracks),
              { name: 'Settings', value: `Races: ${parent.trackCount}\nLaps: ${parent.lapCount}\nRuleset: ${ruleset ? ruleset.name : parent.ruleset}${engine ? `\nEngine style: ${engine.name}` : ''}` },
              { name: 'Finish game', value: game.final ? 'After scoring every race, use `!l end` or `!l advance @winner`.'
                : 'After scoring every race, confirm the top four with `!l advance @p1 @p2 @p3 @p4`.' }] },
        });
        await card.pin();
        if (template.length + 8 > 4096) throw new Error('The tournament score template is too long. Check player names.');
        const templateMessage = await trackedSend(channel, game, 'scoringTemplateMessageId', 'scores', {
          embed: { title: 'Score Template', description: `\`\`\`\n${template}\n\`\`\`` },
        });
        if (!game.scoringRoster.length) await scoring.initialise(game, channel, templateMessage, parent.ffaTracks);
        await templateMessage.pin();
      }
      if (!game.scorekeeperId) {
        const prompt = await trackedSend(channel, game, 'keeperMessageId', 'scorekeeper', {
          embed: { description: keeperDescription }, components: [],
        });
        // Convert saved button prompts too, without creating duplicate messages on restart.
        if (prompt.components.length || prompt.embeds[0].description !== keeperDescription) {
          await prompt.edit({ embed: { description: keeperDescription, footer: prompt.embeds[0].footer }, components: [] });
        }
        keeperPrompts.set(prompt.id, { gameId: game._id, tournamentId: parent._id,
          guildId: parent.guild, channelId: channel.id, players: new Set(game.players), selecting: false });
        await prompt.react('✅');
      }
      await patchGame(game._id, { posted: true });
    });
  }

  async function prepare(id) {
    let parent = await activeParent(id);
    if (!parent) return;
    await Game.updateMany({ tournamentId: id, round: { $lt: parent.ffaRound }, started: true },
      { $set: { started: false, completed: true } });
    if (!parent.ffaTracks.length) {
      const settings = new Lobby(parent.toObject());
      settings.mode = 'standard';
      const tracks = await generateTracks(settings);
      parent = await Lobby.findOneAndUpdate({ _id: id, started: true, ffaRound: parent.ffaRound,
        ffaPhase: { $nin: ['ending', 'cancelled'] } },
        { $set: { ffaTracks: tracks } }, { new: true });
      if (!parent) return;
    }
    const assigned = await reserve(parent);
    for (const entry of assigned) await postGame(parent, entry.game, entry.room);
    await Lobby.findOneAndUpdate({ _id: id, started: true, ffaRound: parent.ffaRound,
      ffaPhase: { $nin: ['ending', 'cancelled'] } },
      { $set: { ffaPhase: 'playing' } });
    await overview(id).catch((error) => log('Could not refresh tournament overview:', error));
  }

  async function transition(id) {
    let shouldPrepare = false;
    const initial = await activeParent(id);
    if (!initial) return;
    await withRoomLock(initial.guild, async () => {
      const parent = await activeParent(id);
      if (!parent || parent.ffaPhase !== 'playing' || parent.players.length === 8) return;
      const games = await Game.find({ tournamentId: id, round: parent.ffaRound }).sort({ match: 1 });
      if (games.length !== parent.ffaGroups.length || games.some((game) => !game.finished)) return;
      const groups = nextGames(games);
      await Lobby.findOneAndUpdate({ _id: id, started: true, ffaRound: parent.ffaRound }, {
        $set: { ffaRound: parent.ffaRound + 1, ffaGroups: groups, players: groups.flat(),
          ffaTracks: [], ffaPhase: 'preparing' },
      });
      await Game.updateMany({ tournamentId: id, round: parent.ffaRound }, { $set: { started: false, completed: true } });
      forgetKeepers(id);
      shouldPrepare = true;
    });
    if (shouldPrepare) await prepare(id);
  }

  async function start(doc) {
    return jobs.acquire(String(doc._id), async () => {
      let parent = await Lobby.findOne({ _id: doc._id, started: true });
      if (!parent) return;
      if (parent.ffaPhase === 'ending') return endTournament(parent, null);
      if (parent.ffaPhase === 'cancelled') return cancelTournament(parent);
      if (!parent.ffaManaged) {
        parent = await seed(parent);
        if (!parent) return;
      }
      await removeOtherQueues(parent);
      await prepare(parent._id);
      await transition(parent._id);
    });
  }

  async function command(message, finalEnd = false) {
    const match = message.channel.name.match(/^lobby-room-(\d+)$/i);
    if (!match) return false;
    const room = await Room.findOne({ guild: message.guild.id, number: Number(match[1]) });
    if (!room || !room.tournamentGame) return false;
    const initial = await Game.findOne({ _id: room.tournamentGame });
    if (!initial) return false;
    try {
      await jobs.acquire(String(initial.tournamentId), async () => {
        const closing = await Lobby.findOne({ _id: initial.tournamentId, started: true,
          ffaPhase: { $in: ['ending', 'cancelled'] } });
        if (closing) {
          const canRetry = message.member.isStaff() || (closing.ffaPhase === 'ending'
            ? message.author.id === initial.scorekeeperId : message.author.id === closing.creator);
          if (!canRetry) {
            throw new Error(closing.ffaPhase === 'ending'
              ? 'Only this game\'s scorekeeper or staff can retry finishing the tournament.'
              : 'Only the tournament creator or staff can retry cleanup.');
          }
          return closing.ffaPhase === 'ending' ? endTournament(closing, message) : cancelTournament(closing);
        }
        let parent = await activeParent(initial.tournamentId);
        if (!parent) throw new Error('This tournament has ended.');
        if (parent.ffaPhase === 'preparing') {
          if (message.author.id !== parent.creator && !message.member.isStaff()) throw new Error('Only the creator or staff can retry tournament preparation.');
          await prepare(parent._id);
          return message.channel.info('The saved round is ready. Play it before confirming qualifiers.');
        }
        let finalWinner;
        await withRoomLock(message.guild.id, async () => {
          const game = await Game.findOne({ _id: initial._id, started: true });
          parent = await activeParent(initial.tournamentId);
          const assigned = game && await Room.findOne({ guild: message.guild.id, number: game.roomNumber,
            lobby: initial.tournamentId, tournamentGame: game._id });
          if (!game || !parent || !assigned || game.round !== parent.ffaRound
            || game.scoringChannelId !== message.channel.id) throw new Error('This game is no longer active.');
          if (message.author.id !== game.scorekeeperId && !message.member.isStaff()) {
            throw new Error('Only this game\'s scorekeeper or staff can confirm it.');
          }
          if (finalEnd && !game.final) throw new Error('Use `!l advance` to confirm this group. To cancel the event, delete its signup message.');
          const blocked = scoring.endBlockReason(game);
          if (blocked) throw new Error(blocked);
          const order = scoreOrder(game, readTemplate);
          const qualifiers = order.slice(0, game.final ? 1 : 4).map((entry) => entry.discordId);
          const mentions = message.mentions.users.map((user) => user.id);
          if ((!finalEnd || mentions.length) && (mentions.length !== qualifiers.length
            || new Set(mentions).size !== qualifiers.length || mentions.some((id) => !qualifiers.includes(id)))) {
            throw new Error(`Mention ${game.final ? 'the winning player' : 'exactly the four qualifying players'} from the saved scores. Mention order does not matter.`);
          }
          await patchGame(game._id, { finished: true, qualifiers });
          if (game.final) {
            await Lobby.findOneAndUpdate({ _id: parent._id, started: true }, { $set: { ffaPhase: 'ending' } });
            parent.ffaPhase = 'ending';
            finalWinner = qualifiers[0];
          }
        });
        if (finalWinner) {
          await message.channel.success(`The winner of the tournament is <@${finalWinner}>!`);
          return endTournament(parent, message);
        }
        await message.channel.success('This game is confirmed. The next round starts when every group is confirmed.');
        await overview(parent._id).catch((error) => log('Could not refresh tournament overview:', error));
        await transition(parent._id);
      });
    } catch (error) {
      log('Could not confirm FFA tournament game:', error);
      await message.channel.warn(error.message);
    }
    return true;
  }

  async function keeper(reaction, user) {
    const prompt = keeperPrompts.get(reaction.message.id);
    if (!prompt) return false;
    // Reject spectators, bots and repeated reactions from memory before any API/database work.
    if (user.bot || reaction.emoji.name !== '✅' || !prompt.players.has(user.id) || prompt.selecting
      || reaction.message.guild.id !== prompt.guildId || reaction.message.channel.id !== prompt.channelId) return true;
    prompt.selecting = true;
    try {
      await jobs.acquire(String(prompt.tournamentId), async () => {
        const game = await Game.findOne({ _id: prompt.gameId, guild: prompt.guildId, started: true });
        const parent = game && await activeParent(game.tournamentId);
        if (!parent || game.finished || game.round !== parent.ffaRound
          || reaction.message.id !== game.keeperMessageId || prompt.channelId !== game.scoringChannelId) {
          keeperPrompts.delete(reaction.message.id);
          return;
        }
        if (parent.ffaPhase !== 'playing' || !game.players.includes(user.id)) return;
        if (!game.scorekeeperId) await scoring.selectScorekeeper(game, reaction.message.channel, user.id);
        const selected = await Game.findOne({ _id: game._id });
        if (selected && selected.scorekeeperId) {
          keeperPrompts.delete(reaction.message.id);
          await reaction.message.delete();
        }
      });
    } catch (error) {
      log('Could not select tournament scorekeeper:', error);
    } finally {
      prompt.selecting = false;
    }
    return true;
  }

  async function close(parent) {
    await Lobby.findOneAndUpdate({ _id: parent._id }, {
      $set: { ffaPhase: parent.ffaPhase === 'ending' ? 'ending' : 'cancelled' },
    });
    await Game.updateMany({ tournamentId: parent._id, finished: true }, { $set: { started: false, completed: true } });
    await Game.updateMany({ tournamentId: parent._id, started: true }, { $set: { started: false } });
    forgetKeepers(parent._id);
  }

  async function resume() {
    const parents = await Lobby.find({ started: true,
      $or: [{ ffaManaged: true }, { ffaPhase: 'preparing' }] });
    for (const parent of parents) {
      try {
        const guild = client.guilds.cache.get(parent.guild);
        const channel = guild && guild.channels.cache.get(parent.channel);
        if (!channel) throw new Error('Signup channel is unavailable; tournament retained for staff to check.');
        try { await channel.messages.fetch(parent.message); } catch (error) {
          if (error.code !== 10008) throw error;
          await cancelTournament(parent);
          continue;
        }
        await start(parent);
      } catch (error) { log(`Could not resume FFA tournament ${parent.id}:`, error); }
    }
  }

  async function retry(parent, message) {
    if (message.author.id !== parent.creator && !message.member.isStaff()) return message.channel.warn('Only the creator or staff can retry tournament preparation.');
    if (!parent.started) return message.channel.warn('You can only advance a started tournament.');
    if (parent.ffaManaged && parent.ffaPhase === 'playing') return message.channel.warn('Confirm qualifiers in their own game room.');
    try { await start(parent); } catch (error) { log(error); return message.channel.warn(error.message); }
    return message.channel.info('The saved tournament round is ready.');
  }

  return { supports, start, command, keeper, close, resume, retry, overview };
}

module.exports = { createFfaTournament };
