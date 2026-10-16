const mongoose = require('mongoose');
const { client } = require('../../bot');

const { Schema, model } = mongoose;
const { engineStyles } = require('../engine_styles');
const { regions } = require('../regions');
const { rulesets } = require('../rulesets');
const { trackOptions } = require('../track_options');
const { consoles } = require('../consoles');

const createDraft = require('../../utils/createDraft');
const createDraftv2 = require('../../utils/createDraftv2');
const getRandomArrayElement = require('../../utils/getRandomArrayElement');

const {
  TYPE_FFA,
  TYPE_DUOS,
  discordDraft,
} = require('../../utils/discordDraft');

const poolItems3 = require('../pools/items_3');
const poolItems4 = require('../pools/items_4');
const poolItems5 = require('../pools/items_5');
const poolItemless3 = require('../pools/itemless_3');
const poolBattle3 = require('../pools/battle_3');
const poolBattle4 = require('../pools/battle_4');
const poolBattle5 = require('../pools/battle_5');

const engineKeys = engineStyles.map((e) => e.key);
const regionKeys = regions.map((r) => r.key);
const rulesetIds = rulesets.map((r) => r.id);
const trackOptionKeys = trackOptions.map((t) => t.key);
const consoleKeys = consoles.map((c) => c.key);

const LOBBY_MODE_STANDARD = 'standard';
const LOBBY_MODE_TOURNAMENT = 'tournament';
const UNKNOWN = 'unknown';
const RACE_ITEMS_FFA = 'race_ffa';
const RACE_ITEMS_DUOS = 'race_duos';
const RACE_ITEMS_3V3 = 'race_3v3';
const RACE_ITEMS_4V4 = 'race_4v4';
const RACE_SURVIVAL = 'race_survival';
const RACE_ITEMLESS_1V1 = 'race_itemless_1v1';
const RACE_ITEMLESS_FFA = 'race_itemless_ffa';
const RACE_ITEMLESS_DUOS = 'race_itemless_duos';
const RACE_ITEMLESS_3V3 = 'race_itemless_3v3';
const RACE_ITEMLESS_4V4 = 'race_itemless_4v4';
const BATTLE_1V1 = 'battle_1v1';
const BATTLE_FFA = 'battle_ffa';
const BATTLE_DUOS = 'battle_duos';
const BATTLE_3V3 = 'battle_3v3';
const BATTLE_4V4 = 'battle_4v4';
const INSTA_DUOS = 'insta_duos';
const INSTA_3V3 = 'insta_3v3';
const INSTA_4V4 = 'insta_4v4';
const TEAM_CREATION_BALANCED = 'balanced';
const TEAM_CREATION_RANDOM = 'random';

const DUO_MODES = [RACE_ITEMS_DUOS, RACE_ITEMLESS_DUOS, BATTLE_DUOS];
const _3V3_MODES = [RACE_ITEMS_3V3, RACE_ITEMLESS_3V3, BATTLE_3V3];
const _4V4_MODES = [RACE_ITEMS_4V4, RACE_ITEMLESS_4V4, BATTLE_4V4];

const SURVIVAL_STYLES = [
  'Items only',
  'Mixed',
  'Itemless',
];

const LEADERBOARD_URLS = {
  'solos': 'J4pUNM',
  'itemless': 'flviu1',
  'teams': 'AkswcV',
  'insta_teams': 'APhIyj',
  'battle': 'y0AeQ9',
};

const LEADERBOARDS = {
  [RACE_ITEMS_FFA]: LEADERBOARD_URLS.solos,
  [RACE_ITEMS_DUOS]: LEADERBOARD_URLS.teams,
  [RACE_ITEMS_3V3]: LEADERBOARD_URLS.teams,
  [RACE_ITEMS_4V4]: LEADERBOARD_URLS.teams,
  [RACE_SURVIVAL]: null,
  [RACE_ITEMLESS_1V1]: null,
  [RACE_ITEMLESS_FFA]: LEADERBOARD_URLS.itemless,
  [RACE_ITEMLESS_DUOS]: LEADERBOARD_URLS.itemless,
  [RACE_ITEMLESS_3V3]: LEADERBOARD_URLS.itemless,
  [RACE_ITEMLESS_4V4]: LEADERBOARD_URLS.itemless,
  [BATTLE_1V1]: null,
  [BATTLE_FFA]: LEADERBOARD_URLS.battle,
  [BATTLE_DUOS]: LEADERBOARD_URLS.battle,
  [BATTLE_3V3]: LEADERBOARD_URLS.battle,
  [BATTLE_4V4]: LEADERBOARD_URLS.battle,
  [INSTA_DUOS]: LEADERBOARD_URLS.insta_teams,
  [INSTA_3V3]: LEADERBOARD_URLS.insta_teams,
  [INSTA_4V4]: LEADERBOARD_URLS.insta_teams,
};

const TRACK_OPTION_RNG = 'random';
const TRACK_OPTION_POOLS = 'pools';
const TRACK_OPTION_DRAFT = 'draft';
const TRACK_DRAGON_MINES = 'Dragon Mines';
const TRACK_HYPER_SPACEWAY = 'Hyper Spaceway';
const TRACK_RETRO_STADIUM = 'Retro Stadium';
const TRACK_SPYRO_CIRCUIT = 'Spyro Circuit';
const TRACK_MEGAMIX_MANIA = 'Megamix Mania';
const ARENA_FROZEN_FRENZY = 'Frozen Frenzy';
const ARENA_MAGNETIC_MAYHEM = 'Magnetic Mayhem';
const CUSTOM_OPTION_MODE = 'mode';
const CUSTOM_OPTION_TRACK_POOL = 'track_pool';
const CUSTOM_OPTION_PLAYERS = 'players';
const CUSTOM_OPTION_RULESET = 'ruleset';
const CUSTOM_OPTION_REGION = 'region';
const CUSTOM_OPTION_CONSOLES = 'consoles';
const CUSTOM_OPTION_BATTLE_MODES = 'battle_modes';
const CUSTOM_OPTION_RESERVE = 'reserve';
const CUSTOM_OPTION_ANONYMOUS = 'anonymous';
const CUSTOM_OPTION_PRIVATE_CHANNEL = 'private_channel';
const CUSTOM_OPTION_TEAM_CREATION = 'team_creation';
const CUSTOM_OPTION_DESCRIPTION = 'description';
const CUSTOM_OPTION_TYPE = 'type';
const CUSTOM_OPTION_MMR_LOCK = 'mmr_lock';

module.exports.RACE_ITEMS_FFA = RACE_ITEMS_FFA;
module.exports.RACE_ITEMS_DUOS = RACE_ITEMS_DUOS;
module.exports.RACE_ITEMS_3V3 = RACE_ITEMS_3V3;
module.exports.RACE_ITEMS_4V4 = RACE_ITEMS_4V4;
module.exports.RACE_SURVIVAL = RACE_SURVIVAL;
module.exports.RACE_ITEMLESS_1V1 = RACE_ITEMLESS_1V1;
module.exports.RACE_ITEMLESS_FFA = RACE_ITEMLESS_FFA;
module.exports.RACE_ITEMLESS_DUOS = RACE_ITEMLESS_DUOS;
module.exports.RACE_ITEMLESS_3V3 = RACE_ITEMLESS_3V3;
module.exports.RACE_ITEMLESS_4V4 = RACE_ITEMLESS_4V4;
module.exports.BATTLE_1V1 = BATTLE_1V1;
module.exports.BATTLE_FFA = BATTLE_FFA;
module.exports.BATTLE_DUOS = BATTLE_DUOS;
module.exports.BATTLE_3V3 = BATTLE_3V3;
module.exports.BATTLE_4V4 = BATTLE_4V4;
module.exports.INSTA_DUOS = INSTA_DUOS;
module.exports.INSTA_3V3 = INSTA_3V3;
module.exports.INSTA_4V4 = INSTA_4V4;
module.exports.SURVIVAL_STYLES = SURVIVAL_STYLES;
module.exports.LEADERBOARDS = LEADERBOARDS;
module.exports.LEADERBOARD_URLS = LEADERBOARD_URLS;
module.exports.TRACK_OPTION_RNG = TRACK_OPTION_RNG;
module.exports.TRACK_OPTION_POOLS = TRACK_OPTION_POOLS;
module.exports.TRACK_OPTION_DRAFT = TRACK_OPTION_DRAFT;
module.exports.LOBBY_MODE_STANDARD = LOBBY_MODE_STANDARD;
module.exports.LOBBY_MODE_TOURNAMENT = LOBBY_MODE_TOURNAMENT;
module.exports.CUSTOM_OPTION_MODE = CUSTOM_OPTION_MODE;
module.exports.CUSTOM_OPTION_TRACK_POOL = CUSTOM_OPTION_TRACK_POOL;
module.exports.CUSTOM_OPTION_PLAYERS = CUSTOM_OPTION_PLAYERS;
module.exports.CUSTOM_OPTION_RULESET = CUSTOM_OPTION_RULESET;
module.exports.CUSTOM_OPTION_REGION = CUSTOM_OPTION_REGION;
module.exports.CUSTOM_OPTION_CONSOLES = CUSTOM_OPTION_CONSOLES;
module.exports.CUSTOM_OPTION_BATTLE_MODES = CUSTOM_OPTION_BATTLE_MODES;
module.exports.CUSTOM_OPTION_RESERVE = CUSTOM_OPTION_RESERVE;
module.exports.CUSTOM_OPTION_ANONYMOUS = CUSTOM_OPTION_ANONYMOUS;
module.exports.CUSTOM_OPTION_TYPE = CUSTOM_OPTION_TYPE;
module.exports.CUSTOM_OPTION_PRIVATE_CHANNEL = CUSTOM_OPTION_PRIVATE_CHANNEL;
module.exports.CUSTOM_OPTION_DESCRIPTION = CUSTOM_OPTION_DESCRIPTION;
module.exports.CUSTOM_OPTION_TEAM_CREATION = CUSTOM_OPTION_TEAM_CREATION;
module.exports.CUSTOM_OPTION_MMR_LOCK = CUSTOM_OPTION_MMR_LOCK;
module.exports.TRACK_DRAGON_MINES = TRACK_DRAGON_MINES;
module.exports.TRACK_HYPER_SPACEWAY = TRACK_HYPER_SPACEWAY;
module.exports.TRACK_RETRO_STADIUM = TRACK_RETRO_STADIUM;
module.exports.TRACK_SPYRO_CIRCUIT = TRACK_SPYRO_CIRCUIT;
module.exports.TRACK_MEGAMIX_MANIA = TRACK_MEGAMIX_MANIA;
module.exports.ARENA_FROZEN_FRENZY = ARENA_FROZEN_FRENZY;
module.exports.ARENA_MAGNETIC_MAYHEM = ARENA_MAGNETIC_MAYHEM;
module.exports.DUO_MODES = DUO_MODES;
module.exports._3V3_MODES = _3V3_MODES;
module.exports._4V4_MODES = _4V4_MODES;
module.exports.TEAM_CREATION_BALANCED = TEAM_CREATION_BALANCED;
module.exports.TEAM_CREATION_RANDOM = TEAM_CREATION_RANDOM;

const Lobby = new Schema({
  date: {
    type: Date,
    default: Date.now,
  },
  guild: String,
  channel: String,
  message: String,
  creator: String,
  // Scores live in the referenced Discord code block; retain only a recovery snapshot here.
  scorekeeperId: { type: String, default: null },
  scoringEnabled: { type: Boolean, default: false },
  scoringChannelId: { type: String, default: null },
  scoringTemplateMessageId: { type: String, default: null },
  scoringMessageId: { type: String, default: null },
  scoringBackup: { type: String, default: null },
  scoringOfferId: { type: String, default: null },
  scoringPanelId: { type: String, default: null },
  scoringRecoveryId: { type: String, default: null },
  scoringSubmissionMessageId: { type: String, default: null },
  scoringSubmissionChannelId: { type: String, default: null },
  scoringSubmissionSourceId: { type: String, default: null },
  scoringRoster: [{ discordId: String, name: String, prefix: String }],
  scoringTracks: { type: [String], default: [] },
  scoringBattleModes: { type: [String], default: [] },
  started: {
    type: Boolean,
    default: false,
  },
  startedAt: {
    type: Date,
    default: null,
  },
  players: [String],
  teamList: Array,
  tournamentGroups: { type: [[String]], default: [] },
  tournamentTracks: { type: [String], default: [] },
  tournamentRoundReady: { type: Boolean, default: false },
  tournamentPermissionRemovals: [{ playerId: String, removeAt: Date, roomNumber: Number }],
  closed: {
    type: Boolean,
    default: false,
  },
  type: {
    type: String,
    enum: [
      RACE_ITEMS_FFA,
      RACE_ITEMS_DUOS,
      RACE_ITEMS_3V3,
      RACE_ITEMS_4V4,
      RACE_SURVIVAL,
      RACE_ITEMLESS_1V1,
      RACE_ITEMLESS_FFA,
      RACE_ITEMLESS_DUOS,
      RACE_ITEMLESS_3V3,
      RACE_ITEMLESS_4V4,
      BATTLE_1V1,
      BATTLE_FFA,
      BATTLE_DUOS,
      BATTLE_3V3,
      BATTLE_4V4,
      INSTA_DUOS,
      INSTA_3V3,
      INSTA_4V4,
    ],
  },
  trackOption: {
    type: String,
    enum: trackOptionKeys,
    default: TRACK_OPTION_RNG,
  },
  maxPlayerCount: Number,
  trackCount: Number,
  lapCount: {
    type: Number,
    enum: [1, 3, 5, 7],
    default: 5,
  },
  ruleset: {
    type: Number,
    enum: rulesetIds,
    default: 1,
  },
  regions: {
    type: [String],
    enum: regionKeys,
    default: null,
  },
  engineRestriction: {
    type: String,
    enum: engineKeys.concat(null),
    default: null,
  },
  survivalStyle: {
    type: Number,
    enum: [null, 0, 1, 2],
    default: null,
  },
  consoles: {
    type: [String],
    enum: consoleKeys,
    default: null
  },
  allowPremadeTeams: {
    type: Boolean,
    default: true,
  },
  reservedTeam: String,
  ranked: {
    type: Boolean,
    default: false,
  },
  locked: {
    min: Number,
    max: Number,
  },
  mode: {
    type: String,
    enum: [
      LOBBY_MODE_STANDARD,
      LOBBY_MODE_TOURNAMENT,
    ],
  },
  limitAndLKDOnly: {
    type: Boolean,
    default: false,
  },
  anonymous: {
    type: Boolean,
    default: false,
  },
  number: {
    type: Number,
    default: 1,
  },
  privateChannel: {
    type: Boolean,
    default: true,
  },
  description: {
    type: String,
    default: null,
  },
  teamCreation: {
    type: String,
    enum: [
      TEAM_CREATION_BALANCED,
      TEAM_CREATION_RANDOM
    ],
  }
});

Lobby.methods = {
  isPools() {
    return this.trackOption === TRACK_OPTION_POOLS;
  },
  isDrafting() {
    return this.trackOption === TRACK_OPTION_DRAFT;
  },
  getSoloPlayers() {
    let soloPlayers = [...this.players];

    this.teamList.forEach((team) => {
      team.forEach((player) => {
        soloPlayers = soloPlayers.filter((p) => p !== player);
      });
    });

    return soloPlayers;
  },
  isRacing() {
    return !this.isBattle();
  },
  isItems() {
    // eslint-disable-next-line max-len
    return [RACE_ITEMS_FFA, RACE_ITEMS_DUOS, RACE_ITEMS_3V3, RACE_ITEMS_4V4, INSTA_DUOS, INSTA_3V3, INSTA_4V4].includes(this.type);
  },
  isItemless() {
    // eslint-disable-next-line max-len
    return [RACE_ITEMLESS_1V1, RACE_ITEMLESS_FFA, RACE_ITEMLESS_DUOS, RACE_ITEMLESS_3V3, RACE_ITEMLESS_4V4].includes(this.type);
  },
  isBattle() {
    // eslint-disable-next-line max-len
    return [BATTLE_1V1, BATTLE_FFA, BATTLE_DUOS, BATTLE_3V3, BATTLE_4V4].includes(this.type);
  },
  isFFA() {
    return [RACE_ITEMS_FFA, RACE_ITEMLESS_FFA, BATTLE_FFA].includes(this.type);
  },
  is1v1() {
    return [RACE_ITEMLESS_1V1, BATTLE_1V1].includes(this.type);
  },
  isDuos() {
    return [RACE_ITEMS_DUOS, RACE_ITEMLESS_DUOS, BATTLE_DUOS, INSTA_DUOS].includes(this.type);
  },
  is3v3() {
    return [RACE_ITEMS_3V3, RACE_ITEMLESS_3V3, BATTLE_3V3, INSTA_3V3].includes(this.type);
  },
  is4v4() {
    return [RACE_ITEMS_4V4, RACE_ITEMLESS_4V4, BATTLE_4V4, INSTA_4V4].includes(this.type);
  },
  isInsta() {
    return [INSTA_DUOS, INSTA_3V3, INSTA_4V4].includes(this.type);
  },
  isSurvival() {
    return [RACE_SURVIVAL].includes(this.type);
  },
  isTeams() {
    return (this.isDuos() || this.is3v3() || this.is4v4());
  },
  isWar() {
    return (this.is1v1() || this.type === BATTLE_DUOS || this.is3v3() || this.is4v4());
  },
  isSolos() {
    return !this.isTeams();
  },
  getTeamSize() {
    if (this.isDuos()) {
      return 2;
    }

    if (this.is3v3()) {
      return 3;
    }

    if (this.is4v4()) {
      return 4;
    }

    return 1;
  },
  getAvailableTeamSizes() {
    const full = [0, 0];

    /**
     * This code will only work for wars because it's made for "solo queue with friends"
     * By nature this will only work in lobbies where you have more than 1 teammate
     */
    if (!this.is3v3() && !this.is4v4()) {
      return full;
    }

    let availableTeamSizes = [this.getTeamSize(), this.getTeamSize()]

    for (const team in this.teamList) {
      const teamSize = this.teamList[team].length;

      if (availableTeamSizes[0] >= teamSize) {
        availableTeamSizes[0] = availableTeamSizes[0] - teamSize;
      } else {
        if (availableTeamSizes[1] >= teamSize) {
          availableTeamSizes[1] = availableTeamSizes[1] - teamSize;
        } else {
          console.log('Encountered an invalid team constellation.');
          return full;
        }
      }
    }

    for (let i = 0; i < this.getSoloPlayers().length; i += 1) {
      if (availableTeamSizes[0] >= 1) {
        availableTeamSizes[0] -= 1;
      } else {
        if (availableTeamSizes[1] >= 1) {
          availableTeamSizes[1] -= 1;
        } else {
          console.log('Encountered an invalid team constellation.');
          return full;
        }
      }
    }

    return availableTeamSizes;
  },
  hasIncompleteTeams() {
    if (!this.is3v3() && !this.is4v4()) {
      return false
    }

    /*
     * If all the players in the lobby are in the solo queue then
     * we don't have a lobby with incomplete teams
     */
    if (this.getSoloPlayers().length === this.players.length) {
      return false;
    }

    let hasIncompleteTeams = false;

    /*
     * If any team's size is below the usual then we obviously
     * have incomplete teams
     */
    for (team in this.teamList) {
      if (this.teamList[team].length < this.getTeamSize()) {
        hasIncompleteTeams = true;
        break;
      }
    }

    return hasIncompleteTeams;
  },
  getMinimumPlayerCount() {
    let minimumPlayers;

    if (this.isTournament()) {
      minimumPlayers = {
        [RACE_ITEMS_FFA]: 16,
        [RACE_ITEMS_DUOS]: 16,
        [RACE_ITEMS_3V3]: 12,
        [RACE_ITEMS_4V4]: 16,
        [RACE_SURVIVAL]: 16,
        [RACE_ITEMLESS_1V1]: 4,
        [RACE_ITEMLESS_FFA]: 8,
        [RACE_ITEMLESS_DUOS]: 16,
        [RACE_ITEMLESS_3V3]: 12,
        [RACE_ITEMLESS_4V4]: 16,
        [BATTLE_1V1]: 4,
        [BATTLE_FFA]: 8,
        [BATTLE_DUOS]: 8,
        [BATTLE_3V3]: 12,
        [BATTLE_4V4]: 8,
        [INSTA_DUOS]: 16,
        [INSTA_3V3]: 12,
        [INSTA_4V4]: 16,
      };
    } else {
      minimumPlayers = {
        [RACE_ITEMS_FFA]: 6,
        [RACE_ITEMS_DUOS]: 6,
        [RACE_ITEMS_3V3]: 6,
        [RACE_ITEMS_4V4]: 8,
        [RACE_SURVIVAL]: 8,
        [RACE_ITEMLESS_1V1]: 2,
        [RACE_ITEMLESS_FFA]: 4,
        [RACE_ITEMLESS_DUOS]: 6,
        [RACE_ITEMLESS_3V3]: 6,
        [RACE_ITEMLESS_4V4]: 8,
        [BATTLE_1V1]: 2,
        [BATTLE_FFA]: 4,
        [BATTLE_DUOS]: 4,
        [BATTLE_3V3]: 6,
        [BATTLE_4V4]: 8,
        [INSTA_DUOS]: 6,
        [INSTA_3V3]: 6,
        [INSTA_4V4]: 8,
      };
    }

    return minimumPlayers[this.type];
  },
  getDefaultTrackOption() {
    return TRACK_OPTION_RNG;
  },
  getDefaultPlayerCount() {
    if (this.isTournament()) {
      return this.getMinimumPlayerCount();
    }

    const defaultPlayers = {
      [RACE_ITEMS_FFA]: 8,
      [RACE_ITEMS_DUOS]: 8,
      [RACE_ITEMS_3V3]: 6,
      [RACE_ITEMS_4V4]: 8,
      [RACE_SURVIVAL]: 8,
      [RACE_ITEMLESS_1V1]: 2,
      [RACE_ITEMLESS_FFA]: 4,
      [RACE_ITEMLESS_DUOS]: 8,
      [RACE_ITEMLESS_3V3]: 6,
      [RACE_ITEMLESS_4V4]: 8,
      [BATTLE_1V1]: 2,
      [BATTLE_FFA]: 4,
      [BATTLE_DUOS]: 4,
      [BATTLE_3V3]: 6,
      [BATTLE_4V4]: 8,
      [INSTA_DUOS]: 8,
      [INSTA_3V3]: 6,
      [INSTA_4V4]: 8,
    };

    return defaultPlayers[this.type];
  },
  getMaxPlayerCount() {
    let maxPlayers;

    if (this.isTournament()) {
      maxPlayers = {
        [RACE_ITEMS_FFA]: 64,
        [RACE_ITEMS_DUOS]: 16,
        [RACE_ITEMS_3V3]: 48,
        [RACE_ITEMS_4V4]: 64,
        [RACE_SURVIVAL]: 64,
        [RACE_ITEMLESS_1V1]: 8,
        [RACE_ITEMLESS_FFA]: 32,
        [RACE_ITEMLESS_DUOS]: 64,
        [RACE_ITEMLESS_3V3]: 48,
        [RACE_ITEMLESS_4V4]: 64,
        [BATTLE_1V1]: 8,
        [BATTLE_FFA]: 32,
        [BATTLE_DUOS]: 32,
        [BATTLE_3V3]: 48,
        [BATTLE_4V4]: 64,
        [INSTA_DUOS]: 64,
        [INSTA_3V3]: 48,
        [INSTA_4V4]: 64,
      };
    } else {
      maxPlayers = {
        [RACE_ITEMS_FFA]: 8,
        [RACE_ITEMS_DUOS]: 8,
        [RACE_ITEMS_3V3]: 6,
        [RACE_ITEMS_4V4]: 8,
        [RACE_SURVIVAL]: 8,
        [RACE_ITEMLESS_1V1]: 2,
        [RACE_ITEMLESS_FFA]: 8,
        [RACE_ITEMLESS_DUOS]: 8,
        [RACE_ITEMLESS_3V3]: 6,
        [RACE_ITEMLESS_4V4]: 8,
        [BATTLE_1V1]: 2,
        [BATTLE_FFA]: 8,
        [BATTLE_DUOS]: 4,
        [BATTLE_3V3]: 6,
        [BATTLE_4V4]: 8,
        [INSTA_DUOS]: 8,
        [INSTA_3V3]: 6,
        [INSTA_4V4]: 8,
      };
    }

    return maxPlayers[this.type];
  },
  hasMinimumPlayerCount() {
    return this.players.length >= this.getMinimumPlayerCount();
  },
  hasMaxPlayerCount() {
    return this.players.length === this.getMaxPlayerCount();
  },
  getDefaultTrackCount() {
    const trackCounts = {
      [RACE_ITEMS_FFA]: 8,
      [RACE_ITEMS_DUOS]: 8,
      [RACE_ITEMS_3V3]: 8,
      [RACE_ITEMS_4V4]: 10,
      [RACE_SURVIVAL]: 7,
      [RACE_ITEMLESS_1V1]: 5,
      [RACE_ITEMLESS_FFA]: 6,
      [RACE_ITEMLESS_DUOS]: 8,
      [RACE_ITEMLESS_3V3]: 6,
      [RACE_ITEMLESS_4V4]: 8,
      [BATTLE_1V1]: 5,
      [BATTLE_FFA]: 5,
      [BATTLE_DUOS]: 6,
      [BATTLE_3V3]: 6,
      [BATTLE_4V4]: 8,
      [INSTA_DUOS]: 8,
      [INSTA_3V3]: 8,
      [INSTA_4V4]: 10,
    };

    return trackCounts[this.type];
  },
  getTitle() {
    let title;

    if (this.ranked) {
      title = 'Ranked ';
    } else {
      title = 'Unranked ';
    }

    if (this.isInsta()) {
      title += 'Insta ';
    }

    if (this.isRacing()) {
      if (!this.isItemless()) {
        if (this.isFFA()) {
          title += 'FFA';
        } else if (this.isDuos()) {
          title += 'Duos';
        } else if (this.is3v3()) {
          title += '3 vs. 3';
        } else if (this.is4v4()) {
          title += '4 vs. 4';
        } else if (this.isSurvival()) {
          title += 'Survival';
        } else {
          title += UNKNOWN;
        }
      }

      if (this.isItemless()) {
        if (this.is1v1()) {
          title += 'Itemless 1 vs. 1';
        } else if (this.isFFA()) {
          title += 'Itemless FFA';
        } else if (this.isDuos()) {
          title += 'Itemless Duos';
        } else if (this.is3v3()) {
          title += 'Itemless 3 vs. 3';
        } else if (this.is4v4()) {
          title += 'Itemless 4 vs. 4';
        } else {
          title += UNKNOWN;
        }
      }
    }

    if (this.isBattle()) {
      if (this.is1v1()) {
        title += 'Battle 1 vs. 1';
      } else if (this.isFFA()) {
        title += 'Battle FFA';
      } else if (this.isDuos()) {
        title += 'Battle Duos';
      } else if (this.is3v3()) {
        title += 'Battle 3 vs. 3';
      } else if (this.is4v4()) {
        title += 'Battle 4 vs. 4';
      } else {
        title += UNKNOWN;
      }
    }

    if (!this.isBattle() && !this.isRacing()) {
      title += UNKNOWN;
    }

    if (this.isTournament()) {
      title += ' Tournament';
    } else {
      title += ' Lobby';
    }

    if (this.isRacing()) {
      const trackOption = trackOptions.find((t) => t.key === this.trackOption);
      title += ` [${trackOption.name}]`;
    } else if (this.isBattle()) {
      if (this.isDrafting()) {
        title += ' [Arena Drafting]';
      } else if (this.isPools()) {
        title += ' [Arena Pools]';
      } else if (this.isIronMan()) {
        title += ' [Iron Man]';
      } else {
        title += ' [Full RNG Arenas]';
      }
    }

    const consoleLockIndicator = this.getConsoleLockIndicator();

    if (consoleLockIndicator) {
      title += ` [${consoleLockIndicator}]`
    }

    return title;
  },
  getConsoleLockIndicator() {
    if (this.consoles.length === 1) {
      return this.consoles[0];
    }

    return null;
  },
  getIcon() {
    if (this.isTournament()) {
      return 'https://static.wikia.nocookie.net/crashban/images/8/81/NitroFueledTrophyRender.png';
    }

    const icons = {
      [RACE_ITEMS_FFA]: 'https://i.imgur.com/wD4xrSw.png', // Single Bomb
      [RACE_ITEMS_DUOS]: 'https://i.imgur.com/lo5dwcJ.png', // Uka + Aku Mask
      [RACE_ITEMS_3V3]: 'https://i.imgur.com/0A2LVaY.png', // Triple Missile
      [RACE_ITEMS_4V4]: 'https://i.imgur.com/3dvcaur.png', // Firehawk
      [RACE_SURVIVAL]: 'https://i.imgur.com/QqA2CK5.png', // Poison Symbol
      [RACE_ITEMLESS_1V1]: 'https://i.imgur.com/45dXDSf.png', // Champion Kart
      [RACE_ITEMLESS_FFA]: 'https://i.imgur.com/ZmrfJJN.png', // Daredevil
      [RACE_ITEMLESS_DUOS]: 'https://i.imgur.com/7gFxsmu.png', // Xfinity Kart
      [RACE_ITEMLESS_3V3]: 'https://i.imgur.com/ZCv0Uwl.png', // Mammoth
      [RACE_ITEMLESS_4V4]: 'https://i.imgur.com/fdmJjfi.png', // Nitro GT
      [BATTLE_1V1]: 'https://i.imgur.com/0BPdwId.png', // Aku Aku
      [BATTLE_FFA]: 'https://i.imgur.com/dCs3j9Y.png', // Invisibility
      [BATTLE_DUOS]: 'https://i.imgur.com/4fFQLMU.png', // Master Wheels
      [BATTLE_3V3]: 'https://i.imgur.com/4USZueO.png', // Sparx
      [BATTLE_4V4]: 'https://i.imgur.com/UMYa2RH.png', // Neon Hawk
      [INSTA_DUOS]: 'https://i.imgur.com/lo5dwcJ.png', // Uka + Aku Mask (same as Duos)
      [INSTA_3V3]: 'https://i.imgur.com/0A2LVaY.png', // Triple Missile (same as 3 vs. 3)
      [INSTA_4V4]: 'https://i.imgur.com/3dvcaur.png', // Firehawk (same as 4 vs. 4)
    };

    return icons[this.type];
  },
  getRoleName() {
    let roleName;
    if (this.ranked) {
      roleName = 'Ranked ';
    } else {
      roleName = 'Unranked ';
    }

    const modeNames = {
      [RACE_ITEMS_FFA]: 'FFA',
      [RACE_ITEMS_DUOS]: 'Duos',
      [RACE_ITEMS_3V3]: '3v3',
      [RACE_ITEMS_4V4]: '4v4',
      [RACE_SURVIVAL]: 'Survival',
      [RACE_ITEMLESS_1V1]: 'Itemless 1v1',
      [RACE_ITEMLESS_FFA]: 'Itemless FFA',
      [RACE_ITEMLESS_DUOS]: 'Itemless Duos',
      [RACE_ITEMLESS_3V3]: 'Itemless 3v3',
      [RACE_ITEMLESS_4V4]: 'Itemless 4v4',
      [BATTLE_1V1]: 'Battle 1v1',
      [BATTLE_FFA]: 'Battle FFA',
      [BATTLE_DUOS]: 'Battle Duos',
      [BATTLE_3V3]: 'Battle 3v3',
      [BATTLE_4V4]: 'Battle 4v4',
      [INSTA_DUOS]: 'Duos',
      [INSTA_3V3]: '3v3',
      [INSTA_4V4]: '4v4',
    };

    roleName += modeNames[this.type];

    return roleName;
  },
  getColor() {
    if (this.isTournament()) {
      return 16318337; // Light Yellow
    }

    const colors = {
      [RACE_ITEMS_FFA]: 3707391, // Blue
      [RACE_ITEMS_DUOS]: 16732141, // Pink
      [RACE_ITEMS_3V3]: 16724019, // Red
      [RACE_ITEMS_4V4]: 9568066, // Green
      [RACE_SURVIVAL]: 0, // Black
      [RACE_ITEMLESS_1V1]: 6360569, // Purple
      [RACE_ITEMLESS_FFA]: 7917555, // Sky Blue
      [RACE_ITEMLESS_DUOS]: 16777215, // White
      [RACE_ITEMLESS_3V3]: 14138792, // Beige
      [RACE_ITEMLESS_4V4]: 6856623, // Teal
      [BATTLE_1V1]: 7292965, // Brown
      [BATTLE_FFA]: 9605778, // Grey
      [BATTLE_DUOS]: 7944547, // Magenta
      [BATTLE_3V3]: 15714364, // Honey
      [BATTLE_4V4]: 11299064, // Medium Pink
      [INSTA_DUOS]: 16732141, // Pink
      [INSTA_3V3]: 16724019, // Red
      [INSTA_4V4]: 9568066, // Green
    };

    return colors[this.type];
  },
  getLobbyEndCooldown() {
    if (this.isTournament()) {
      return null;
    }

    const remindMinutes = this.getRemindMinutes();
    return remindMinutes[0];
  },
  hasLeaderboard() {
    // eslint-disable-next-line no-prototype-builtins
    if (!LEADERBOARDS.hasOwnProperty(this.type)) {
      return false;
    }

    return LEADERBOARDS[this.type] !== null;
  },
  getLeaderboard() {
    if (!this.hasLeaderboard()) {
      return null;
    }

    return LEADERBOARDS[this.type];
  },
  getRemindMinutes() {
    if (this.isTournament()) {
      return null;
    }

    // 1. Adding allowed 2 Minute breaks between races, at most 3 times per lobby
    // 2. Assuming every player takes 1.5 Minutes to join
    // 3. Adding 1.5 Minutes per Race/Battle due to load screen
    let remindMinutesMax = 6 + (this.players.length * 1.5) + (this.trackCount * 1.5);

    // Drafting takes 5 more minutes
    if (this.trackOption === TRACK_OPTION_DRAFT) {
      remindMinutesMax += 5;
    }

    if (this.isRacing()) {
      // 3 Laps = 2 Minutes per Race, 5 Laps = 4 Minutes and 7 Laps = 6 Minutes
      remindMinutesMax += ((this.lapCount - 1) * this.trackCount);
    } else if (this.isBattle()) {
      // Battle is always using 6 minutes
      remindMinutesMax += (6 * this.trackCount);
    }

    const remindMinutesMin = Math.round(remindMinutesMax * 0.8);

    return [remindMinutesMin, remindMinutesMax];
  },
  getCloseRemindMinutes() {
    if (this.isTournament()) {
      return [110, 115];
    }

    return [55];
  },
  getCloseAfterMinutes() {
    if (this.isTournament()) {
      return 120;
    }

    return 60;
  },
  getPingMinutes() {
    if (this.isTournament()) {
      return null;
    }

    const remindMinutes = this.getRemindMinutes();
    const remindMinutesMax = remindMinutes[1];

    return [
      Math.round(remindMinutesMax * 1.2),
      Math.round(remindMinutesMax * 1.4),
      Math.round(remindMinutesMax * 1.6),
      Math.round(remindMinutesMax * 1.8),
    ];
  },
  getMaxTrackCount() {
    if (this.isTournament()) {
      return this.getDefaultTrackCount();
    }

    const maxTrackCount = {
      [RACE_ITEMS_FFA]: 37,
      [RACE_ITEMS_DUOS]: 37,
      [RACE_ITEMS_3V3]: 37,
      [RACE_ITEMS_4V4]: 37,
      [RACE_SURVIVAL]: 7,
      [RACE_ITEMLESS_1V1]: 37,
      [RACE_ITEMLESS_FFA]: 37,
      [RACE_ITEMLESS_DUOS]: 37,
      [RACE_ITEMLESS_3V3]: 37,
      [RACE_ITEMLESS_4V4]: 37,
      [BATTLE_1V1]: 12,
      [BATTLE_FFA]: 12,
      [BATTLE_DUOS]: 12,
      [BATTLE_3V3]: 12,
      [BATTLE_4V4]: 12,
      [INSTA_DUOS]: 37,
      [INSTA_3V3]: 37,
      [INSTA_4V4]: 37,
    };

    return maxTrackCount[this.type];
  },
  getDefaultLapCount() {
    const defaultLapCount = {
      [RACE_ITEMS_FFA]: 5,
      [RACE_ITEMS_DUOS]: 5,
      [RACE_ITEMS_3V3]: 5,
      [RACE_ITEMS_4V4]: 5,
      [RACE_SURVIVAL]: 5,
      [RACE_ITEMLESS_1V1]: 3,
      [RACE_ITEMLESS_FFA]: 3,
      [RACE_ITEMLESS_DUOS]: 3,
      [RACE_ITEMLESS_3V3]: 3,
      [RACE_ITEMLESS_4V4]: 3,
      [BATTLE_1V1]: 1,
      [BATTLE_FFA]: 1,
      [BATTLE_DUOS]: 1,
      [BATTLE_3V3]: 1,
      [BATTLE_4V4]: 1,
      [INSTA_DUOS]: 5,
      [INSTA_3V3]: 5,
      [INSTA_4V4]: 5,
    };

    return defaultLapCount[this.type];
  },
  isIronMan() {
    // eslint-disable-next-line max-len
    return (this.trackCount === this.getMaxTrackCount() && !this.isTournament() && !this.isSurvival());
  },
  getTrackOptions() {
    // all lobby types at least have full rng and pools
    const availableTrackOptions = [
      TRACK_OPTION_RNG,
      TRACK_OPTION_POOLS,
    ];

    if (!(this.isTournament() && this.type === RACE_ITEMS_DUOS)
      && ![RACE_ITEMLESS_FFA, BATTLE_1V1, BATTLE_FFA].includes(this.type)) {
      availableTrackOptions.push(TRACK_OPTION_DRAFT);
    }

    return availableTrackOptions;
  },
  getBannedTracks() {
    const bannedTracks = [];

    if (this.regions.length !== 1) {
      bannedTracks.push(TRACK_HYPER_SPACEWAY);
    }

    if (this.isItemless()) {
      bannedTracks.push(TRACK_DRAGON_MINES);
      bannedTracks.push(TRACK_MEGAMIX_MANIA);
    }

    if (this.isBattle() && this.is1v1()) {
      bannedTracks.push(ARENA_FROZEN_FRENZY);
      bannedTracks.push(ARENA_MAGNETIC_MAYHEM);
    }

    return bannedTracks;
  },
  getDefaultRank() {
    const defaultRanks = {
      [RACE_ITEMS_FFA]: 1200,
      [RACE_ITEMS_DUOS]: 1200,
      [RACE_ITEMS_3V3]: 1200,
      [RACE_ITEMS_4V4]: 1200,
      [RACE_SURVIVAL]: 1200,
      [RACE_ITEMLESS_1V1]: 1200,
      [RACE_ITEMLESS_FFA]: 1200,
      [RACE_ITEMLESS_DUOS]: 1200,
      [RACE_ITEMLESS_3V3]: 1200,
      [RACE_ITEMLESS_4V4]: 1200,
      [BATTLE_1V1]: 1200,
      [BATTLE_FFA]: 1200,
      [BATTLE_DUOS]: 1200,
      [BATTLE_3V3]: 1200,
      [BATTLE_4V4]: 1200,
      [INSTA_DUOS]: 1200,
      [INSTA_3V3]: 1200,
      [INSTA_4V4]: 1200,
    };

    return defaultRanks[this.type];
  },
  canBeRanked() {
    // eslint-disable-next-line max-len
    return (
      (this.lapCount === this.getDefaultLapCount() || this.isBattle())
      && this.engineRestriction === null
      && this.trackCount === this.getDefaultTrackCount()
      && this.hasLeaderboard()
    );
  },
  getStartedIcon() {
    return 'https://i.imgur.com/cD0sLmQ.png';
  },
  isStandard() {
    return this.mode === LOBBY_MODE_STANDARD;
  },
  isTournament() {
    return this.mode === LOBBY_MODE_TOURNAMENT;
  },
  hasTournamentsEnabled() {
    const enabled = {
      [RACE_ITEMS_FFA]: true,
      [RACE_ITEMS_DUOS]: true,
      [RACE_ITEMS_3V3]: false,
      [RACE_ITEMS_4V4]: false,
      [RACE_SURVIVAL]: false,
      [RACE_ITEMLESS_1V1]: false,
      [RACE_ITEMLESS_FFA]: true,
      [RACE_ITEMLESS_DUOS]: false,
      [RACE_ITEMLESS_3V3]: false,
      [RACE_ITEMLESS_4V4]: false,
      [BATTLE_1V1]: false,
      [BATTLE_FFA]: false,
      [BATTLE_DUOS]: false,
      [BATTLE_3V3]: false,
      [BATTLE_4V4]: false,
      [INSTA_DUOS]: false,
      [INSTA_3V3]: false,
      [INSTA_4V4]: false,
    };

    return enabled[this.type];
  },
  getModePoolForTeamBalance() {
    const modePools = {
      [RACE_ITEMS_FFA]: [RACE_ITEMS_FFA],
      [RACE_ITEMS_DUOS]: [RACE_ITEMS_FFA, RACE_ITEMS_DUOS, RACE_ITEMS_3V3, RACE_ITEMS_4V4, INSTA_DUOS, INSTA_3V3, INSTA_4V4],
      [RACE_ITEMS_3V3]: [RACE_ITEMS_FFA, RACE_ITEMS_DUOS, RACE_ITEMS_3V3, RACE_ITEMS_4V4, INSTA_DUOS, INSTA_3V3, INSTA_4V4],
      [RACE_ITEMS_4V4]: [RACE_ITEMS_FFA, RACE_ITEMS_DUOS, RACE_ITEMS_3V3, RACE_ITEMS_4V4, INSTA_DUOS, INSTA_3V3, INSTA_4V4],
      [RACE_SURVIVAL]: [RACE_SURVIVAL],
      [RACE_ITEMLESS_1V1]: [RACE_ITEMLESS_1V1],
      [RACE_ITEMLESS_FFA]: [RACE_ITEMLESS_FFA],
      [RACE_ITEMLESS_DUOS]: [RACE_ITEMLESS_FFA, RACE_ITEMLESS_DUOS, RACE_ITEMLESS_3V3, RACE_ITEMLESS_4V4],
      [RACE_ITEMLESS_3V3]: [RACE_ITEMLESS_FFA, RACE_ITEMLESS_DUOS, RACE_ITEMLESS_3V3, RACE_ITEMLESS_4V4],
      [RACE_ITEMLESS_4V4]: [RACE_ITEMLESS_FFA, RACE_ITEMLESS_DUOS, RACE_ITEMLESS_3V3, RACE_ITEMLESS_4V4],
      [BATTLE_1V1]: [BATTLE_1V1],
      [BATTLE_FFA]: [BATTLE_FFA],
      [BATTLE_DUOS]: [BATTLE_FFA, BATTLE_DUOS, BATTLE_3V3, BATTLE_4V4],
      [BATTLE_3V3]: [BATTLE_FFA, BATTLE_DUOS, BATTLE_3V3, BATTLE_4V4],
      [BATTLE_4V4]: [BATTLE_FFA, BATTLE_DUOS, BATTLE_3V3, BATTLE_4V4],
      [INSTA_DUOS]: [RACE_ITEMS_FFA, RACE_ITEMS_DUOS, RACE_ITEMS_3V3, RACE_ITEMS_4V4, INSTA_DUOS, INSTA_3V3, INSTA_4V4],
      [INSTA_3V3]: [RACE_ITEMS_FFA, RACE_ITEMS_DUOS, RACE_ITEMS_3V3, RACE_ITEMS_4V4, INSTA_DUOS, INSTA_3V3, INSTA_4V4],
      [INSTA_4V4]: [RACE_ITEMS_FFA, RACE_ITEMS_DUOS, RACE_ITEMS_3V3, RACE_ITEMS_4V4, INSTA_DUOS, INSTA_3V3, INSTA_4V4],
    };

    return modePools[this.type];
  },
  getTrackPools() {
    const trackOption = trackOptions.find((t) => t.key === this.trackOption);

    if (this.trackCount <= 0 || this.isTournament() || !trackOption.hasDefinitionFile) {
      return [];
    }

    let pools;

    if (this.isRacing()) {
      // eslint-disable-next-line max-len
      if ([TRACK_OPTION_RNG, TRACK_OPTION_POOLS].includes(this.trackOption)) {
        if (this.isItemless()) {
          pools = poolItemless3;
        } else if (this.trackCount % 3 === 0) {
          pools = poolItems3;
        } else if (this.trackCount % 4 === 0) {
          pools = poolItems4;
        } else if (this.trackCount % 5 === 0) {
          pools = poolItems5;
        } else {
          pools = poolItems4;
        }

        if (this.trackOption === TRACK_OPTION_RNG) {
          pools = [pools.flat()];
        }
      } else {
        pools = poolItems4;
      }
    } else if (this.isBattle()) {
      if (this.is1v1()) {
        pools = poolBattle3;
      } else if (this.trackCount % 3 === 0) {
        pools = poolBattle3;
      } else if (this.trackCount % 4 === 0) {
        pools = poolBattle4;
      } else if (this.trackCount % 5 === 0) {
        pools = poolBattle5;
      } else {
        pools = poolBattle4;
      }
    } else {
      pools = [];
    }

    return pools;
  },
  initializeDraft(channel) {
    if (!this.isDrafting()) {
      return;
    }

    const teams = ['A', 'B'];
    const promises = [];
    const playersToFetch = [];

    if (this.isSolos()) {
      playersToFetch.push(...this.players);
    } else {
      for (const team in this.teamList) {
        playersToFetch.push(getRandomArrayElement(this.teamList[team]));
      }
    }

    playersToFetch.forEach((p) => {
      promises.push(client.guilds.cache.get(this.guild).members.fetch(p));
    });

    Promise.all(promises).then((captains) => {
      const bannedTracks = this.getBannedTracks();
      const options = {
        enableDragonMines: !bannedTracks.includes(TRACK_DRAGON_MINES),
        enableHyperSpaceway: !bannedTracks.includes(TRACK_HYPER_SPACEWAY),
        enableRetroStadium: false,
        enableSpyroCircuit: !bannedTracks.includes(TRACK_SPYRO_CIRCUIT),
        showDraftLog: true,
        pickTimeout: 60,
        pinTrackList: true,
        onTracksSelected: async (tracks) => {
          await this.constructor.updateOne({ _id: this._id, started: true }, { $set: { scoringTracks: tracks } });
        },
      };

      switch (this.type) {
        case RACE_ITEMS_FFA:
          discordDraft(channel, captains, TYPE_FFA, 0, this.trackCount, options).then();
          break;
        case RACE_ITEMS_DUOS:
          discordDraft(channel, captains, TYPE_DUOS, 0, this.trackCount, options).then();
          break;
        case RACE_ITEMS_3V3:
          createDraft(channel, '1', teams, captains);
          break;
        case RACE_ITEMS_4V4:
          createDraft(channel, '0', teams, captains);
          break;
        case RACE_SURVIVAL:
          discordDraft(channel, captains, TYPE_FFA, 0, this.trackCount, options).then();
          break;
        case RACE_ITEMLESS_FFA:
          discordDraft(channel, captains, TYPE_FFA, 0, this.trackCount, options).then();
          break;
        case RACE_ITEMLESS_DUOS:
          discordDraft(channel, captains, TYPE_DUOS, 0, this.trackCount, options).then();
          break;
        case RACE_ITEMLESS_3V3:
          createDraft(channel, '2', teams, captains);
          break;
        case RACE_ITEMLESS_4V4:
          createDraft(channel, '1', teams, captains);
          break;
        case BATTLE_DUOS:
          createDraftv2(channel, 2, 0, 3, 30, captains);
          break;
        case BATTLE_3V3:
          createDraftv2(channel, 2, 0, 3, 30, captains);
          break;
        case BATTLE_4V4:
          createDraftv2(channel, 2, 0, 4, 30, captains);
          break;
        default:
          break;
      }
    });
  },
  canRerollTracks() {
    return !(this.isTournament() || this.isIronMan() || this.trackOption === TRACK_OPTION_DRAFT || this.isBattle());
  }
};

module.exports.Lobby = model('lobby', Lobby);
