const moment = require('moment');
const { CronJob } = require('cron');
const AsyncLock = require('async-lock');
const { MessageActionRow } = require('discord-buttons');
const {
  yesButton,
  noButton,
  joinLobbyButton,
  leaveLobbyButton,
  deleteLobbyButton,
} = require('../db/buttons');
const {
  RACE_ITEMS_DUOS,
  RACE_ITEMS_3V3,
  RACE_ITEMS_4V4,
  RACE_SURVIVAL,
  SURVIVAL_STYLES,
  LEADERBOARDS,
  LOBBY_MODE_STANDARD,
  LOBBY_MODE_TOURNAMENT,
  TRACK_OPTION_DRAFT,
  CUSTOM_OPTION_MODE,
  CUSTOM_OPTION_TRACK_POOL,
  CUSTOM_OPTION_PLAYERS,
  CUSTOM_OPTION_RULESET,
  CUSTOM_OPTION_REGION,
  CUSTOM_OPTION_CONSOLES,
  CUSTOM_OPTION_BATTLE_MODES,
  CUSTOM_OPTION_RESERVE,
  CUSTOM_OPTION_ANONYMOUS,
  CUSTOM_OPTION_PRIVATE_CHANNEL,
  CUSTOM_OPTION_DESCRIPTION,
  CUSTOM_OPTION_TEAM_CREATION,
  CUSTOM_OPTION_TYPE,
  CUSTOM_OPTION_MMR_LOCK,
  TEAM_CREATION_BALANCED,
  TEAM_CREATION_RANDOM
} = require('../db/models/lobby');
const config = require('../config');
const { Cooldown } = require('../db/models/cooldown');
const { Counter } = require('../db/models/counter');
const { Duo } = require('../db/models/duo');
const { FinishedLobby } = require('../db/models/finished_lobby');
const { Lobby } = require('../db/models/lobby');
const { Player } = require('../db/models/player');
const { Rank } = require('../db/models/rank');
const { RankedBan } = require('../db/models/ranked_ban');
const { Room } = require('../db/models/room');
const { Sequence } = require('../db/models/sequence');
const { Team } = require('../db/models/team');
const { client } = require('../bot');
const compareArrays = require('../utils/compareArrays');
const generateBattleModes = require('../utils/generateBattleModes');
const generateTemplate = require('../utils/generateTemplate');
const generateTracks = require('../utils/generateTracks');
const { createLobbyScoring } = require('../utils/lobbyScoring');
const { pointsFor } = require('../db/race_points');
const getConfigValue = require('../utils/getConfigValue');
const getLorenziBoardData = require('../utils/getLorenziBoardData');
const greedyPartition = require('../utils/greedyPartition');
const { validateDuoRoster, validateDuoRound, balanceDuoGroups, getAdvancingDuos, splitTournamentFields } = require('../utils/duoTournament');
const {
  withRoomLock,
  getRoomChannel,
  clearRoomMemberPermissions,
  releaseRoom,
  resumeRoomCleanups,
} = require('../utils/lobbyRoomPermissions');
const { saveTournamentAdvancement, resumeTournamentCleanups } = require('../utils/tournamentRoomPermissions');

const {
  optimalPartition3,
  optimalPartition4,
} = require('../utils/optimalPartition');

const {
  battleModes1v1,
  battleModesSolos,
  battleModesTeams,
} = require('../db/modes_battle');
const { engineStyles } = require('../db/engine_styles');
const { lobbyTypes } = require('../db/lobby_types');
const { regions } = require('../db/regions');
const { rulesets } = require('../db/rulesets');
const { trackOptions } = require('../db/track_options');
const { consoles } = require('../db/consoles');
const getRandomArrayElement = require('../utils/getRandomArrayElement');
const resultContainsBannedPlayer = require('../utils/resultContainsBannedPlayer');
const ucfirst = require('../utils/ucfirst');

const lock = new AsyncLock();
const lobbyScoring = createLobbyScoring({ Lobby, Room, Player, withRoomLock, pointsFor,
  drawTable: require('../utils/drawTable') });

const NAT3 = 'NAT 3';
const FORCE_START_COOLDOWN = 5;

/**
 * Returns the footer for the lobby embed
 * @param doc
 * @returns {{icon_url: (string|*), text: string}}
 */
function getFooter(doc) {
  return {
    icon_url: doc.getIcon(),
    text: `id: ${doc._id}`,
  };
}

/**
 * Returns a room name
 * @param number
 * @returns {string}
 */
function getRoomName(number) {
  return `lobby-room-${number}`;
}

/**
 * Returns the current lobby number for a given gamemode
 * @param type
 * @returns {Number}
 */
async function getLobbyNumber(type) {
  let lobbyNumber;
  let lastFinishedLobbyNumber = 0;

  const lastFinishedLobby = await FinishedLobby.findOne({ type }).sort({ number: -1 });
  if (lastFinishedLobby && lastFinishedLobby.number) {
    lastFinishedLobbyNumber = lastFinishedLobby.number;
  }

  let lastCurrentLobbyNumber = 0;
  const lastCurrentLobby = await Lobby.findOne({ type }).sort({ number: -1 });

  if (lastCurrentLobby && lastCurrentLobby.number) {
    lastCurrentLobbyNumber = lastCurrentLobby.number;
  }

  if (lastCurrentLobbyNumber > lastFinishedLobbyNumber) {
    lobbyNumber = lastCurrentLobbyNumber + 1;
  } else {
    lobbyNumber = lastFinishedLobbyNumber + 1;
  }

  return lobbyNumber;
}

/**
 * Returns an array of info about a player
 * @param playerId
 * @param doc
 * @returns {Promise<(string|*|number)[]|(string|number)[]>}
 */
async function getPlayerInfo(playerId, doc) {
  const p = await Player.findOne({ discordId: playerId });
  const rank = await Rank.findOne({ name: p.rankedName });
  let rankValue = doc.getDefaultRank();

  if (rank && rank[doc.type]) {
    rankValue = rank[doc.type].rank;
    rankValue = parseInt(rankValue, 10);
  }

  if (!rankValue) {
    rankValue = doc.getDefaultRank();
  }

  const flag = p.flag !== undefined ? ` ${p.flag}` : ':united_nations:';
  let tag = `${flag} <@${playerId}>`;

  const natIcon = p.getNatIcon();
  if (natIcon && !doc.isTournament()) {
    tag += ` ${natIcon}`;
  }

  const consoleIcon = p.getConsoleIcon();
  if (consoleIcon && !doc.isTournament()) {
    tag += ` ${consoleIcon}`;
  }

  let { psn } = p;
  if (psn) {
    psn = psn.replace('_', '\\_');
  }

  let { rankedName } = p;
  if (rankedName) {
    rankedName = rankedName.replace('_', '\\_');
  }

  if (!doc.anonymous || doc.started) {
    return [tag, psn, rankValue, rankedName];
  }

  const region = regions.find((r) => r.key === p.region);
  const pos = doc.players.findIndex((dp) => dp === p.discordId);
  const name = `Player ${pos + 1}`;

  return [
    `${region.emote} ${name} - ${region.name} ${natIcon}`,
    '???',
    doc.getDefaultRank(),
    '???',
  ];
}

/**
 * Returns a list of livestreams from players in a lobby
 * @param doc
 * @returns {Promise<*[]>}
 */
async function getLivestreams(doc) {
  const livestreams = [];

  // eslint-disable-next-line max-len
  const members = await client.guilds.cache.get(doc.guild).members.fetch({ user: doc.players, withPresences: true });

  members.forEach((m) => {
    for (const activity of m.presence.activities) {
      if (activity.isCTRStream() && !livestreams.includes(activity.url)) {
        const channelName = activity.url.split('/').pop();
        livestreams.push(`[${channelName}](${activity.url})`);

        break;
      }
    }
  });

  return livestreams;
}

/**
 * Returns the average rank of a lobby
 * @param doc
 * @returns {Promise<number|number>}
 */
async function getAverageRank(doc) {
  const ranks = [];

  for (const playerId of doc.players) {
    const [, , rank] = await getPlayerInfo(playerId, doc);
    ranks.push(rank);
  }

  const sum = ranks.reduce((a, b) => a + b, 0);
  return Math.round(sum / ranks.length);
}

/**
 * Returns the lobby embed
 * @param doc
 * @param players
 * @param tracks
 * @param roomChannel
 * @returns Promise
 */
async function getEmbed(doc, players, tracks, roomChannel) {
  const duoTournament = doc.isTournament() && doc.type === RACE_ITEMS_DUOS;
  let playersText = 'No players.';
  let psnAndRanks = 'No players.';

  const playersInfo = {};

  const playersOut = [];
  if (players && players.length) {
    const psns = [];

    for (const playerId of players) {
      const [playerTag, psn, rank, playerName] = await getPlayerInfo(playerId, doc);
      const tag = duoTournament ? `<@${playerId}>` : playerTag;
      const ranked_name = duoTournament && playerName && playerName.length > 64
        ? `${playerName.slice(0, 61)}...` : playerName;

      playersOut.push(tag);

      if (doc.ranked) {
        psns.push(`[${rank}] ${ranked_name}`);
      } else {
        psns.push(ranked_name);
      }

      playersInfo[playerId] = { tag, psn, rank };
    }

    playersText = playersOut.join('\n');
    psnAndRanks = psns.join('\n');
  }

  if (doc.teamList && doc.teamList.length) {
    playersText = '';
    playersText += '**Teams:**\n';

    doc.teamList.forEach((team, i) => {
      if (team.length <= 0) {
        return;
      }

      let mmrSum = 0;

      team.forEach((player) => {
        let info = playersInfo[player];

        if (!info) {
            info = { rank: doc.getDefaultRank() };
        }

        mmrSum += info.rank;
      });

      if (doc.ranked && (!doc.anonymous || doc.started)) {
        playersText += `**Team ${i + 1} [Rating: ${Math.floor(mmrSum / team.length)}]**\n`;
      } else {
        playersText += `**Team ${i + 1}**\n`;
      }

      /* Fill the remaining spots with "Open" spots */
      if (team.length < doc.getTeamSize()) {
        for (let i = (team.length + 1); i <= doc.getTeamSize(); i++) {
          team.push(i);
          playersInfo[i] = { tag: '*Open*', psn: '-', rank: '-' };
        }
      }

      team.forEach((player, x) => {
        const info = playersInfo[player];
        const tag = info && info.tag;
        playersText += `${x + 1}. ${tag}\n`;
        delete playersInfo[player];
      });
    });

    if (Object.keys(playersInfo).length) {
      playersText += '**Solo Queue:**\n';
      Object.entries(playersInfo).forEach(([, value]) => {
        playersText += `${value.tag}\n`;
      });
    }
  }

  let fields;

  const iconUrl = doc.getIcon();
  const creator = await Player.findOne({ discordId: doc.creator });
  const timestamp = doc.started ? doc.startedAt : doc.date;
  const engineRestriction = engineStyles.find((e) => e.key === doc.engineRestriction);
  const survivalStyle = SURVIVAL_STYLES.find((s, i) => i === doc.survivalStyle);
  const ruleset = rulesets.find((r) => r.id === doc.ruleset);

  const lobbyRegions = [];
  doc.regions.forEach((dr) => {
    const region = regions.find((r) => r.key === dr);
    lobbyRegions.push(region.name);
  });

  const playersField = {
    name: `:busts_in_silhouette: Players (${doc.players.length} / ${doc.maxPlayerCount})`,
    value: playersText,
    inline: true,
  };

  const psnsField = {
    name: `:credit_card: Ranked Information`,
    value: psnAndRanks,
    inline: true,
  };

  const tracksField = {
    name: `:motorway: ${doc.isRacing() ? 'Tracks' : 'Arenas'}`,
    value: tracks,
    inline: true,
  };

  let roomField = {};

  if (roomChannel) {
    roomField = {
      name: ':key: Room',
      value: `${roomChannel.toString()}${doc.privateChannel ? ' [read-only]' : ''}`,
      inline: true,
    };
  }

  let creatorField;

  if (!doc.anonymous || doc.started) {
    creatorField = {
      name: ':bust_in_silhouette: Creator',
      value: `${creator && creator.flag ? creator.flag : ':united_nations:'} <@${doc.creator}>`,
      inline: true,
    };
  } else {
    creatorField = {
      name: ':bust_in_silhouette: Creator',
      value: ':united_nations: ???',
      inline: true,
    };
  }

  const averageRankField = {
    name: ':checkered_flag: Average Rank',
    value: await getAverageRank(doc),
    inline: true,
  };

  const settings = [
    `Max Players: **${doc.maxPlayerCount}**`,
    `${doc.isRacing() ? 'Track Count' : 'Arena Count'}: **${doc.trackCount}**`
  ];

  if (doc.isTeams()) {
    settings.push(`Team Creation: **${ucfirst(doc.teamCreation)}**`);
  }

  if (doc.isRacing()) {
    settings.push(`Lap Count: **${doc.lapCount}**`);
    settings.push(`Ruleset: ${ruleset.emote} **${ruleset.name}**`);

    if (engineRestriction) {
      settings.push(`Engine Style: **${engineRestriction.emote}**`);
    }

    if (survivalStyle) {
      settings.push(`Survival Style: **${survivalStyle}**`);
    }
  }

  if (lobbyRegions.length > 0) {
    settings.push(`Regions: **${lobbyRegions.join(', ')}**`);
  }

  if (!doc.locked.$isEmpty()) {
    const minRank = doc.locked.min;
    const maxRank = doc.locked.max;

    settings.push(`Rank Lock: **${minRank} - ${maxRank}**`);
  }

  if (doc.isTeams() && doc.reservedTeam) {
    settings.push(`Team Reservation: <@${doc.creator}> & <@${doc.reservedTeam}>`);
  }

  let settingsField = {};

  if (settings.length > 0) {
    settingsField = {
      name: ':video_game: Lobby Settings',
      value: settings.join('\n'),
      inline: true,
    };
  }

  if (tracks) {
    fields = [
      playersField,
      psnsField,
      tracksField,
      roomField,
      creatorField,
    ];

    if (doc.ranked) {
      fields.push(averageRankField);
    }

    if (settings.length > 0) {
      fields.push(settingsField);
    }

    const livestreams = await getLivestreams(doc);
    if (livestreams.length > 0) {
      fields.push({
        name: ':tv: Livestreams',
        value: livestreams.join('\n'),
        inline: true,
      });

      // add spacer so that the layout doesn't get fucked
      fields.push({
        name: '\u200B',
        value: '\u200B',
        inline: true,
      });
    }

    return {
      color: doc.getColor(),
      description: doc.description,
      author: {
        name: `${doc.getTitle()} has started`,
        icon_url: iconUrl,
      },
      image: {
        url: doc.getStartedIcon(),
      },
      fields: duoTournament ? splitTournamentFields(fields) : fields,
      footer: getFooter(doc),
      timestamp,
    };
  }

  if (players) {
    creatorField.inline = false;

    fields = [
      playersField,
      psnsField,
      creatorField,
    ];

    if (doc.ranked) {
      fields.push(averageRankField);
    }

    if (settings.length > 0) {
      fields.push(settingsField);
    }

    return {
      color: doc.getColor(),
      description: doc.description,
      author: {
        name: `Gathering ${doc.getTitle()}`,
        icon_url: iconUrl,
      },
      fields: duoTournament ? splitTournamentFields(fields) : fields,
      footer: getFooter(doc),
      timestamp,
    };
  }

  fields = [creatorField];

  if (settings.length > 0) {
    fields.push(settingsField);
  }

  return {
    color: doc.getColor(),
    title: 'Click on the ✅ button to join!',
    description: doc.description,
    author: {
      name: `${doc.getTitle()}`,
      icon_url: iconUrl,
    },
    fields,
    footer: getFooter(doc),
    timestamp,
  };
}

/**
 * Finds a free room for a lobby and assigns it to the lobby
 * @param lobby
 * @returns {*}
 */
function findRoom(lobby) {
  return withRoomLock(lobby.guild, async () => {
    // Ending a lobby can overtake its asynchronous startup.
    if (!await Lobby.findOne({ _id: lobby.id, started: true })) return null;
    const assigned = await Room.findOne({ lobby: lobby.id, guild: lobby.guild });
    if (assigned) return assigned;
    const doc = await Room.findOne({ lobby: null, guild: lobby.guild }).sort({ number: 1 });
    if (!doc) {
      return Sequence.findOneAndUpdate(
        { guild: lobby.guild, name: 'rooms' },
        { $inc: { number: 1 } },
        { upsert: true, new: true },
      ).then((seq) => {
        const room = new Room();
        room.lobby = lobby.id;
        room.guild = lobby.guild;
        room.number = seq.number;
        return room.save();
      });
    }

    // Claiming a room ends the previous lobby's chat grace period immediately.
    if (doc.cleanupAt) await releaseRoom(client.guilds.cache.get(lobby.guild), doc);
    doc.lobby = lobby.id;
    return doc.save();
  });
}

/**
 * Finds a room channel or creates a new one
 * @param doc Lobby
 * @param roomNumber Number
 * @returns {Promise<GuildChannel>}
 */
async function findRoomChannel(doc, roomNumber) {
  return withRoomLock(doc.guild, async () => {
    const room = await Room.findOne({ guild: doc.guild, number: roomNumber, lobby: doc.id });
    if (!room) return null;
    const guild = client.guilds.cache.get(doc.guild);
    const channelName = getRoomName(roomNumber);
    let category = guild.channels.cache.find((c) => c.name.toLowerCase() === config.channels.matchmaking_category.toLowerCase() && c.type === 'category');
    if (!category) {
      category = await guild.channels.create(config.channels.matchmaking_category, { type: 'category' });
    }

    let channel = getRoomChannel(guild, roomNumber);
    if (!channel) {
      const roleStaff = await guild.roles.findByName(config.roles.staff_role);
      const roleVerified = await guild.roles.findByName(config.roles.verified_player_role);
      const roleMatchmaking = await guild.roles.findByName(config.roles.matchmaking_role);

      channel = await guild.channels.create(channelName, {
        type: 'text',
        parent: category,
      });

      await channel.createOverwrite(roleStaff, { VIEW_CHANNEL: true, SEND_MESSAGES: true });
      await channel.createOverwrite(roleVerified, { VIEW_CHANNEL: true, SEND_MESSAGES: false });
      await channel.createOverwrite(roleMatchmaking, { VIEW_CHANNEL: true, SEND_MESSAGES: false });
      await channel.createOverwrite(guild.roles.everyone, { VIEW_CHANNEL: false, SEND_MESSAGES: false });
    }

    return channel;
  });
}

/**
 * Returns the text that gets sent into the lobby room when the lobby starts
 * @param doc
 * @returns {Promise<*>}
 */
async function getPlayersText(doc) {
  let playersText = '';

  if (doc.isTeams()) {
    playersText += '**Teams:**\n';

    // eslint-disable-next-line guard-for-in
    let teamNumber = 1;

    for (const team of doc.teamList) {
      if (team.length <= 0) {
        // eslint-disable-next-line no-continue
        continue;
      }

      let mmrSum = 0;

      // eslint-disable-next-line guard-for-in
      for (const playerId of team) {
        const player = await Player.findOne({ discordId: playerId });
        const rank = await Rank.findOne({ name: player.rankedName });

        let mmr = doc.getDefaultRank();
        if (rank && rank[doc.type] && rank[doc.type].rank) {
          mmr = rank[doc.type].rank;
        }

        mmrSum += mmr;
      }

      if (doc.ranked) {
        playersText += `${teamNumber}. [Rating: ${Math.floor(mmrSum / team.length)}]\n`;
      } else {
        playersText += `${teamNumber}. `;
      }

      // eslint-disable-next-line no-loop-func
      team.forEach((p) => {
        playersText += `<@${p}>\n`;
      });

      teamNumber += 1;
    }
  } else {
    playersText = doc.players.map((u, i) => `${i + 1}. <@${u}>`).join('\n');
  }

  return playersText;
}

/**
 * Returns an array of player ranks for a lobby
 * @param doc
 * @returns {Promise<*[]>}
 */
async function getPlayerRanks(doc) {
  const playerRanks = [];
  const players = doc.getSoloPlayers();

  for (const p of players) {
    const [, , rank] = await getPlayerInfo(p, doc);

    playerRanks.push({
      discordId: p,
      rank,
    });
  }

  return playerRanks.sort((a, b) => b.rank - a.rank);
}

/**
 * Sends an embed with battle mode settings into the lobby room
 * @param doc
 * @param roomChannel
 * @param modes
 */
function sendBattleModeSettings(doc, roomChannel, modes) {
  let list;

  if (doc.is1v1()) {
    list = battleModes1v1;
  } else if (!doc.isTeams()) {
    list = battleModesSolos;
  } else {
    list = battleModesTeams;
  }

  const embedFields = [];
  const entries = [];

  modes.forEach((mode) => {
    list.forEach((battleMode) => {
      const entry = battleMode.find((element) => element.name === mode);

      if (entry !== undefined && !entries.find((e) => e === mode)) {
        embedFields.push({
          name: mode,
          value: entry.settings.join('\n'),
        });

        entries.push(mode);
      }
    });
  });

  getConfigValue('battle_mode_settings_image', 'https://i.imgur.com/k56NKZc.jpg').then((image) => {
    roomChannel.send({
      embed: {
        color: doc.getColor(),
        description: '**Global Settings**\nAI: Disabled',
        author: {
          name: 'Battle Mode Settings',
        },
        image: {
          url: image,
        },
        fields: embedFields,
      },
    });
  });
}

/**
 * Gets the highest rank for each player in the lobby
 * @param doc
 * @returns Promise<*[]>
 */
async function getHighestPlayerRanks(doc, players) {
  const modePool = doc.getModePoolForTeamBalance();
  const playerRanks = [];

  for (const p of players) {
    let highestRank = 0;

    for (const gameMode of modePool) {
      let lobby = new Lobby();
      lobby.players = doc.players;
      lobby.type = gameMode;
      lobby.mode = doc.mode;

      const [, , rank] = await getPlayerInfo(p, lobby);

      if (rank > highestRank) {
        highestRank = rank;
      }
    }

    playerRanks.push({
      discordId: p,
      rank: highestRank,
    });
  }

  return playerRanks.sort((a, b) => b.rank - a.rank);
}

/**
 * Creates balanced teams
 * @param doc
 * @returns Promise<*[]>
 */
async function createBalancedTeams(doc) {
  const randomTeams = [];
  const playerRanks = await getHighestPlayerRanks(doc, doc.getSoloPlayers());
  const teamCount = (doc.getSoloPlayers().length / doc.getTeamSize());

  if (doc.isDuos()) {
    for (let i = 1; i <= teamCount; i += 1) {
      const firstPlayer = playerRanks.shift();
      const lastPlayer = playerRanks.pop();

      randomTeams.push([
        firstPlayer.discordId,
        lastPlayer.discordId,
      ]);
    }
  } else if (doc.isWar()) {
    if (teamCount > 1) {
      let result;

      if (!doc.is4v4()) {
        result = optimalPartition3(playerRanks, 'rank');
      } else {
        result = optimalPartition4(playerRanks, 'rank');
      }

      const playersA = result.A.map((a) => a.discordId);
      const playersB = result.B.map((b) => b.discordId);

      randomTeams.push([...playersA]);
      randomTeams.push([...playersB]);
    } else {
      const discordIds = playerRanks.map((s) => s.discordId);
      randomTeams.push([...discordIds]);
    }
  }

  return randomTeams;
}

/**
 * Creates random teams
 * @param doc
 * @return Array
 */
async function createRandomTeams(doc) {
  const randomTeams = [];
  const playerRanks = await getHighestPlayerRanks(doc, doc.getSoloPlayers());
  const teamCount = (doc.getSoloPlayers().length / doc.getTeamSize());

  for (let i = 1; i <= teamCount; i++) {
    const team = [];

    for (let x = 1; x <= doc.getTeamSize(); x++) {
      const ri = Math.floor(Math.random() * playerRanks.length);
      team.push(playerRanks[ri].discordId);
      playerRanks.splice(ri, 1);
    }

    randomTeams.push(team);
  }

  return randomTeams;
}

/**
 * Creates patchwork teams
 * @param Lobby doc
 * @returns Array 
 */
async function createPatchworkTeams(doc) {
  const patchworkTeams = [];
  const soloPlayers = doc.getSoloPlayers();
  const teams = doc.teamList;
  const matchedTeams = [];

  for (const teamA in doc.teamList) {
    const possibleMatches = [];

    if (matchedTeams.some((m) => compareArrays(m, teams[teamA]))) {
      continue;
    }

    /* Check other teams for possible matches */
    for (const teamB in teams) {
      if (matchedTeams.some((m) => compareArrays(m, teams[teamB])) || compareArrays(teams[teamA], teams[teamB])) {
        continue;
      }

      if (teams[teamA].length + teams[teamB].length === doc.getTeamSize()) {
        possibleMatches.push({
          team: teams[teamB],
          index: teamB,
          source: 'teamList'
        });
      }
    }

    /* Check solo queue for possible matches */
    const soloPlayerFillCount = doc.getTeamSize() - teams[teamA].length;

    if (soloPlayerFillCount <= 0) {
      patchworkTeams.push([...teams[teamA]]);
      continue
    }

    if (soloPlayers.length >= soloPlayerFillCount) {
      const randomTeams = [];
      const loops = Math.floor(soloPlayers.length / soloPlayerFillCount);

      for (let i = 1; i <= loops; i++) {
        let remainingPlayers = [...soloPlayers];
        const randomTeam = [];

        for (let x = 1; x <= soloPlayerFillCount; x++) {
          const randomPlayer = getRandomArrayElement(remainingPlayers);
          randomTeam.push(randomPlayer);
          remainingPlayers.splice(remainingPlayers.indexOf(randomPlayer), 1);
        }

        randomTeams.push(randomTeam);
      }

      for (const r in randomTeams) {
        possibleMatches.push({
          team: randomTeams[r],
          index: null,
          source: 'soloPlayers'
        });
      }
    }

    const randomMatch = getRandomArrayElement(possibleMatches);

    patchworkTeams.push(teams[teamA].concat(randomMatch.team));
    matchedTeams.push(teams[teamA]);

    /* Remove players and teams so they don't appear twice */
    if (randomMatch.source === 'teamList') {
      teams.splice(randomMatch.index, 1);
      matchedTeams.push(randomMatch.team);
    }

    if (randomMatch.source === 'soloPlayers') {
      for (let y = 0; y < randomMatch.team.length; y++) {
        soloPlayers.splice(soloPlayers.indexOf(randomMatch.team[y]), 1);
      }
    }
  }

  if (soloPlayers.length > 0) {
    patchworkTeams.push([...soloPlayers]);
  }

  return patchworkTeams;
}

/**
 * Sets up a tournament round
 * @param doc
 * @param roomChannel
 * @returns Promise<void>
 */
async function setupDuoTournamentRound(doc, roomChannel) {
  if (!doc.isTournament() || doc.maxPlayerCount !== 16 || ![8, 16].includes(doc.players.length)) {
    throw new Error('The duo tournament pilot requires 16 starting players and an 8-player final.');
  }
  validateDuoRoster(doc.players, doc.teamList, doc.players.length === 16);
  if (doc.getSoloPlayers().length) {
    const newTeams = doc.teamCreation === TEAM_CREATION_BALANCED
      ? await createBalancedTeams(doc) : await createRandomTeams(doc);
    doc.teamList = [...doc.teamList, ...newTeams];
  }
  validateDuoRoster(doc.players, doc.teamList);

  // Group placement uses each pair's mean normal-duos rating, not the highest
  // rating across other modes used by the existing solo-pairing algorithm.
  const ratings = new Map();
  for (const player of doc.players) {
    const record = await Player.findOne({ discordId: player });
    const rank = record && await Rank.findOne({ name: record.rankedName });
    const rating = rank && rank[RACE_ITEMS_DUOS] && rank[RACE_ITEMS_DUOS].rank;
    ratings.set(player, Number.isFinite(rating) ? rating : doc.getDefaultRank());
  }
  if (!doc.tournamentGroups.length) {
    const settings = new Lobby(doc.toObject());
    settings.mode = LOBBY_MODE_STANDARD;
    doc.tournamentGroups = balanceDuoGroups(doc.teamList, ratings);
    doc.tournamentTracks = await generateTracks(settings);
  }
  validateDuoRound(doc);
  doc.tournamentRoundReady = false;
  // Save pairs, groups and tracks before posting. A retry/restart must not reroll them.
  await doc.save();

  const pinnedMessages = await roomChannel.messages.fetchPinned();
  for (const pinned of pinnedMessages.values()) {
    if (pinned.author.id === client.user.id) await pinned.unpin();
  }
  const final = doc.players.length === 8;
  const ruleset = rulesets.find((rule) => rule.id === doc.ruleset);
  for (let i = 0; i < doc.tournamentGroups.length; i += 1) {
    const group = doc.tournamentGroups[i];
    const teams = doc.teamList.filter((team) => group.includes(team[0]));
    const players = teams.flat();
    const [PSNs, templateUrl, template] = await generateTemplate(players, doc, teams, ratings);
    const fields = [
      {
        name: 'Duos (average rating)',
        value: teams.map((team, index) => {
          const rating = (ratings.get(team[0]) + ratings.get(team[1])) / 2;
          return `**Team ${String.fromCharCode(65 + index)} [${Math.round(rating)}]** ${team.map((id) => `<@${id}>`).join(' & ')}`;
        }).join('\n'),
      },
      { name: 'PSN IDs & Ranks', value: PSNs.join('\n'), inline: true },
      { name: 'Tracks', value: doc.tournamentTracks.join('\n'), inline: true },
      { name: 'Settings', value: `Lap Count: ${doc.lapCount}\nRuleset: ${ruleset.name}`, inline: true },
      {
        name: 'Advancement',
        value: final ? 'The highest-scoring duo wins.' : 'The top two duos from each semifinal advance to the final.',
      },
    ];
    const code = `\`\`\`${template}\`\`\``;
    const link = `[Open template on gb.hlorenzi.com](${templateUrl})`;
    const files = [];
    // The template and its encoded URL can exceed one embed field even with 8 players.
    if (code.length <= 1024) fields.push({ name: 'Score Template', value: code });
    if (link.length <= 1024) fields.push({ name: 'Score Table', value: link });
    if (code.length > 1024 || link.length > 1024) {
      files.push({ attachment: Buffer.from(template, 'utf8'), name: `duos-${final ? 'final' : `semifinal-${i + 1}`}.txt` });
      fields.push({ name: 'Full Score Template', value: 'Copy the score template from the attached text file.' });
    }
    const posted = await roomChannel.send({
      content: players.map((id) => `<@${id}>`).join(', '),
      embed: { color: doc.getColor(), title: final ? 'Duos Tournament Final' : `Duos Tournament Semifinal ${i + 1}`, fields: splitTournamentFields(fields) },
      files,
    });
    await posted.pin();
  }
  doc.tournamentRoundReady = true;
  await doc.save();
}

async function advanceDuoTournament(lobbyId, message) {
  const mentions = message.mentions.users.map((user) => user.id);
  return lock.acquire(`tournament:${lobbyId}`, async () => {
    // Read under the lock so two commands cannot advance the same round twice.
    const doc = await Lobby.findOne({ _id: lobbyId });
    if (!doc || !doc.started || !doc.isTournament() || doc.type !== RACE_ITEMS_DUOS) {
      return message.channel.warn('This is not a started duo tournament.');
    }
    if (!message.member.isStaff() && doc.creator !== message.author.id) {
      return message.channel.warn('You need to be either a staff member or the lobby creator to use this command.');
    }
    const room = await Room.findOne({ guild: doc.guild, lobby: doc.id });
    const channel = room && getRoomChannel(client.guilds.cache.get(doc.guild), room.number);
    if (!channel) return message.channel.warn('The tournament room could not be found.');
    if (!doc.tournamentRoundReady) {
      if (mentions.length) {
        return message.channel.warn(`The round messages are not ready. Run \`!l advance ${doc.id}\` without mentions to retry posting them first.`);
      }
      await setupTournamentRound(doc, channel);
      return message.channel.success('The saved tournament round is ready. Play this round before selecting its winners.');
    }
    let teams;
    try {
      teams = getAdvancingDuos(doc, mentions);
    } catch (error) {
      return message.channel.warn(error.message);
    }
    const final = doc.players.length === 8;
    const winners = teams.flat().map((id) => `<@${id}>`).join(', ');
    if (final) {
      // Keep the final roster valid until cleanup succeeds, so a failed cleanup is retryable.
      await message.channel.success(`The winners of the tournament are ${winners}!`);
      return deleteLobby(doc, message);
    }
    const previousPlayers = [...doc.players];
    doc.teamList = teams;
    doc.players = teams.flat();
    doc.tournamentGroups = [];
    doc.tournamentTracks = [];
    doc.tournamentRoundReady = false;
    await saveTournamentAdvancement(client.guilds.cache.get(doc.guild), doc, previousPlayers);
    await setupTournamentRound(doc, channel);
    return message.channel.success(`The final is starting! Advancing duos: ${winners}`);
  }).catch(async (error) => {
    console.error('Could not advance duo tournament:', error);
    await message.channel.error(`Could not update the tournament. If round messages are missing, retry \`!l advance ${lobbyId}\` without mentions. Ask staff to check the lobby if the error continues.`);
  });
}

async function setupTournamentRound(doc, roomChannel) {
  if (doc.type === RACE_ITEMS_DUOS) {
    return setupDuoTournamentRound(doc, roomChannel);
  }
  const pinnedMessages = await roomChannel.messages.fetchPinned();
  pinnedMessages.forEach((pinnedMessage) => pinnedMessage.unpin());

  const engineRestriction = engineStyles.find((e) => e.key === doc.engineRestriction);
  const ruleset = rulesets.find((r, i) => i === doc.ruleset);

  let settings = [];
  if (doc.isRacing()) {
    settings = [
      `Lap Count: ${doc.lapCount}`,
      `Ruleset: ${ruleset.name}`,
    ];

    if (engineRestriction) {
      settings.push(`Engine Style: ${engineRestriction.emote}`);
    }
  }

  /* Create tracks based on the underlying format */
  const lobby = new Lobby(doc.toObject());
  lobby.mode = LOBBY_MODE_STANDARD;

  const tracks = await generateTracks(lobby);
  const lobbyCount = doc.players.length / lobby.getDefaultPlayerCount();

  if (doc.isSolos()) {
    /* Attempt MMR balancing */
    const playerRanks = await getPlayerRanks(doc);
    const distributedPlayers = greedyPartition(playerRanks, lobbyCount, lobby.getDefaultPlayerCount(), 'rank');

    const lobbyData = [];

    // eslint-disable-next-line no-plusplus
    for (let i = 1; i <= lobbyCount; i++) {
      const players = distributedPlayers[i - 1].map((d) => d.discordId);

      const [PSNs, templateUrl, template] = await generateTemplate(players, doc);

      lobbyData.push({
        players,
        PSNs,
        templateUrl,
        number: i,
        template,
      });
    }

    for (const l of lobbyData) {
      const embed = {
        color: doc.getColor(),
        title: `Lobby ${l.number}`,
        fields: [
          {
            name: 'PSN IDs & Ranks',
            value: l.PSNs.join('\n'),
            inline: true,
          },
          {
            name: 'Tracks',
            value: tracks.join('\n'),
            inline: true,
          },
        ],
      };

      if (settings.length > 0) {
        embed.fields.push({
          name: 'Settings',
          value: settings.join('\n'),
          inline: true,
        });
      }

      embed.fields.push({
        name: 'Score Template',
        value: `\`\`\`${l.template}\`\`\`\n[Open template on gb.hlorenzi.com](${l.templateUrl})`,
      });

      const pings = doc.players.map((m) => `<@!${m}>`).join(', ');
      roomChannel.send({ content: pings, embed }).then((m) => {
        m.pin();
      });
    }
  }
}

/**
 * Clears previous access and grants the current lobby access, if it still owns the room.
 * @param doc
 * @param roomChannel
 * @returns {Promise<boolean>}
 */
async function makeLobbyRoomPublic(doc, roomChannel) {
  const guild = client.guilds.cache.get(doc.guild);
  return withRoomLock(doc.guild, async () => {
    const room = await Room.findOne({ lobby: doc.id, guild: doc.guild });
    const assignedChannel = room && getRoomChannel(guild, room.number);
    if (!assignedChannel || assignedChannel.id !== roomChannel.id) return false;
    if (!await Lobby.findOne({ _id: doc.id, started: true })) return false;

    const channel = await clearRoomMemberPermissions(roomChannel);
    for (const p of doc.players) {
      const member = await guild.members.fetch(p);
      await channel.createOverwrite(member, { VIEW_CHANNEL: true, SEND_MESSAGES: true });
    }
    return true;
  });
}

function allowLobbyChat(doc, player, message) {
  const guild = client.guilds.cache.get(doc.guild);
  return withRoomLock(doc.guild, async () => {
    const activeLobby = await Lobby.findOne({ _id: doc.id, started: true });
    const room = await Room.findOne({ lobby: doc.id, guild: doc.guild });
    if (!activeLobby || !room) return message.channel.warn('This lobby no longer has an active room.');
    const cachedChannel = getRoomChannel(guild, room.number);
    if (!cachedChannel) return message.channel.warn('Could not find room channel.');
    const channel = await cachedChannel.fetch(true);
    if (channel.permissionOverwrites.has(player.id)) {
      return message.channel.warn(`You have already given chat permissions to <@!${player.id}>.`);
    }
    const member = await guild.members.fetch(player.id);
    await channel.createOverwrite(member, { SEND_MESSAGES: true });
    return message.channel.success(`You have given chat permissions to <@!${player.id}>.`);
  }).catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error('Could not grant lobby chat access:', error);
    // eslint-disable-next-line no-console
    await message.channel.error('Could not grant chat permissions. Please ask staff to check the room permissions.').catch(console.error);
  });
}

/**
 * Starts a lobby
 * @param docId
 */
function startLobby(docId) {
  // eslint-disable-next-line max-len
  return Lobby.findOneAndUpdate({ _id: docId, started: false }, {
    started: true,
    startedAt: new Date(),
  }, { new: true }).then((doc) => {
    if (!doc) return null;
    // eslint-disable-next-line max-len, arrow-body-style
    return client.guilds.cache.get(doc.guild).channels.cache.get(doc.channel).messages.fetch(doc.message).then((message) => {
      // eslint-disable-next-line arrow-body-style
      return generateTracks(doc).then((tracks) => {
        return findRoom(doc).then((room) => {
          if (!room) return null;
          return findRoomChannel(doc, room.number).then(async (roomChannel) => {
            if (!roomChannel) return;
            // remove all players from their other lobbies
            for (const playerId of doc.players) {
              const playerLobbies = await Lobby.find({
                _id: { $ne: doc._id },
                players: playerId,
              });

              for (const playerLobby of playerLobbies) {
                const lobbyMessage = await client.guilds.cache
                  .get(playerLobby.guild).channels.cache
                  .get(playerLobby.channel).messages
                  .fetch(playerLobby.message);

                const reaction = {
                  message: lobbyMessage,
                  users: null,
                };

                await mogi(reaction, { id: playerId }, true);
              }
            }

            if (!await makeLobbyRoomPublic(doc, roomChannel)) return;

            const joinLobbyButtonCopy = JSON.parse(JSON.stringify(joinLobbyButton));
            const leaveLobbyButtonCopy = JSON.parse(JSON.stringify(leaveLobbyButton));
            const deleteLobbyButtonCopy = JSON.parse(JSON.stringify(deleteLobbyButton));

            joinLobbyButtonCopy.disabled = true;
            leaveLobbyButtonCopy.disabled = true;
            deleteLobbyButtonCopy.disabled = true;

            const buttonRow = new MessageActionRow()
              .addComponent(joinLobbyButtonCopy)
              .addComponent(leaveLobbyButtonCopy)
              .addComponent(deleteLobbyButtonCopy);

            if (doc.isTournament()) {
              await roomChannel.info(`The ${doc.getTitle()} is starting!`, doc.players);
              await lock.acquire(`tournament:${doc.id}`, async () => {
                await setupTournamentRound(doc, roomChannel);
                await message.edit({
                  embed: await getEmbed(doc, doc.players, tracks, roomChannel),
                  components: [buttonRow],
                });
              });
            } else {
              // Display track column but blank all tracks
              if (doc.isWar() && doc.isDrafting()) {
                tracks = [];

                for (let i = 1; i <= doc.trackCount; i += 1) {
                  tracks.push('*N/A*');
                }
              }

              tracks = tracks.join('\n');

              if (doc.isTeams()) {
                let randomTeams = [];

                if (!doc.hasIncompleteTeams()) {
                  if (doc.teamCreation === TEAM_CREATION_BALANCED) {
                    randomTeams = await createBalancedTeams(doc);
                  } else {
                    randomTeams = await createRandomTeams(doc);
                  }

                  doc.teamList = Array.from(doc.teamList).concat(randomTeams);
                } else {
                  randomTeams = await createPatchworkTeams(doc);
                  doc.teamList = randomTeams;
                }
              }

              doc.number = await getLobbyNumber(doc.type);
              doc = await doc.save();

              const { players } = doc;
              const playersText = await getPlayersText(doc);

              const [PSNs, templateUrl, template] = await generateTemplate(players, doc);

              await message.edit({
                embed: await getEmbed(doc, players, tracks, roomChannel),
                components: [buttonRow],
              });

              const fields = [
                {
                  name: 'PSN IDs & Ranks',
                  value: PSNs.join('\n'),
                  inline: true,
                },
                {
                  name: doc.isRacing() ? 'Tracks' : 'Arenas',
                  value: tracks,
                  inline: true,
                },
              ];

              let modes = [];
              if (doc.isBattle()) {
                modes = await generateBattleModes(doc, tracks.split('\n'));

                fields.push({
                  name: 'Modes',
                  value: modes.join('\n'),
                  inline: true,
                });
              }

              const engineRestriction = engineStyles.find((e) => e.key === doc.engineRestriction);
              const survivalStyle = SURVIVAL_STYLES.find((s, i) => i === doc.survivalStyle);
              const ruleset = rulesets.find((r) => r.id === doc.ruleset);

              if (doc.isRacing()) {
                const settings = [
                  `Lap Count: ${doc.lapCount}`,
                  `Ruleset: ${ruleset.emote} (${ruleset.name})`,
                ];

                if (engineRestriction) {
                  settings.push(`Engine Style: ${engineRestriction.emote}`);
                }

                if (survivalStyle) {
                  settings.push(`Survival Style: ${survivalStyle}`);
                }

                fields.push({
                  name: 'Settings',
                  value: settings.join('\n'),
                  inline: true,
                });
              }

              roomChannel.send({
                content: `**The ${doc.getTitle()} has started**
Your room is ${roomChannel}.
Use \`!lobby end\` when your match is done.
${playersText}`,
                embed: {
                  color: doc.getColor(),
                  title: `The ${doc.getTitle()} has started`,
                  fields,
                },
              }).then((m) => {
                roomChannel.messages.fetchPinned().then((pinnedMessages) => {
                  pinnedMessages.forEach((pinnedMessage) => pinnedMessage.unpin());
                  m.pin();

                  roomChannel.send({
                    embed: {
                      color: doc.getColor(),
                      title: 'Score Template',
                      description: `\`\`\`${template}\`\`\`
  [Open template on gb.hlorenzi.com](${templateUrl})`,
                    },
                  }).then(async (templateMessage) => {
                    try {
                      await lobbyScoring.initialise(doc, roomChannel, templateMessage,
                        doc.isDrafting() ? [] : tracks.split('\n'));
                    } catch (error) {
                      console.error('Could not prepare optional button scoring:', error);
                      await roomChannel.warn('Button scoring could not be prepared. The existing score template is available for manual scoring.');
                    }
                    if (doc.isBattle()) {
                      sendBattleModeSettings(doc, roomChannel, modes);
                    }

                    if (doc.ranked) {
                      roomChannel.info(`Report any rule violations to ranked staff by sending a DM to <@!${config.bot_user_id}>.`);
                    }

                    // eslint-disable-next-line no-shadow
                    roomChannel.info('Select a scorekeeper. The scorekeeper can react to this message to make others aware that he is keeping scores. If nobody reacts to this message within 5 minutes the lobby will be ended automatically.').then((m) => {
                      let reacted = false;

                      setTimeout(() => {
                        if (!reacted) {
                          roomChannel.info('Don\'t forget to select your scorekeeper because otherwise the lobby will be ended soon.');
                        }
                      }, 240000);

                      m.react('✅');

                      let selectedScorekeeper;
                      const filter = (r, u) => {
                        if (r.emoji.name !== '✅' || !doc.players.includes(u.id) || u.bot || selectedScorekeeper) return false;
                        selectedScorekeeper = u.id;
                        return true;
                      };
                      const options = { maxUsers: 1, time: 300000, errors: ['time'] };

                      m.awaitReactions(filter, options).then(async () => {
                        reacted = true;
                        await lobbyScoring.selectScorekeeper(doc, roomChannel, selectedScorekeeper);
                        await m.delete();
                      }).catch((error) => {
                        if (reacted) {
                          console.error('Could not announce the selected scorekeeper:', error);
                          return roomChannel.warn('Could not announce the selected scorekeeper. Ask staff to check the error.');
                        }
                        // eslint-disable-next-line no-use-before-define
                        deleteLobby(doc, m);
                        m.delete();
                        roomChannel.warn('The lobby was ended automatically because nobody volunteered to keep scores.');
                      });
                    });

                    if (doc.isDrafting()) {
                      doc.initializeDraft(roomChannel);
                    }
                  });
                });
              });
            }
          });
        });
      });
    }).catch(async (error) => {
      // Keep the room reserved on failure; ending/resetting it must clean permissions first.
      // eslint-disable-next-line no-console
      console.error(`Could not start lobby ${doc.id}:`, error);
      const channel = client.guilds.cache.get(doc.guild).channels.cache.get(doc.channel);
      if (channel) {
        await channel.error(`Could not start lobby \`${doc.id}\`. Its room remains reserved if assigned. Staff should check bot permissions, then end the lobby or reset its room before retrying.`);
      }
    });
    // eslint-disable-next-line no-console
  }).catch(console.error);
}

function diffMinutes(dt2, dt1) {
  let diff = (dt2.getTime() - dt1.getTime()) / 1000;
  diff /= 60;
  return Math.abs(Math.round(diff));
}

function confirmLobbyStart(doc, message, override = false) {
  const minutes = diffMinutes(new Date(), doc.date);

  if (doc.started) {
    return message.channel.warn('The lobby has already been started.');
  }

  if (!override && minutes < FORCE_START_COOLDOWN) {
    return message.channel.warn(`You need to wait at least ${FORCE_START_COOLDOWN - minutes} more minutes to force start the lobby.`);
  }

  const playersCount = doc.players.length;

  if (doc.isTournament() && doc.type === RACE_ITEMS_DUOS
    && (playersCount !== 16 || doc.maxPlayerCount !== 16)) {
    return message.channel.warn('The duo tournament pilot requires exactly 16 players.');
  }

  if (doc.isDuos() && playersCount % 2 !== 0) {
    return message.channel.warn(`The lobby \`${doc.id}\` has ${playersCount} players.\nYou cannot start Duos lobby with player count not divisible by 2.`);
  }

  if (!doc.hasMinimumPlayerCount()) {
    return message.channel.warn(`You cannot start a ${doc.type} lobby with less than ${doc.getMinimumPlayerCount()} players.`);
  }

  if (override) {
    return startLobby(doc.id);
  }

  return message.channel.info(`The lobby \`${doc.id}\` has \`${playersCount}\` players. Are you sure you want to start it? Say \`yes\` or \`no\`.`).then(() => {
    const filter = (m) => m.author.id === message.author.id;
    const options = { max: 1, time: 60000, errors: ['time'] };

    // eslint-disable-next-line consistent-return
    message.channel.awaitMessages(filter, options).then((collected) => {
      const { content } = collected.first();
      if (content.toLowerCase() === 'yes') {
        if (doc.started) {
          return message.channel.warn('The lobby has already been started.');
        }

        message.channel.info('Generating tracks...').then((m) => m.delete({ timeout: 3000 }));
        startLobby(doc.id);
      } else {
        throw Error('cancel');
      }
    }).catch(() => message.channel.error('Command cancelled.'));
  });
}

function findLobby(lobbyID, isStaff, message, callback) {
  if (lobbyID) {
    let promise;

    if (isStaff) {
      promise = Lobby.findOne({ _id: lobbyID });
    } else {
      promise = Lobby.findOne({
        $or: [
          { _id: lobbyID, creator: message.author.id },
          { _id: lobbyID, started: true, players: message.author.id },
        ],
      });
    }

    return promise.then((doc) => {
      if (!doc) {
        if (isStaff) {
          return message.channel.warn('There is no lobby with this ID.');
        }

        return message.channel.warn('You don\'t have a lobby with this ID.');
      }

      return callback(doc, message);
    });
  } else {
    return Lobby.find({
      $or: [
        { creator: message.author.id },
        { started: true, players: message.author.id },
      ],
      // eslint-disable-next-line consistent-return
    }).then((docs) => {
      docs = docs.filter((doc) => {
        const guild = client.guilds.cache.get(doc.guild);
        if (!guild) {
          doc.delete();
          return false;
        }

        const channel = guild.channels.cache.get(doc.channel);
        if (!channel) {
          doc.delete();
          return false;
        }

        const docMessage = channel.messages.cache.get(doc.message);
        if (!docMessage) {
          doc.delete();
          return false;
        }

        return true;
      });

      if (!docs.length) {
        return message.channel.warn('You don\'t have any active lobbies!');
      }

      if (docs.length === 1) {
        const doc = docs.shift();
        return callback(doc, message);
      }

      if (docs.length > 1) {
        const lobbies = docs.map((d) => `\`${d.id}\` created by <@${d.creator}>`).join('\n');
        return message.channel.warn(`You have more than 1 active lobby. You should specify the ID.\n${lobbies}`);
      }
    });
  }
}

function deleteLobby(doc, message, sendMessage = true, messageDeleted = false, { delayRoomCleanup = false } = {}) {
  const guild = client.guilds.cache.get(doc.guild);
  return withRoomLock(doc.guild, async () => {
    // Both !l end and messageDelete can arrive for the same lobby. Re-read under
    // the shared lock so an old cleanup can never touch a reassigned room.
    doc = await Lobby.findOne({ _id: doc.id });
    if (!doc) return false;
    const room = await Room.findOne({ lobby: doc.id, guild: doc.guild });
    const delayCleanup = delayRoomCleanup && doc.started && !messageDeleted;
    const channel = room ? await releaseRoom(guild, room, { delayCleanup }) : null;

    let endMessage = 'Lobby ended.';
    if (doc.started && doc.ranked) {
      endMessage += ' Don\'t forget to submit your scores.';
    }
    if (channel && delayCleanup) {
      endMessage += ' Chat stays open for 5 minutes, or until another lobby reserves this room.';
    }

    if (doc.started && !messageDeleted) {
      const averageRank = await getAverageRank(doc);
      const finishedLobby = new FinishedLobby();
      finishedLobby.type = doc.type;
      finishedLobby.trackOption = doc.trackOption;
      finishedLobby.ruleset = doc.ruleset;
      finishedLobby.regions = doc.regions;
      finishedLobby.consoles = doc.consoles;
      finishedLobby.engineRestriction = doc.engineRestriction;
      finishedLobby.survivalStyle = doc.survivalStyle;
      finishedLobby.tournament = doc.isTournament();
      finishedLobby.ranked = doc.ranked;
      finishedLobby.averageRank = averageRank;
      finishedLobby.number = doc.number;
      await finishedLobby.save();
    }

    // Remove the record before the Discord message, so our own messageDelete
    // event does not initiate a second cleanup or archive the lobby twice.
    await doc.delete();
    if (!messageDeleted) {
      const lobbiesChannel = guild.channels.cache.get(doc.channel);
      if (lobbiesChannel) {
        try {
          const lobbyMessage = await lobbiesChannel.messages.fetch(doc.message);
          await lobbyMessage.delete();
        } catch (error) {
          if (error.code !== 10008) throw error; // Already-deleted message is harmless.
        }
      }
    }

    if (channel && (!message || !message.channel || message.channel.id !== channel.id)) {
      await channel.success(endMessage);
    }
    if (message && sendMessage) {
      await message.channel.success(endMessage);
    }
    return true;
  }).catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error('Could not end lobby:', error);
    const channel = (message && message.channel) || (guild && guild.channels.cache.get(doc.channel));
    if (channel) {
      // eslint-disable-next-line no-console
      await channel.error('Could not finish ending the lobby. A room whose permission cleanup failed remains reserved. Staff should check bot permissions and retry.').catch(console.error);
    }
    return false;
  });
}

module.exports = {
  name: 'lobby',
  description: 'Lobbies',
  guildOnly: true,
  aliases: ['mogi', 'l', 'lebby'],
  cooldown: 15,
  // eslint-disable-next-line consistent-return
  async execute(message, args) {
    let action = args[0];
    let custom = [];

    if (!action) {
      action = 'new';
    }

    if (action.toLowerCase() === 'score') return lobbyScoring.command(message, args.slice(1));

    if (action === 'custom') {
      action = 'new';

      args.shift();
      custom = args;

      const availableOptions = [
        CUSTOM_OPTION_MODE,
        CUSTOM_OPTION_TRACK_POOL,
        CUSTOM_OPTION_PLAYERS,
        CUSTOM_OPTION_RULESET,
        CUSTOM_OPTION_REGION,
        CUSTOM_OPTION_CONSOLES,
        CUSTOM_OPTION_BATTLE_MODES,
        CUSTOM_OPTION_RESERVE,
        CUSTOM_OPTION_ANONYMOUS,
        CUSTOM_OPTION_PRIVATE_CHANNEL,
        CUSTOM_OPTION_DESCRIPTION,
        CUSTOM_OPTION_TEAM_CREATION,
        CUSTOM_OPTION_TYPE,
        CUSTOM_OPTION_MMR_LOCK,
      ];

      const missingOption = custom.find((c) => !availableOptions.includes(c));
      if (missingOption) {
        return message.channel.warn(`The custom option \`${missingOption}\` does not exist. Available options are:\n\n${availableOptions.join('\n')}`);
      }

      if (args.length <= 0) {
        // show all options by default
        custom = availableOptions;
      }
    }

    const lobbyID = args[1];
    const { member } = message;

    const configValue = await getConfigValue('ranked_lobby_lock_date', new Date());
    const now = moment();
    if (configValue) {
      const lockDate = moment(configValue);

      if (lockDate.isValid() && lockDate >= now) {
        return message.channel.warn(`Matchmaking is temporarily closed until midnight CEST on ${lockDate.format('YYYY-MM-DD')}.`);
      }
    }

    const { guild } = message;
    const isSupporter = member.isSupporter();

    if (!message.member.isStaff()) {
      // eslint-disable-next-line max-len
      if (!message.channel.parent || (message.channel.parent && message.channel.parent.name.toLowerCase() !== config.channels.matchmaking_category.toLowerCase())) {
        return message.channel.warn('You can use this command only in the `Matchmaking` category.');
      }
    }

    action = action && action.toLowerCase();
    switch (action) {
      case 'new':
        // eslint-disable-next-line no-case-declarations
        const cooldown = await Cooldown.findOne({ guildId: guild.id, discordId: message.author.id, name: 'lobby' });
        if (!message.member.isStaff() && !isSupporter && cooldown && cooldown.count >= 1) {
          const updatedAt = moment(cooldown.updatedAt);
          updatedAt.add(config.lobby_creation_cooldown, 'm');
          const wait = moment.duration(now.diff(updatedAt));

          return message.channel.warn(`You cannot create multiple lobbies so often. You have to wait ${wait.humanize()}.`);
        }

        // eslint-disable-next-line consistent-return
        return message.channel.awaitMenuChoice('Please select the mode you want to play.', message.author.id, lobbyTypes, 1).then(async (selectedType) => {
          if (!selectedType) {
            message.delete();
            throw new Error();
          }

          // Initialize lobby here to be able to use model functions
          const lobby = new Lobby();
          lobby.guild = guild.id;
          lobby.creator = message.author.id;
          lobby.type = selectedType;

          let mode = LOBBY_MODE_STANDARD;
          if (lobby.hasTournamentsEnabled() && custom.includes(CUSTOM_OPTION_MODE)) {
            const modes = [
              {
                key: LOBBY_MODE_STANDARD,
                name: 'Standard Lobby',
                description: 'Standard Lobbies can have up to 8 players.',
                default: true,
              },
              {
                key: LOBBY_MODE_TOURNAMENT,
                name: 'Tournament Lobby',
                description: selectedType === RACE_ITEMS_DUOS
                  ? 'Duo tournaments have exactly 16 players (8 duos).'
                  : 'Tournament Lobbies can have up to 64 players.',
                default: false,
              },
            ];

            try {
              mode = await message.channel.awaitMenuChoice('Please select the lobby mode.', message.author.id, modes, 1);
              // eslint-disable-next-line no-empty
            } catch (e) {
            }
          }

          lobby.mode = mode;

          // eslint-disable-next-line max-len
          const lobbyTrackOptions = trackOptions.filter((t) => lobby.getTrackOptions().includes(t.key));
          let trackOption = lobby.getDefaultTrackOption();

          if (lobbyTrackOptions.length > 1 && custom.includes(CUSTOM_OPTION_TRACK_POOL)) {
            try {
              trackOption = await message.channel.awaitMenuChoice('Please select the track pool.', message.author.id, lobbyTrackOptions, 1);
              // eslint-disable-next-line no-empty
            } catch (e) {
            }
          }

          lobby.trackOption = trackOption;

          let maxPlayerCount = lobby.getDefaultPlayerCount();

          // eslint-disable-next-line max-len
          if (trackOption !== TRACK_OPTION_DRAFT && lobby.getMinimumPlayerCount() !== lobby.getMaxPlayerCount() && custom.includes(CUSTOM_OPTION_PLAYERS)) {
            let playerCounts = [];

            if (lobby.mode === LOBBY_MODE_TOURNAMENT) {
              playerCounts = [
                {
                  key: lobby.getMinimumPlayerCount(),
                  name: lobby.getMinimumPlayerCount(),
                  default: true,
                },
                {
                  key: lobby.getMinimumPlayerCount() * 2,
                  name: lobby.getMinimumPlayerCount() * 2,
                  default: false,
                },
                {
                  key: lobby.getMaxPlayerCount(),
                  name: lobby.getMaxPlayerCount(),
                  default: false,
                },
              ];
            } else {
              const count = lobby.getMaxPlayerCount() - lobby.getMinimumPlayerCount();
              for (let i = 0; i <= count; i += lobby.getTeamSize()) {
                const playerCount = lobby.getMinimumPlayerCount() + i;

                playerCounts.push({
                  key: playerCount,
                  name: playerCount,
                  default: playerCount === lobby.getDefaultPlayerCount(),
                });
              }
            }

            try {
              maxPlayerCount = await message.channel.awaitMenuChoice(
                'Please select the maximum number of players.',
                message.author.id,
                playerCounts,
                1,
              );
              // eslint-disable-next-line no-empty
            } catch (e) {
            }
          }

          lobby.maxPlayerCount = maxPlayerCount;

          lobby.trackCount = lobby.getDefaultTrackCount();
          lobby.lapCount = lobby.getDefaultLapCount();

          let ruleset = 1;
          if (!lobby.isBattle() && custom.includes(CUSTOM_OPTION_RULESET)) {
            try {
              const rulesetOptions = rulesets.filter((r) => r.rankedEnabled);

              const rulesetKey = await message.channel.awaitMenuChoice('Please select the ruleset.', message.author.id, rulesetOptions, 1);
              const rulesetEntry = rulesets.find((r) => r.key === rulesetKey);

              ruleset = rulesetEntry.id;
              // eslint-disable-next-line no-empty
            } catch (e) {
            }
          }

          lobby.ruleset = ruleset;

          let lobbyRegions = null;
          if (custom.includes(CUSTOM_OPTION_REGION)) {
            try {
              lobbyRegions = await message.channel.awaitMenuChoice(
                'Please select the regions that can join your lobby.',
                message.author.id,
                regions,
                4,
              );

              if (lobbyRegions.includes('regionFree')) {
                lobbyRegions = null;
              }
              // eslint-disable-next-line no-empty
            } catch (e) {
            }
          }

          if (lobbyRegions) {
            lobby.regions = lobbyRegions;
          }

          lobby.engineRestriction = null;
          lobby.survivalStyle = (lobby.isSurvival() && lobby.isRacing() ? 1 : null);

          let lobbyConsoles = null;
          const lockAvailableConsoles = consoles.filter((c) => c.lockAvailable);

          if (custom.includes(CUSTOM_OPTION_CONSOLES) && lockAvailableConsoles.length > 0) {
            try {
              lobbyConsoles = await message.channel.awaitMenuChoice(
                'Please select the consoles that players require to join your lobby.',
                message.author.id,
                lockAvailableConsoles,
                lockAvailableConsoles.length
              );
            } catch (e) {
            }
          }

          if (lobbyConsoles) {
            lobby.consoles = lobbyConsoles;
          }

          let limitAndLKDOnly = false;
          if (lobby.isBattle() && custom.includes(CUSTOM_OPTION_BATTLE_MODES)) {
            try {
              const buttonId = await message.channel.awaitButtonChoice(
                'Do you want to restrict the battle mode selection to Last Kart Driving and Limit Battle?',
                message.author.id,
                [yesButton, noButton],
              );

              limitAndLKDOnly = (buttonId === 'yes');
              // eslint-disable-next-line no-empty
            } catch (e) {
            }
          }

          lobby.limitAndLKDOnly = limitAndLKDOnly;
          lobby.allowPremadeTeams = !lobby.isInsta();

          let reservedTeam = null;

          // eslint-disable-next-line max-len
          if (lobby.isWar() && !lobby.is1v1() && !lobby.isInsta() && custom.includes(CUSTOM_OPTION_RESERVE)) {
            let reserveLobby = false;

            try {
              const buttonId = await message.channel.awaitButtonChoice(
                'Do you want to reserve the lobby for an existing team?',
                message.author.id,
                [yesButton, noButton],
              );

              reserveLobby = (buttonId === 'yes');
              // eslint-disable-next-line no-empty
            } catch (e) {
            }

            if (reserveLobby) {
              let discordId;

              try {
                const collectedMessage = await message.channel.awaitTextInput('Please mention one of the team members.', message.author.id);
                const mentionedUser = collectedMessage.mentions.users.first();
                if (mentionedUser) {
                  discordId = mentionedUser.id;
                }
              } catch (e) {
                discordId = null;
              }

              if (discordId === null) {
                return message.channel.warn('You need to mention a user.');
              }

              if (discordId === message.author.id) {
                return message.channel.warn('You cannot mention yourself.');
              }

              reservedTeam = discordId;
            }
          }

          lobby.reservedTeam = reservedTeam;

          let anonymous = false;
          if (custom.includes(CUSTOM_OPTION_ANONYMOUS)) {
            try {
              const buttonId = await message.channel.awaitButtonChoice(
                'Do you want to create an anonymous lobby?',
                message.author.id,
                [yesButton, noButton],
              );

              anonymous = (buttonId === 'yes');
              // eslint-disable-next-line no-empty
            } catch (e) {
            }
          }

          lobby.anonymous = anonymous;

          let privateChannel = true;
          if (custom.includes(CUSTOM_OPTION_PRIVATE_CHANNEL)) {
            try {
              const buttonId = await message.channel.awaitButtonChoice(
                'Do you want to use a private lobby channel?',
                message.author.id,
                [yesButton, noButton],
              );

              privateChannel = (buttonId === 'yes');
              // eslint-disable-next-line no-empty
            } catch (e) {
            }
          }

          lobby.privateChannel = privateChannel;

          let description = null;
          if (custom.includes(CUSTOM_OPTION_DESCRIPTION)) {
            try {
              const collectedMessage = await message.channel.awaitTextInput('Please enter the lobby description.', message.author.id);
              description = collectedMessage.content;
              // eslint-disable-next-line no-empty
            } catch (e) {
            }

            if (description && description.length > 150) {
              return message.channel.warn('The lobby description cannot be longer than 100 characters.');
            }
          }

          lobby.description = description;

          let teamCreation = TEAM_CREATION_BALANCED;
          if (lobby.isTeams() && custom.includes(CUSTOM_OPTION_TEAM_CREATION)) {
            const teamCreationOptions = [
              {
                key: TEAM_CREATION_BALANCED,
                name: 'Balanced',
                description: 'Both teams will have a similar average rank.',
                default: true,
              },
              {
                key: TEAM_CREATION_RANDOM,
                name: 'Random',
                description: 'Teams will be generated completely at random.',
                default: false,
              },
            ];

            try {
              teamCreation = await message.channel.awaitMenuChoice('Please select the team creation method.', message.author.id, teamCreationOptions, 1);
            } catch (e) {
            }
          }

          lobby.teamCreation = teamCreation;

          let ranked = lobby.canBeRanked();
          if (lobby.canBeRanked() && custom.includes(CUSTOM_OPTION_TYPE)) {
            try {
              const buttonId = await message.channel.awaitButtonChoice(
                'Do you want to create a ranked lobby?',
                message.author.id,
                [yesButton, noButton],
              );

              ranked = (buttonId === 'yes');
              // eslint-disable-next-line no-empty
            } catch (e) {
            }
          }

          lobby.ranked = ranked;

          let mmrLock = false;
          let minRank = null;
          let maxRank = null;

          if (ranked && custom.includes(CUSTOM_OPTION_MMR_LOCK)) {
            try {
              const buttonId = await message.channel.awaitButtonChoice(
                'Do you want to put a rank restriction on your lobby?',
                message.author.id,
                [yesButton, noButton],
              );

              mmrLock = (buttonId === 'yes');
            } catch (e) {
              mmrLock = false;
            }

            if (mmrLock) {
              try {
                const collectedMessage = await message.channel.awaitTextInput('Please enter the minimum allowed rank.', message.author.id);
                minRank = Number(collectedMessage.content);
                // eslint-disable-next-line no-empty
              } catch (e) {
              }

              try {
                const collectedMessage = await message.channel.awaitTextInput('Please enter the maximum allowed rank.', message.author.id);
                maxRank = Number(collectedMessage.content);
                // eslint-disable-next-line no-empty
              } catch (e) {
              }

              if (maxRank < minRank) {
                return message.channel.warn('The max rank can not be lower than the minimum rank.');
              }
            }
          }

          if (mmrLock) {
            if (Number.isNaN(minRank)) {
              minRank = 0;
            }

            if (Number.isNaN(maxRank)) {
              maxRank = 2500;
            }

            lobby.locked = {
              min: minRank,
              max: maxRank,
            };
          }

          await Cooldown.findOneAndUpdate(
            { guildId: guild.id, discordId: message.author.id, name: 'lobby' },
            { $inc: { count: 1 }, $set: { updatedAt: now } },
            { upsert: true, new: true },
          );

          lobby.save().then(async (doc) => {
            let roles = null;

            if (lobby.ranked) {
              roles = [await guild.roles.findByName(lobby.getRoleName())];

              if (lobby.isInsta()) {
                roles.push(await guild.roles.findByName(config.roles.instateam_role));
              }
            }

            let channel;
            if (lobby.ranked) {
              // eslint-disable-next-line max-len
              channel = guild.channels.cache.find((c) => c.name === config.channels.ranked_lobbies_channel);
            } else {
              // eslint-disable-next-line max-len
              channel = guild.channels.cache.find((c) => c.name === config.channels.unranked_lobbies_channel);
            }

            const buttonRow = new MessageActionRow()
              .addComponent(joinLobbyButton)
              .addComponent(leaveLobbyButton)
              .addComponent(deleteLobbyButton);

            channel.send({
              content: roles,
              embed: await getEmbed(doc),
              components: [buttonRow],
            }).then((m) => {
              doc.channel = m.channel.id;
              doc.message = m.id;
              doc.save().then(() => {
                message.channel.success(`${lobby.getTitle()} has been created. Don't forget to click on the ✅ button!`);
              });
            });
          });
        }).catch(() => message.channel.error('Command cancelled.'));

      case 'start':
        findLobby(lobbyID, message.member.isStaff(), message, confirmLobbyStart);
        break;
      case 'override':
        if (message.member.isStaff()) {
          // eslint-disable-next-line max-len
          findLobby(lobbyID, message.member.isStaff(), message, (d, m) => confirmLobbyStart(d, m, true));
        } else {
          return message.channel.warn('You don\'t have permissions to do that.');
        }
        break;
      case 'allow_chat':
      case 'chat':
        findLobby(null, message.member.isStaff(), message, (doc, msg) => {
          if (message.author.id !== doc.creator && !message.member.isStaff()) {
            return message.channel.warn('Only the lobby creator can use this command.');
          }

          if (!doc.started) {
            return message.channel.warn('You can only do this when the lobby has started.');
          }

          const player = message.mentions.users.first();

          if (!player) {
            return message.channel.warn('You need to mention a player.');
          }

          return allowLobbyChat(doc, player, message);
        });
        break;
      case 'end':
        // eslint-disable-next-line consistent-return
        findLobby(lobbyID, message.member.isStaff(), message, (doc, msg) => {
          if (doc.started) {
            const minutes = diffMinutes(new Date(), doc.startedAt);
            const confirmationMinutes = doc.getLobbyEndCooldown();

            if (confirmationMinutes === null || minutes < confirmationMinutes) {
              // eslint-disable-next-line consistent-return
              Room.findOne({ lobby: doc.id }).then((room) => {
                if (!room) {
                  return deleteLobby(doc, msg, true, false, { delayRoomCleanup: true });
                }

                // eslint-disable-next-line max-len
                const roomChannel = message.guild.channels.cache.find((c) => c.name.toLowerCase() === getRoomName(room.number).toLowerCase());
                if (roomChannel) {
                  const requiredReactions = Math.ceil((doc.players.length - 1) * 0.75);

                  roomChannel.info(`I need reactions from ${requiredReactions} other people to confirm ending the lobby.`, doc.players).then((voteMessage) => {
                    voteMessage.react('✅');

                    // eslint-disable-next-line no-shadow
                    const filter = (r, u) => ['✅'].includes(r.emoji.name) && doc.players.includes(u.id) && u.id !== message.author.id;
                    voteMessage.awaitReactions(filter, {
                      maxUsers: requiredReactions,
                      time: 60000,
                      errors: ['time'],
                      // eslint-disable-next-line consistent-return
                    }).then(() => {
                      if (voteMessage.deleted) {
                        return roomChannel.error('Command cancelled. Stop abusing staff powers.');
                      }

                      deleteLobby(doc, msg, true, false, { delayRoomCleanup: true });
                    }).catch(() => {
                      voteMessage.channel.error('Command cancelled.');
                    });
                  });
                }
              });
            } else {
              deleteLobby(doc, msg, true, false, { delayRoomCleanup: true });
            }
          } else {
            return deleteLobby(doc, msg, true, false, { delayRoomCleanup: true });
          }
        });
        break;
      case 'quit':
      case 'leave':
        // eslint-disable-next-line consistent-return
        findLobby(lobbyID, message.member.isStaff(), message, (doc) => {
          if (!doc) {
            return message.channel.warn('There is no lobby with this ID.');
          }

          if (!doc.started) {
            return message.channel.warn('You cannot quit a lobby that has not been started.');
          }

          if (!doc.isSurvival()) {
            return message.channel.warn('You can only quit survival lobbies.');
          }

          doc.players = doc.players.filter((p) => p !== message.author.id);
          doc.save().then(() => {
            message.channel.success('You were removed from the lobby.');

            if (doc.players.length <= 1) {
              deleteLobby(doc, message);
            }
          }).catch(() => {
            message.channel.error('Something went wrong when removing you from the lobby.');
          });
        });
        break;
      case 'advance':
        // eslint-disable-next-line consistent-return
        return findLobby(lobbyID && /^<@!?\d+>$/.test(lobbyID) ? null : lobbyID, message.member.isStaff(), message, (doc) => {
          if (!doc) {
            return message.channel.warn('You are not in a tournament lobby.');
          }

          if (doc.type === RACE_ITEMS_DUOS) {
            return advanceDuoTournament(doc.id, message);
          }

          if (!doc.started || !doc.isTournament()) {
            return message.channel.warn('You can only advance a started tournament.');
          }

          if (!message.member.isStaff() && doc.creator !== message.author.id) {
            return message.channel.warn('You need to be either a staff member or the lobby creator to use this command.');
          }

          const users = message.mentions.users.map((u) => u.id);
          const lobby = new Lobby(doc.toObject());
          lobby.mode = LOBBY_MODE_STANDARD;

          let advanceCount;
          if (doc.players.length <= lobby.getDefaultPlayerCount()) {
            advanceCount = doc.getTeamSize();
          } else {
            advanceCount = doc.players.length / 2;
          }

          if (new Set(users).size !== advanceCount || users.some((id) => !doc.players.includes(id))) {
            return message.channel.warn(`You need to mention ${advanceCount} players.`);
          }

          const previousPlayers = [...doc.players];
          doc.players = doc.players.filter((p) => users.includes(p));
          const save = advanceCount === doc.getTeamSize() ? doc.save()
            : saveTournamentAdvancement(client.guilds.cache.get(doc.guild), doc, previousPlayers);
          return save.then(async () => {
            if (advanceCount === doc.getTeamSize()) {
              message.channel.success(`The winner of the tournament is <@${doc.players.join(',')}>!`);
              await deleteLobby(doc, message);
            } else {
              message.channel.success('The next round is starting!');
              await setupTournamentRound(doc, message.channel);
            }
          }).catch(() => {
            message.channel.error('Something went wrong when advancing players.');
          });
        });
      case 'update_ranks':
        if (!message.member.isStaff()) {
          return message.channel.warn('You need to be a staff member to use this command.');
        }

        // eslint-disable-next-line no-use-before-define
        getRanks().then(() => {
          message.channel.success('All ranks have been updated.');
        });
        break;
      case 'reroll_arenas':
      case 'reroll_tracks':
         // eslint-disable-next-line consistent-return
        findLobby(lobbyID, message.member.isStaff(), message, (doc) => {
          if (!doc.started) {
            return message.channel.warn(`You cannot reroll ${doc.isRacing() ? 'tracks' : 'arenas'} for a lobby that has not been started.`);
          }

          if (doc.canRerollTracks()) {
            Room.findOne({ lobby: doc.id }).then((room) => {
              if (!room) {
                return;
              }

              // eslint-disable-next-line max-len
              const roomChannel = message.guild.channels.cache.find((c) => c.name.toLowerCase() === getRoomName(room.number).toLowerCase());
              if (roomChannel) {
                const requiredReactions = doc.players.length - 1;

                roomChannel.info(`I need reactions from ${requiredReactions} other people to confirm rerolling the ${doc.isRacing() ? 'tracks' : 'arenas'} for this lobby.`, doc.players).then((voteMessage) => {
                  voteMessage.react('✅');

                  // eslint-disable-next-line no-shadow
                  const filter = (r, u) => ['✅'].includes(r.emoji.name) && doc.players.includes(u.id) && u.id !== message.author.id;
                  voteMessage.awaitReactions(filter, {
                    maxUsers: requiredReactions,
                    time: 60000,
                    errors: ['time'],
                    // eslint-disable-next-line consistent-return
                  }).then(() => {
                    if (voteMessage.deleted) {
                      return roomChannel.error('Command cancelled. Stop abusing staff powers.');
                    }

                    generateTracks(doc).then(async (tracks) => {
                      await lobbyScoring.setTracks(doc, tracks);
                      const embed = {
                        color: doc.getColor(),
                        title: `New ${doc.isRacing() ? 'Track' : 'Arena'} List`,
                        fields: [
                          {
                            name: doc.isRacing() ? 'Tracks' : 'Arenas',
                            value: tracks.join('\n'),
                            inline: true,
                          },
                        ],
                      };

                      roomChannel.send({ embed }).then((m) => {
                        m.pin();

                        roomChannel.success(`${doc.isRacing() ? 'Tracks' : 'Arenas'} have been rerolled successfully.`);
                      });
                    }).catch((error) => roomChannel.warn(error.message));
                  }).catch(() => {
                    voteMessage.channel.error('Command cancelled.');
                  });
                });
              }
            });
          } else {
            return message.channel.warn(`You cannot reroll ${doc.isRacing() ? 'tracks' : 'arenas'} for this lobby.`);
          }
        });
        break;
      case 'force_add':
        // eslint-disable-next-line consistent-return
        findLobby(lobbyID, message.member.isStaff(), message, (doc) => {
          if (!message.member.isStaff()) {
            return message.channel.warn('You need to be a staff member to use this command.');
          }

          if (!config.enable_debug) {
            return message.channel.warn('This is a debug feature. You cannot use it in production.');
          }

          if (!doc) {
            return message.channel.warn('There is no lobby with this ID.');
          }

          const forced = message.mentions.users.first();
          
          if (!forced) {
            return message.channel.warn('You need to mention a user.');
          }

          if (doc.started) {
            return message.channel.warn('You cannot force a user into a lobby that has already been started.');
          }

          if (doc.players.includes(forced.id)) {
            return message.channel.warn(`<@!${forced.id}> already joined this lobby.`);
          }

          // eslint-disable-next-line max-len
          client.guilds.cache.get(doc.guild).channels.cache.get(doc.channel).messages.fetch(doc.message).then((lobbyMessage) => {
            const reaction = {
              message: lobbyMessage,
              users: null,
            };

            // eslint-disable-next-line no-use-before-define
            mogi(reaction, forced);
          });
        });
        break;
      default:
        break;
    }
  },
};

async function restrictSoloQueue(doc, user, soloQueue) {
  const errors = [];
  const player = await Player.findOne({ discordId: user.id });

  if (doc.reservedTeam) {
    if (![doc.creator, doc.reservedTeam].includes(user.id)) {
      errors.push(`This lobby is reserved for <@!${doc.creator}>'s and <@!${doc.reservedTeam}>'s teams.`);
    } else {
      errors.push('This lobby is reserved for your team. Please set your team members or partner first.');
    }
  }

  if (!doc.locked.$isEmpty()) {
    let rank = doc.getDefaultRank();

    if (player && player.rankedName) {
      const playerRank = await Rank.findOne({ name: player.rankedName });

      if (playerRank && playerRank[doc.type] && Number.isFinite(playerRank[doc.type].rank)) {
        // eslint-disable-next-line prefer-destructuring
        rank = playerRank[doc.type].rank;
      }
    }

    const minRank = doc.locked.min;
    const maxRank = doc.locked.max;
    const rankTooLow = rank < minRank;
    const rankTooHigh = rank > maxRank;

    if (rankTooLow || rankTooHigh) {
      errors.push(`Your rank is too ${rankTooLow ? 'low' : 'high'}.`);
    }
  }

  if (!doc.isBattle() && !doc.isItemless()) {
    if (!player || (player && !player.discordVc && !player.ps4Vc)) {
      errors.push('You are unable to use voice chat. Please set your voice chat options first by using `!set_voice_chat`.');
    }

    let playerLanguages;
    if (player) {
      playerLanguages = player.languages || [];
    } else {
      playerLanguages = [];
    }

    if (playerLanguages.length <= 0) {
      errors.push('You need to set your languages first. You can do so by using `!set_languages`.');
    }

    if (soloQueue.length >= 1) {
      const soloQueuers = await Player.find({ discordId: { $in: soloQueue } });

      const referenceLanguages = [];
      const languages = [];
      let compatibleLanguage = false;

      // Check all languages of all players,
      // find those languages that everyone speaks
      // and check if the player who wants to join speaks any of those languages
      soloQueuers.forEach((p) => {
        const soloQueuerLanguages = p.languages || [];

        soloQueuerLanguages.forEach((l) => {
          if (languages[l]) {
            languages[l].count += 1;
          } else {
            languages[l] = {
              language: l,
              count: 1,
            };
          }

          if (languages[l].count === soloQueue.length) {
            referenceLanguages.push(languages[l]);

            referenceLanguages.forEach((r) => {
              playerLanguages.forEach((pl) => {
                if (r.language === pl) {
                  compatibleLanguage = true;
                }
              });
            });
          }
        });
      });

      if (!compatibleLanguage) {
        errors.push('You don\'t speak the same language as the other players. You can set your language by using `!set_languages`.');
      }

      const soloQueuerVcs = { discord: 0, ps4: 0 };
      let compatibleVc = false;

      soloQueuers.forEach((p) => {
        soloQueuerVcs.discord += p.discordVc ? 1 : 0;
        soloQueuerVcs.ps4 += p.ps4Vc ? 1 : 0;

        // eslint-disable-next-line max-len
        if ((soloQueuerVcs.discord === soloQueue.length && player.discordVc) || (soloQueuerVcs.ps4 === soloQueue.length && player.ps4Vc)) {
          compatibleVc = true;
        }
      });

      if (!compatibleVc) {
        errors.push('You are unable to use the same voice chat as the other players. You can set your voice chat options by using `!set_voice_chat`.');
      }
    }
  }

  return errors;
}

client.on('clickButton', async (b) => {
  switch (b.id) {
    case 'join_lobby':
      // eslint-disable-next-line max-len
      client.guilds.cache.get(b.guild.id).channels.cache.get(b.message.channel.id).messages.fetch(b.message.id).then(async (lobbyMessage) => {
        const reaction = {
          message: lobbyMessage,
          users: null,
        };

        // eslint-disable-next-line no-use-before-define
        await mogi(reaction, b.clicker.user);
        await b.reply.defer(true);
      });
      break;
    case 'leave_lobby':
      // eslint-disable-next-line max-len
      client.guilds.cache.get(b.guild.id).channels.cache.get(b.message.channel.id).messages.fetch(b.message.id).then(async (lobbyMessage) => {
        const reaction = {
          message: lobbyMessage,
          users: null,
        };

        // eslint-disable-next-line no-use-before-define
        await mogi(reaction, b.clicker.user, true);
        await b.reply.defer(true);
      });
      break;
    case 'delete_lobby':
      // eslint-disable-next-line max-len
      client.guilds.cache.get(b.guild.id).channels.cache.get(b.message.channel.id).messages.fetch(b.message.id).then(async (lobbyMessage) => {
        const doc = await Lobby.findOne({ message: lobbyMessage.id });

        if (!doc) {
          await lobbyMessage.delete();
          await b.reply.defer(true);
        } else {
          if (!doc.started) {
            if (doc.creator === b.clicker.user.id || b.clicker.member.isStaff()) {
              deleteLobby(doc, lobbyMessage, false);
            } else {
              await b.reply.send('You do not have permission to do that.', { ephemeral: true });
            }
          } else if (b.clicker.member.isStaff()) {
            deleteLobby(doc, lobbyMessage, false);
          } else {
            await b.reply.send('You do not have permission to do that.', { ephemeral: true });
          }
        }
      });
      break;
    default:
      break;
  }
});

async function mogi(reaction, user, removed = false) {
  if (user.id === client.user.id) {
    return;
  }

  const { message } = reaction;
  if (message.author.id === client.user.id) {
    const conditions = {
      guild: message.guild.id,
      channel: message.channel.id,
      message: message.id,
      started: false,
      closed: false,
    };

    const { guild } = message;

    // eslint-disable-next-line max-len
    let notificationChannel = guild.channels.cache.find((c) => c.name.toLowerCase() === config.channels.matchmaking_notifications_channel.toLowerCase());
    if (!notificationChannel) {
      // eslint-disable-next-line max-len
      notificationChannel = await guild.channels.create(config.channels.matchmaking_notifications_channel);
    }

    return Lobby.findOne(conditions).then(async (doc) => {
      if (doc) {
        const errors = [];

        if (!removed) {
          const member = await guild.members.fetch(user.id);
          if (!member) return;
          
          if (doc.ranked) {
            const banned = await RankedBan.findOne({ discordId: member.id, guildId: guild.id });

            if (banned) {
                // eslint-disable-next-line max-len
                const lobbiesChannel = guild.channels.cache.find((c) => c.name === config.channels.ranked_lobbies_channel);
                await lobbiesChannel.createOverwrite(user, { VIEW_CHANNEL: false });
                errors.push('You cannot join ranked lobbies while you are banned from playing ranked.');
            }
          }

          const player = await Player.findOne({ discordId: user.id });

          if (!player || !player.rankedName) {
            errors.push('You need to set your ranked name. Example: `!set_ranked_name your_ranked_name`.');
          }

          if (!player || !player.psn) {
            errors.push('You need to set your PSN. Example: `!set_psn ctr_tourney_bot`.');
          }

          if (doc.regions.length > 0) {
            if (!player || !player.region) {
              errors.push('You need to set your region because the lobby you are trying to join is region locked. Use `!set_region` and then follow the bot instructions.');
            } else if (!doc.regions.includes(player.region)) {
              const lobbyRegions = [];
              doc.regions.forEach((dr) => {
                const region = regions.find((r) => r.key === dr);
                lobbyRegions.push(region.name);
              });

              const playerRegion = regions.find((r) => r.key === player.region);
              errors.push(`The lobby you are trying to join is locked to ${lobbyRegions.join(', ')} and you are from ${playerRegion.name}.`);
            }
          }

          if (doc.consoles.length > 0) {
            if (!player || !player.consoles.length) {
              errors.push('You need to set your consoles because the lobby you are trying to join is console locked. Use `!set_consoles` and then follow the bot instructions.');
            } else if (!doc.consoles.some((c) => player.consoles.includes(c))) {
              const lobbyConsoles = [];
              doc.consoles.forEach((dc) => {
                const c = consoles.find((r) => r.key === dc);
                lobbyConsoles.push(c.name);
              });

              const playerConsoles = player.consoles.map((pc) => {
                const playerConsole = consoles.find((c) => c.key === pc);
                return playerConsole.name;
              });

              errors.push(`The lobby you are trying to join is locked to ${lobbyConsoles.join(', ')} but you only play on ${playerConsoles.join(', ')}.`);
            }
          }

          if (doc.anonymous && (!player || !player.region)) {
            errors.push('You need to set your region before you can join an anonymous lobby.');
          }

          // eslint-disable-next-line max-len
          const repeatLobby = await Lobby.findOne({ guild: guild.id, players: user.id, _id: { $ne: doc._id }, started: true });

          if (repeatLobby) {
            errors.push('You are already in a lobby that has been started.');
          }

          // eslint-disable-next-line max-len
          if (doc.ranked && !doc.locked.$isEmpty() && doc.isSolos() && player.rankedName) {
            const playerRank = await Rank.findOne({ name: player.rankedName });

            let rank = doc.getDefaultRank();
            if (playerRank && playerRank[doc.type] && Number.isFinite(playerRank[doc.type].rank)) {
              // eslint-disable-next-line prefer-destructuring
              rank = playerRank[doc.type].rank;
            }

            const minRank = doc.locked.min;
            const maxRank = doc.locked.max;
            const rankTooLow = rank < minRank;
            const rankTooHigh = rank > maxRank;

            if (rankTooLow || rankTooHigh) {
              errors.push(`Your rank is too ${rankTooLow ? 'low' : 'high'}.`);
            }
          }

          if (doc.type === RACE_SURVIVAL) {
            if (!player || !player.nat) {
              errors.push('You need to set your NAT Type before you can join a survival lobby.');
            } else if (player && player.nat && player.nat === NAT3) {
              errors.push('You cannot join a survival lobby because you are NAT Type 3.');
            }
          }
        }

        // eslint-disable-next-line max-len,no-shadow
        return lock.acquire(doc._id, async () => Lobby.findOne({ _id: doc._id }).then(async (doc) => {
          let players = Array.from(doc.players);
          const playersCount = players.length;

          if (doc.mode === 'tournament' && doc.type === RACE_ITEMS_DUOS
            && (doc.started || doc.closed || (!removed && playersCount >= 16))) {
            return;
          }

          // eslint-disable-next-line max-len
          if (!removed && playersCount > doc.maxPlayerCount) {
            return;
          }

          let teamList = Array.from(doc.teamList);

          if (doc.isDuos()) {
            const userSavedDuo = await Duo.findOne({
              guild: guild.id,
              $or: [{ discord1: user.id }, { discord2: user.id }],
            });

            if (userSavedDuo) {
              if (doc.isInsta()) {
                errors.push('The lobby does not allow premade teams.');
              }

              // eslint-disable-next-line max-len
              const savedPartner = userSavedDuo.discord1 === user.id ? userSavedDuo.discord2 : userSavedDuo.discord1;

              if (removed) {
                players = players.filter((p) => p !== user.id && p !== savedPartner);
                teamList = teamList.filter((p) => !(Array.isArray(p) && p.includes(user.id)));
              } else {
                const repeatLobbyPartner = await Lobby.findOne({
                  guild: guild.id,
                  players: savedPartner,
                  _id: { $ne: doc._id },
                  started: true
                });

                if (repeatLobbyPartner) {
                  errors.push(`Your partner <@!${savedPartner}> is already in a lobby that has been started.`);
                }

                if (doc.ranked) {
                  // eslint-disable-next-line max-len
                  const partnerBanned = await RankedBan.findOne({ discordId: savedPartner, guildId: guild.id });
                  if (partnerBanned) {
                    userSavedDuo.delete();
                    errors.push(`You cannot join a duo lobby when your partner <@!${savedPartner}> is banned from playing ranked. The duo has been deleted.`);
                  }
                }

                const partner = await Player.findOne({ discordId: savedPartner });

                if (!partner || !partner.rankedName) {
                  errors.push(`Your partner <@!${savedPartner}> needs to set their ranked name. Example: \`!set_ranked_name your_ranked_name\`.`);
                }

                if (doc.regions.length > 0) {
                  if (!partner || !partner.region) {
                    errors.push(`Your partner <@!${savedPartner}> needs to set their region. Use \`!set_region\` and then follow the bot instructions.`);
                  } else if (!doc.regions.includes(partner.region)) {
                    const lobbyRegions = [];
                    doc.regions.forEach((dr) => {
                      const region = regions.find((r) => r.key === dr);
                      lobbyRegions.push(region.name);
                    });

                    const partnerRegion = regions.find((r) => r.key === partner.region);
                    errors.push(`The lobby you are trying to join is locked to ${lobbyRegions.join(', ')} and your partner <@!${savedPartner}> is from ${partnerRegion.name}.`);
                  }
                }

                if (doc.consoles.length > 0) {
                  if (!partner || !partner.consoles.length) {
                    errors.push(`Your partner <@!${savedPartner} needs to set their consoles. Use \`!set_consoles\` and then follow the bot instructions.`);
                  } else if (!doc.consoles.some((c) => partner.consoles.includes(c))) {
                    const lobbyConsoles = [];
                    doc.consoles.forEach((dc) => {
                      const c = consoles.find((r) => r.key === dc);
                      lobbyConsoles.push(c.name);
                    });

                    const partnerConsoles = partner.consoles.map((pc) => {
                      const partnerConsole = consoles.find((c) => c.key === pc);
                      return partnerConsole.name;
                    });

                    errors.push(`The lobby you are trying to join is locked to ${lobbyConsoles.join(', ')} but your partner <@!${savedPartner} only plays on ${playerConsoles.join(', ')}.`);
                  }
                }

                if (doc.anonymous && (!partner || !partner.region)) {
                  errors.push(`Your partner <@!${savedPartner}> needs to set their region before you can join an anonymous lobby.`);
                }

                if (doc.ranked && !doc.locked.$isEmpty()) {
                  const player = await Player.findOne({ discordId: user.id });

                  let player1Rank = doc.getDefaultRank();
                  let player2Rank = doc.getDefaultRank();

                  if (player && player.rankedName && partner && partner.rankedName) {
                    const playerRank = await Rank.findOne({ name: player.rankedName });
                    const partnerRank = await Rank.findOne({ name: partner.rankedName });

                    if (playerRank && playerRank[doc.type] && Number.isFinite(playerRank[doc.type].rank)) {
                      player1Rank = playerRank[doc.type].rank;
                    }

                    if (partnerRank && partnerRank[doc.type] && Number.isFinite(partnerRank[doc.type].rank)) {
                      player2Rank = partnerRank[doc.type].rank;
                    }
                  }

                  const averageRank = Math.ceil((player1Rank + player2Rank) / 2);

                  const minRank = doc.locked.min;
                  const maxRank = doc.locked.max;
                  const rankTooLow = averageRank < minRank;
                  const rankTooHigh = averageRank > maxRank;

                  if (rankTooLow || rankTooHigh) {
                    errors.push(`Your team's rank is too ${rankTooLow ? 'low' : 'high'}.`);
                  }
                }

                const duoPlayerIds = [userSavedDuo.discord1, userSavedDuo.discord2];

                // eslint-disable-next-line max-len
                if (doc.reservedTeam && !duoPlayerIds.includes(doc.creator) && !duoPlayerIds.includes(doc.reservedTeam)) {
                  errors.push(`The lobby is reserved for <@!${doc.creator}>'s and <@!${doc.reservedTeam}>'s teams.`);
                }

                if (playersCount === (doc.maxPlayerCount - 1)) {
                  const soloQueue = players.filter((p) => !doc.teamList.flat().includes(p));
                  const lastSoloQueuePlayer = soloQueue.pop();
                  players = players.filter((p) => p !== lastSoloQueuePlayer);
                }

                if (!players.includes(user.id) && !players.includes(savedPartner)) {
                  const duo = [user.id, savedPartner];
                  players.push(...duo);
                  teamList.push(duo);
                }
              }
            } else if (removed) {
              players = players.filter((p) => p !== user.id);
            } else if (!players.includes(user.id)) {
              const soloQueue = players.filter((p) => !doc.teamList.flat().includes(p));
              const soloQueueErrors = await restrictSoloQueue(doc, user, soloQueue);

              if (soloQueueErrors <= 0) {
                players.push(user.id);
              } else {
                errors.push(...soloQueueErrors);
              }
            }
            doc.teamList = teamList;
          } else if (doc.isWar() && !doc.is1v1()) {
            let team = await Team.findOne({
              guild: guild.id,
              players: user.id,
            });

            /* 
             * Hack: Pretend a duo is a team
             *
             * Doing this will apply the 4 vs. 4 validation to duos which
             * might not always lead to the desired result but it does the job well enough
             */
            if (!team) {
              const userSavedDuo = await Duo.findOne({
                guild: guild.id,
                $or: [{ discord1: user.id }, { discord2: user.id }],
              });

              if (userSavedDuo) {
                team = {
                  guild: userSavedDuo.guild,
                  players: [userSavedDuo.discord1, userSavedDuo.discord2],
                  date: userSavedDuo.date
                };
              }
            }

            if (team) {
              if (doc.isInsta()) {
                errors.push('This lobby does not allow premade teams.');
              }

              if (team.players.length > doc.getTeamSize()) {
                errors.push('The size of your team is too big for this lobby.');
              }

              if (doc.hasIncompleteTeams() && !doc.getAvailableTeamSizes().some((s) => s >= team.players.length)) {
                errors.push('You cannot join this lobby because there are not enough open spots for the size of your team.');
              }

              const teamPlayers = team.players;

              if (removed) {
                players = players.filter((p) => !teamPlayers.includes(p));
                teamList = teamList.filter((p) => !(Array.isArray(p) && p.includes(user.id)));
              } else {
                const repeatLobbyTeam = await Lobby.findOne({
                  guild: guild.id,
                  players: { $in: teamPlayers },
                  _id: { $ne: doc._id },
                  started: true
                });

                if (repeatLobbyTeam) {
                  errors.push('One of your teammates is already in a lobby that has been started.');
                }

                if (doc.ranked) {
                  // eslint-disable-next-line max-len
                  const teammateBanned = await RankedBan.findOne({ discordId: teamPlayers, guildId: guild.id });

                  if (teammateBanned) {
                    team.delete();
                    errors.push('You cannot join a team lobby when one of your teammates is banned from playing ranked. The team has been deleted.');
                  }
                }

                const teammates = await Player.find({ discordId: { $in: teamPlayers } });
                let rankSum = 0;

                // eslint-disable-next-line guard-for-in
                for (const teammate of teammates) {
                  if (!teammate.rankedName) {
                    errors.push(`Your teammate <@!${teammate.discordId}> needs to set their ranked name. Example: \`!set_ranked_name your_ranked_name\`.`);
                  }

                  if (doc.regions.length > 0) {
                    if (!teammate.region) {
                      errors.push(`Your teammate <@!${teammate.discordId}> needs to set their region. Use \`!set_region\` and then follow the bot instructions.`);
                    } else if (!doc.regions.includes(teammate.region)) {
                      const lobbyRegions = [];
                      doc.regions.forEach((dr) => {
                        const region = regions.find((r) => r.key === dr);
                        lobbyRegions.push(region.name);
                      });

                      const teammateRegion = regions.find((r) => r.key === teammate.region);
                      errors.push(`The lobby you are trying to join is locked to ${lobbyRegions.join(', ')} and your teammate <@!${teammate.discordId}> is from ${teammateRegion.name}.`);
                    }
                  }

                  if (doc.consoles.length > 0) {
                    if (!teammate.consoles.length) {
                      errors.push(`Your teammate <@!${teammate.discordId} needs to set their consoles. Use \`!set_consoles\` and then follow the bot instructions.`);
                    } else if (!doc.consoles.some((c) => teammate.consoles.includes(c))) {
                      const lobbyConsoles = [];
                      doc.consoles.forEach((dc) => {
                        const c = consoles.find((r) => r.key === dc);
                        lobbyConsoles.push(c.name);
                      });

                      const teammateConsoles = teammate.consoles.map((tc) => {
                        const teammateConsole = consoles.find((c) => c.key === tc);
                        return teammateConsole.name;
                      });

                      errors.push(`The lobby you are trying to join is locked to ${lobbyConsoles.join(', ')} but your teammate <@!${teammate.discordId} only plays on ${playerConsoles.join(', ')}.`);
                    }
                  }

                  if (doc.anonymous && !teammate.region) {
                    errors.push(`Your teammate <@!${teammate.discordId}> needs to set their region before you can join an anonymous lobby.`);
                  }

                  if (doc.ranked && !doc.locked.$isEmpty()) {
                    const teammateRank = await Rank.findOne({ name: teammate.rankedName });

                    let rank = doc.getDefaultRank();
                    if (teammateRank && teammateRank[doc.type] && Number.isFinite(teammateRank[doc.type].rank)) {
                      // eslint-disable-next-line prefer-destructuring
                      rank = teammateRank[doc.type].rank;
                    }

                    rankSum += rank;
                  }
                }

                if (doc.ranked && !doc.locked.$isEmpty()) {
                  const averageRank = Math.ceil(rankSum / team.players.length);

                  const minRank = doc.locked.min;
                  const maxRank = doc.locked.max;
                  const rankTooLow = averageRank < minRank;
                  const rankTooHigh = averageRank > maxRank;

                  if (rankTooLow || rankTooHigh) {
                    errors.push(`Your team's rank is too ${rankTooLow ? 'low' : 'high'}.`);
                  }
                }

                // eslint-disable-next-line max-len
                if (doc.reservedTeam && !team.players.includes(doc.creator) && !team.players.includes(doc.reservedTeam)) {
                  errors.push(`The lobby is reserved for <@!${doc.creator}>'s and <@!${doc.reservedTeam}>'s teams.`);
                }

                if (!doc.hasIncompleteTeams() && team.players.length === doc.getTeamSize()) {
                  const cutoffPlayerCount = doc.getTeamSize();
  
                  if (playersCount > cutoffPlayerCount) {
                    const soloQueue = players.filter((p) => !doc.teamList.flat().includes(p));
                    if (doc.teamList.length) {
                      players = players.filter((p) => !soloQueue.includes(p));
                    } else {
                      const soloToKick = soloQueue.slice(cutoffPlayerCount);
                      players = players.filter((p) => !soloToKick.includes(p));
                    }
                  }
                }

                if (!players.some((p) => teamPlayers.includes(p))) {
                  players.push(...teamPlayers);
                  teamList.push(teamPlayers);
                }
              }
            } else if (removed) {
              players = players.filter((p) => p !== user.id);
            } else if (!players.includes(user.id)) {
              const soloQueue = players.filter((p) => !doc.teamList.flat().includes(p));
              const soloQueueErrors = await restrictSoloQueue(doc, user, soloQueue);

              if (soloQueueErrors <= 0) {
                players.push(user.id);
              } else {
                errors.push(...soloQueueErrors);
              }
            }
            doc.teamList = teamList;
          } else if (removed) {
            players = players.filter((p) => p !== user.id);
          } else if (!players.includes(user.id)) {
            players.push(user.id);
          }

          doc.players = players;

          if (errors.length > 0 && !removed) {
            let out = 'You cannot join the lobby for the following reasons:\n\n';
            out += errors.map((e, i) => `${i + 1}. ${e}`).join('\n');

            if (reaction.users) {
              await reaction.users.remove(user);
            }

            user.createDM().then((dmChannel) => dmChannel.warn(out)).catch(() => {
            });
            // eslint-disable-next-line consistent-return
            return notificationChannel.warn(out, [user.id]);
          }

          // eslint-disable-next-line consistent-return
          return doc.save().then(async () => {
            const count = players.length;
            if (count) {
              if (count >= doc.maxPlayerCount) {
                startLobby(doc.id);
              } else {
                await message.edit({
                  embed: await getEmbed(doc, players),
                });
              }
            } else {
              await message.edit({
                embed: await getEmbed(doc),
              });
            }
          }).catch((error) => {
            // eslint-disable-next-line no-console
            console.log(`Unable to save lobby: ${error}`);
          });
        }));
      }
    });
  }
}

client.on('messageReactionAdd', async (reaction, user) => {
  if (reaction.partial) {
    try {
      await reaction.fetch();
      await reaction.users.fetch();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('Something went wrong when fetching the message: ', error);
      return;
    }
  }

  await mogi(reaction, user);
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('Something went wrong when fetching the message: ', error);
      return;
    }
  }

  await mogi(reaction, user, true);
});

// Recover pending deadlines after restart, and retry recovery if its database read failed.
function resumePermissionCleanups() {
  resumeRoomCleanups(client).catch(console.error);
  resumeTournamentCleanups(client).catch(console.error);
}
client.on('ready', resumePermissionCleanups);
new CronJob('* * * * *', resumePermissionCleanups).start();

client.on('messageDelete', async (message) => {
  // Deleted messages cannot be fetched; partials already contain the IDs needed below.
  try {
    const doc = await Lobby.findOne({ message: message.id });
    if (doc) await deleteLobby(doc, message, false, true);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Could not clean up a deleted lobby message:', error);
  }
});

const findRoomAndSendMessage = (doc, ping = false) => {
  let message;
  if (doc.ranked) {
    message = 'Don\'t forget to close the lobby with `!lobby end` and submit your scores.';
  } else {
    message = 'Don\'t forget to close the lobby with `!lobby end`.';
  }

  let pings = [];
  if (ping) {
    pings = doc.players;
  }

  Room.findOne({ lobby: doc.id }).then((room) => {
    if (room) {
      // eslint-disable-next-line max-len
      const channel = client.guilds.cache.get(room.guild).channels.cache.find((c) => c.name.toLowerCase() === getRoomName(room.number).toLowerCase());
      if (channel) {
        channel.info(message, pings);
      }
    }
  });
};

const checkOldLobbies = () => {
  Lobby.find({ started: true }).then((docs) => {
    docs.forEach((doc) => {
      if (doc.isTournament()) {
        return;
      }

      const minutes = diffMinutes(new Date(), doc.startedAt);

      const remindMinutes = doc.getRemindMinutes();
      const pingMinutes = doc.getPingMinutes();

      if (remindMinutes !== null && pingMinutes !== null) {
        if (remindMinutes.includes(minutes)) {
          findRoomAndSendMessage(doc);
        } else if (pingMinutes.includes(minutes)) {
          findRoomAndSendMessage(doc, true);
        }
      }
    });
  });

  Lobby.find({ started: false }).then((docs) => {
    // eslint-disable-next-line consistent-return
    docs.forEach(async (doc) => {
      const guild = client.guilds.cache.get(doc.guild);

      if (guild) {
        // eslint-disable-next-line max-len
        let notificationChannel = guild.channels.cache.find((c) => c.name.toLowerCase() === config.channels.matchmaking_notifications_channel.toLowerCase());
        if (!notificationChannel) {
          // eslint-disable-next-line max-len
          notificationChannel = await guild.channels.create(config.channels.matchmaking_notifications_channel);
        }

        const minutes = diffMinutes(new Date(), doc.date);

        if (doc.ranked) {
          if (doc.players.length <= 0 && minutes >= 5) {
            deleteLobby(doc);
            return notificationChannel.info(`Your lobby \`${doc.id}\` has been deleted because it was empty for more than 5 minutes.`, [doc.creator]);
          }
        } else if (!doc.ranked) {
          if (doc.players.length <= 0 && minutes >= 60) {
            deleteLobby(doc);
            return notificationChannel.info(`Your lobby \`${doc.id}\` has been deleted because it was empty for more than 60 minutes.`, [doc.creator]);
          }
        }

        const remindMinutes = doc.getCloseRemindMinutes();
        const closeMinutes = doc.getCloseAfterMinutes();

        if (remindMinutes.includes(minutes) || minutes >= closeMinutes) {
          if (minutes >= closeMinutes) {
            const duration = moment.duration(closeMinutes, 'minutes').humanize();
            deleteLobby(doc);
            return notificationChannel.info(`Your lobby \`${doc.id}\` has been deleted because it wasn't started in ${duration}.`, doc.players);
          }

          const duration = moment.duration(closeMinutes - minutes, 'minutes').humanize();
          return notificationChannel.warn(`Your lobby \`${doc.id}\` will be deleted in ${duration} if it will not be started.`, doc.players);
        }
      }
    });
  });
};

new CronJob('* * * * *', checkOldLobbies).start();

function checkRankedBans() {
  const now = new Date();
  RankedBan.find({ bannedTill: { $lte: now } }).then((docs) => {
    docs.forEach((doc) => {
      const guild = client.guilds.cache.get(doc.guildId);

      if (guild) {
        // eslint-disable-next-line max-len
        const channel = guild.channels.cache.find((c) => c.name === config.channels.ranked_lobbies_channel);
        const permissionOverwrites = channel.permissionOverwrites.get(doc.discordId);
        if (permissionOverwrites) {
          permissionOverwrites.delete().then(() => {});
        }

        doc.delete();
      }
    });
  });
}

function resetCounters() {
  const oneMinuteAgo = moment().subtract(1, 'm');
  Counter.find({ tickUpdatedAt: { $lte: oneMinuteAgo }, tickCount: { $gt: 0 } }).then((docs) => {
    docs.forEach((doc) => {
      doc.tickCount = 0;
      doc.save();
    });
  });

  const duration = moment().subtract(3, 'h');
  Counter.find({ pingUpdatedAt: { $lte: duration }, pingCount: { $gt: 0 } }).then((docs) => {
    docs.forEach((doc) => {
      doc.pingCount = 0;
      doc.save();
    });
  });

  checkRankedBans();
}

new CronJob('* * * * *', resetCounters).start();

function resetCooldowns() {
  const onHourAgo = moment().subtract(1, 'h');
  Cooldown.find({ updatedAt: { $lte: onHourAgo }, count: { $gt: 0 }, name: 'pings' }).then((docs) => {
    docs.forEach((doc) => {
      doc.count = 0;
      doc.save();
    });
  });

  const duration = moment().subtract(3, 'h');
  Cooldown.find({ updatedAt: { $lte: duration }, count: { $gt: 0 }, name: 'ranked pings' }).then((docs) => {
    docs.forEach((doc) => {
      doc.count = 0;
      doc.save();
    });
  });

  const fiveMinutes = moment().subtract(5, 'm');
  Cooldown.find({ updatedAt: { $lte: fiveMinutes }, count: { $gt: 0 }, name: 'lobby' }).then((docs) => {
    docs.forEach((doc) => {
      doc.count = 0;
      doc.save();
    });
  });
}

new CronJob('* * * * *', resetCooldowns).start();

client.on('message', (message) => {
  if (message.author.bot) return;
  if (message.channel.type !== 'text') return;

  // check submissions
  if (message.channel.name === config.channels.ranked_results_submissions_channel) {
    resultContainsBannedPlayer(message.content).then((result) => {
      if (result) {
        message.delete();

        const notificationChannel = message.guild.channels.cache.find((c) => c.name.toLowerCase() === config.channels.matchmaking_notifications_channel.toLowerCase());
        if (!notificationChannel) {
          return;
        }

        return notificationChannel.warn(`${message.author}, the score table you posted contains a player who is banned from playing in ranked lobbies. You cannot submit this score table.`);
      }

      if (!message.member.isStaff() && !message.content.includes('`') && message.content.includes('|')) {
        message.reply(`\`\`\`${message.content}\`\`\``).then(() => {
          message.delete();
        });
      }
    });
  }

  if (message.member.isStaff()) return;

  const { roles } = message.mentions;

  // eslint-disable-next-line max-len
  if (message.channel.parent && message.channel.parent.name.toLowerCase() === config.channels.matchmaking_category.toLowerCase() && roles.find((r) => r.name.toLowerCase() === config.roles.tournament_staff_role.toLowerCase())) {
    let rankedStaff = `@${config.roles.ranked_staff_role}`;

    message.channel.warn(`Incorrect staff ping. If you have a problem ping ${rankedStaff}.`).then((m) => {
      const rankedStaffRole = message.guild.hasRole('ranked staff');
      if (rankedStaffRole) {
        rankedStaff = rankedStaffRole.toString();

        m.delete();
        message.channel.warn(`${message.author}, incorrect staff ping. If you have a problem ping ${rankedStaff}.`);
      }
    });
  }
});

client.on('ready', () => {
  Lobby.find().then((docs) => {
    docs.forEach(async (doc) => {
      const guild = client.guilds.cache.get(doc.guild);
      if (!guild) {
        doc.delete();
        return;
      }

      const channel = guild.channels.cache.get(doc.channel);
      if (!channel) {
        doc.delete();
        return;
      }

      channel.messages.fetch(doc.message).catch(() => {
        doc.delete();
      });
    });
  });
});

// update cached ranks
async function getRanks(options) {
  const ranks = {};

  // eslint-disable-next-line guard-for-in
  for (const key in LEADERBOARDS) {
    const id = LEADERBOARDS[key];

    if (id !== null) {
      const response = await getLorenziBoardData(id);

      if (response.data.data.team !== null) {
        const { players } = response.data.data.team;

        players.forEach((p) => {
          const { name } = p;
          if (!(name in ranks)) {
            ranks[name] = { name };
          }

          ranks[name][key] = {
            rank: p.rating,
            maxRank: p.maxRating,
            minRank: p.minRating,
            position: p.ranking,
            maxPosition: p.maxRanking,
            minPosition: p.minRanking,
            firstActivity: (p.firstActivityDate / 1000),
            lastActivity: (p.lastActivityDate / 1000),
            wins: p.wins,
            losses: p.losses,
            playedMatches: p.playedMatchCount,
            maxRankGain: p.maxRatingGain,
            maxRankLoss: p.maxRatingLoss,
          };
        });
      }
    }
  }

  await Rank.deleteMany();
  await Rank.insertMany(Object.values(ranks), options);
}

new CronJob('0/15 * * * *', getRanks).start();

// check bans on rejoin
client.on('guildMemberAdd', (member) => {
  const { guild } = member;
  const { user } = member;

  const now = new Date();

  // eslint-disable-next-line max-len
  RankedBan.findOne({ discordId: user.id, guildId: guild.id, bannedTill: { $gte: now } }).then((doc) => {
    if (doc) {
      // eslint-disable-next-line max-len
      const lobbiesChannel = guild.channels.cache.find((c) => c.name.toLowerCase() === config.channels.ranked_lobbies_channel.toLowerCase());
      lobbiesChannel.createOverwrite(user, { VIEW_CHANNEL: false }).then(() => {
        guild.log(`<@${user.id}> was ranked banned on rejoin.`);
      });
    }
  });
});

// new role
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const DMCallback = (m) => {
    const logMessage = `Sent message to ${m.channel.recipient}:\n\`\`\`${m.content}\`\`\``;
    newMember.guild.log(logMessage);
  };

  const DMCatchCallback = (error) => {
    const logMessage = `Could not send DM: ${error.message} ${newMember}`;
    newMember.guild.log(logMessage);
  };

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  // eslint-disable-next-line max-len
  if (!oldRoles.some((r) => r.name.toLowerCase() === config.roles.matchmaking_role.toLowerCase()) && newRoles.some((r) => r.name.toLowerCase() === config.roles.matchmaking_role.toLowerCase())) {
    const promise = getConfigValue('ranked_welcome_message', config.default_matchmaking_welcome_message);
    Promise.resolve(promise).then((welcomeMessage) => {
      newMember.createDM().then((dm) => {
        dm.send(welcomeMessage).then(DMCallback).catch(DMCatchCallback);
      });
    });
  }
});

const teamDuration = moment.duration(3, 'hours');

function checkOldDuos() {
  const lte = moment().subtract(teamDuration);
  Duo.find({ date: { $lte: lte } }).then((duos) => {
    duos.forEach((duo) => {
      Lobby.findOne({
        type: RACE_ITEMS_DUOS,
        players: { $in: [duo.discord1, duo.discord2] },
      }).then((activeLobby) => {
        if (!activeLobby) {
          duo.delete().then(() => {
            const guild = client.guilds.cache.get(duo.guild);

            if (guild) {
              // eslint-disable-next-line max-len
              const notificationChannel = guild.channels.cache.find((c) => c.name.toLowerCase() === config.channels.matchmaking_notifications_channel.toLowerCase());
              const message = `Duo <@${duo.discord1}> & <@${duo.discord2}> was removed after ${teamDuration.humanize()}.`;

              notificationChannel.info(message);
            }
          });
        }
      });
    });
  });
}

new CronJob('* * * * *', checkOldDuos).start();

function checkOldTeams() {
  const lte = moment().subtract(teamDuration);
  Team.find({ date: { $lte: lte } }).then((teams) => {
    teams.forEach((team) => {
      Lobby.findOne({
        type: { $in: [RACE_ITEMS_3V3, RACE_ITEMS_4V4] },
        players: { $in: teams.players },
      }).then((activeLobby) => {
        if (!activeLobby) {
          team.delete().then(() => {
            const guild = client.guilds.cache.get(team.guild);

            if (guild) {
              // eslint-disable-next-line max-len
              const notificationChannel = guild.channels.cache.find((c) => c.name.toLowerCase() === config.channels.matchmaking_notifications_channel.toLowerCase());
              const teamPing = team.players.map((p) => `<@${p}>`).join(', ');
              const message = `Team ${teamPing} was removed after ${teamDuration.humanize()}.`;

              notificationChannel.info(message);
            }
          });
        }
      });
    });
  });
}

new CronJob('* * * * *', checkOldTeams).start();

client.on('clickButton', (button) => lobbyScoring.handleButton(button));
