const AsyncLock = require('async-lock');

const roomLock = new AsyncLock();

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
async function releaseRoom(guild, room) {
  let channel = getRoomChannel(guild, room.number);
  if (channel) {
    try {
      channel = await clearRoomMemberPermissions(channel);
    } catch (error) {
      // A deleted channel cannot retain access. Permission/API failures must block reuse.
      if (error.code !== 10003) throw error;
      channel = null;
    }
  }

  const previousLobby = room.lobby;
  room.lobby = null;
  try {
    await room.save();
  } catch (error) {
    room.lobby = previousLobby;
    throw error;
  }
  return channel;
}

module.exports = {
  withRoomLock,
  getRoomChannel,
  clearRoomMemberPermissions,
  releaseRoom,
};
