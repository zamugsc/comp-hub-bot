const AsyncLock = require('async-lock');
const { Room } = require('../db/models/room');

const roomLock = new AsyncLock();
const ROOM_CHAT_GRACE_MS = 5 * 60 * 1000;
const pendingCleanups = new Map();

function cleanupKey(guild, room) {
  return `${guild.id}:${room.number}`;
}

function cancelRoomCleanup(guild, room) {
  const key = cleanupKey(guild, room);
  const pending = pendingCleanups.get(key);
  if (pending) clearTimeout(pending.timer);
  pendingCleanups.delete(key);
}

function scheduleRoomCleanup(guild, room) {
  const key = cleanupKey(guild, room);
  const deadline = new Date(room.cleanupAt).getTime();
  const existing = pendingCleanups.get(key);
  if (existing && existing.deadline === deadline) return;
  cancelRoomCleanup(guild, room);
  const pending = { deadline, reported: false };
  pendingCleanups.set(key, pending);

  const run = async () => {
    try {
      await withRoomLock(guild.id, async () => {
        // A cancelled callback may already be queued behind a reservation/reset.
        if (pendingCleanups.get(key) !== pending) return;
        const current = await Room.findOne({ guild: guild.id, number: room.number });
        if (!current || current.lobby || !current.cleanupAt
          || new Date(current.cleanupAt).getTime() !== deadline) {
          cancelRoomCleanup(guild, room);
          return;
        }
        await releaseRoom(guild, current);
      });
    } catch (error) {
      // Keep the persisted deadline and retry transient Discord/database failures.
      // eslint-disable-next-line no-console
      console.error(`Could not clear expired room ${room.number}:`, error);
      if (pendingCleanups.get(key) !== pending) return;
      pending.timer = setTimeout(run, 60000);
      if (!pending.reported) {
        pending.reported = true;
        const channel = getRoomChannel(guild, room.number);
        if (channel) {
          // eslint-disable-next-line no-console
          await channel.warn('Could not clear the post-lobby chat permissions. Staff should check bot permissions; cleanup will retry.').catch(console.error);
        }
      }
    }
  };
  pending.timer = setTimeout(run, Math.max(0, deadline - Date.now()));
}

async function resumeRoomCleanups(client) {
  const rooms = await Room.find({ cleanupAt: { $ne: null }, lobby: null });
  for (const room of rooms) {
    const guild = client.guilds.cache.get(room.guild);
    if (guild) {
      await withRoomLock(guild.id, async () => {
        // The scan can overlap a reservation or another grace period.
        const current = await Room.findOne({ guild: guild.id, number: room.number });
        if (current && !current.lobby && current.cleanupAt) scheduleRoomCleanup(guild, current);
      });
    }
  }
}

// Share one lock across allocation, cleanup, and grants. A guild key also prevents
// simultaneous starts from selecting the same free room. Run only one bot process.
function withRoomLock(guildId, work) {
  return roomLock.acquire(String(guildId), work);
}

function getRoomChannel(guild, number) {
  const name = `lobby-room-${number}`;
  return guild.channels.cache.find((channel) => channel.type === 'text'
    && channel.name.toLowerCase() === name);
}

async function clearRoomMemberPermissions(channel) {
  // Refresh from Discord: a staff edit may not have reached the gateway cache yet.
  const freshChannel = await channel.fetch(true);
  for (const overwrite of freshChannel.permissionOverwrites.values()) {
    if (overwrite.type === 'member') {
      await overwrite.delete('Reset temporary lobby room access');
    }
  }
  return freshChannel;
}

// Caller must hold withRoomLock and read the current room assignment inside it.
async function releaseRoom(guild, room, { delayCleanup = false } = {}) {
  let channel = getRoomChannel(guild, room.number);
  if (channel && !delayCleanup) {
    try {
      channel = await clearRoomMemberPermissions(channel);
    } catch (error) {
      // A deleted channel cannot retain access. Permission/API failures must block reuse.
      if (error.code !== 10003) throw error;
      channel = null;
    }
  }

  const previousLobby = room.lobby;
  const previousGame = room.tournamentGame;
  const previousCleanupAt = room.cleanupAt;
  room.lobby = null;
  room.tournamentGame = null;
  room.cleanupAt = delayCleanup && channel ? new Date(Date.now() + ROOM_CHAT_GRACE_MS) : null;
  try {
    await room.save();
  } catch (error) {
    room.lobby = previousLobby;
    room.tournamentGame = previousGame;
    room.cleanupAt = previousCleanupAt;
    throw error;
  }
  if (room.cleanupAt) scheduleRoomCleanup(guild, room);
  else cancelRoomCleanup(guild, room);
  return channel;
}

module.exports = {
  withRoomLock,
  getRoomChannel,
  clearRoomMemberPermissions,
  releaseRoom,
  resumeRoomCleanups,
};
