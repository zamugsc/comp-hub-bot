const { Lobby } = require('../db/models/lobby');
const { Room } = require('../db/models/room');
const { withRoomLock, getRoomChannel } = require('./lobbyRoomPermissions');

const ELIMINATION_GRACE_MS = 5 * 60 * 1000;
const pendingCleanups = new Map();

function cancelCleanup(key) {
  const pending = pendingCleanups.get(key);
  if (pending) clearTimeout(pending.timer);
  pendingCleanups.delete(key);
}

// Called under the same guild lock used by room allocation, grants and release.
function scheduleCleanup(guild, lobby) {
  const key = `${guild.id}:${lobby.id}`;
  const entries = lobby.tournamentPermissionRemovals || [];
  if (!entries.length) {
    cancelCleanup(key);
    return;
  }
  const deadline = Math.min(...entries.map((entry) => new Date(entry.removeAt).getTime()));
  const existing = pendingCleanups.get(key);
  if (existing && existing.deadline === deadline) return;
  cancelCleanup(key);
  const pending = { deadline, reported: false };
  pendingCleanups.set(key, pending);

  const run = async () => {
    try {
      await withRoomLock(guild.id, async () => {
        if (pendingCleanups.get(key) !== pending) return;
        const current = await Lobby.findOne({ _id: lobby.id });
        if (!current || !current.started || !current.isTournament()) {
          cancelCleanup(key);
          return;
        }
        const removals = current.tournamentPermissionRemovals || [];
        const due = removals.filter((entry) => new Date(entry.removeAt).getTime() <= Date.now());
        for (const number of new Set(due.map((entry) => entry.roomNumber))) {
          const room = await Room.findOne({ guild: guild.id, number, lobby: current.id });
          // A released/reassigned room must never be touched by an old callback.
          if (!room) continue;
          const channel = getRoomChannel(guild, number);
          if (!channel) continue;
          let fresh;
          try {
            fresh = await channel.fetch(true);
          } catch (error) {
            if (error.code === 10003) continue;
            throw error;
          }
          for (const entry of due.filter((item) => item.roomNumber === number)) {
            // Re-read the latest roster, including any later rounds. Survivors
            // are exempt even if an obsolete pending entry names them.
            if (current.players.includes(entry.playerId)) continue;
            const overwrite = fresh.permissionOverwrites.get(entry.playerId);
            if (overwrite && overwrite.type === 'member') {
              await overwrite.delete('Tournament elimination: five-minute chat grace expired');
            }
          }
        }
        if (due.length) {
          const ids = due.map((entry) => entry.playerId);
          // Update only the queue: round posting may be saving other lobby fields.
          await Lobby.updateOne({ _id: current.id }, {
            $pull: { tournamentPermissionRemovals: { playerId: { $in: ids } } },
          });
          current.tournamentPermissionRemovals = removals.filter((entry) => !ids.includes(entry.playerId));
        }
        cancelCleanup(key);
        scheduleCleanup(guild, current);
      });
    } catch (error) {
      // Persisted entries survive partial deletes, failed saves and restarts.
      // eslint-disable-next-line no-console
      console.error(`Could not clear eliminated tournament players for ${lobby.id}:`, error);
      if (pendingCleanups.get(key) !== pending) return;
      pending.timer = setTimeout(run, 60000);
      if (!pending.reported) {
        pending.reported = true;
        const channel = getRoomChannel(guild, entries[0].roomNumber);
        if (channel) {
          // eslint-disable-next-line no-console
          await channel.warn('Could not clear eliminated players\' chat permissions. Staff should check bot permissions; cleanup will retry.').catch(console.error);
        }
      }
    }
  };
  pending.timer = setTimeout(run, Math.max(0, deadline - Date.now()));
}

async function saveTournamentAdvancement(guild, lobby, previousPlayers) {
  return withRoomLock(guild.id, async () => {
    const current = await Lobby.findOne({ _id: lobby.id });
    if (!current || !current.started || !current.isTournament()
      || current.players.length !== previousPlayers.length
      || current.players.some((id) => !previousPlayers.includes(id))) {
      throw new Error('Tournament roster changed; retry advancement with the current round.');
    }
    const room = await Room.findOne({ guild: guild.id, lobby: lobby.id });
    if (!room) throw new Error('Tournament room is no longer assigned.');
    const removals = (current.tournamentPermissionRemovals || []).map((entry) => ({
      playerId: entry.playerId, removeAt: entry.removeAt, roomNumber: entry.roomNumber,
    }));
    const removeAt = new Date(Date.now() + ELIMINATION_GRACE_MS);
    for (const playerId of previousPlayers) {
      if (!lobby.players.includes(playerId) && !removals.some((entry) => entry.playerId === playerId)) {
        removals.push({ playerId, removeAt, roomNumber: room.number });
      }
    }
    // One save commits the roster and its deadlines together. Later rounds merge
    // the fresh queue instead of resetting earlier elimination deadlines.
    lobby.tournamentPermissionRemovals = removals;
    await lobby.save();
    scheduleCleanup(guild, lobby);
  });
}

async function resumeTournamentCleanups(client) {
  const lobbies = await Lobby.find({ started: true, 'tournamentPermissionRemovals.0': { $exists: true } });
  for (const lobby of lobbies) {
    const guild = client.guilds.cache.get(lobby.guild);
    if (guild) {
      await withRoomLock(guild.id, async () => {
        const current = await Lobby.findOne({ _id: lobby.id });
        if (current && current.started && current.isTournament()) scheduleCleanup(guild, current);
      });
    }
  }
}

module.exports = { saveTournamentAdvancement, resumeTournamentCleanups };
