const { Room } = require('../db/models/room');
const { withRoomLock, releaseRoom } = require('../utils/lobbyRoomPermissions');

module.exports = {
  name: 'rooms',
  description: 'Ranked lobby rooms',
  guildOnly: true,
  aliases: ['room'],
  permissions: ['MANAGE_CHANNELS', 'MANAGE_ROLES'],
  // eslint-disable-next-line consistent-return
  async execute(message, args) {
    if (!args.length) {
      // eslint-disable-next-line consistent-return
      return Room.find({ guild: message.guild.id }).sort({ number: 1 }).then((docs) => {
        if (!docs.length) {
          return message.channel.info('There are no rooms.');
        }

        const rooms = docs.map((doc) => {
          const channelName = `lobby-room-${doc.number}`;
          // eslint-disable-next-line max-len
          const channel = message.guild.channels.cache.find((c) => c.name.toLowerCase() === channelName.toLowerCase());
          let out = '';

          if (channel) {
            out += `${channel}`;
          } else {
            out += `#${channelName} (deleted)`;
          }

          if (doc.lobby) {
            out += ` - ${doc.lobby}`;
          } else {
            out += ' - Free';
          }

          return out;
        });

        message.channel.info(rooms.join('\n'));
      });
    } else {
      if (!message.member.isStaff()) {
        return message.channel.warn('You don\'t have permission to do that!');
      }

      const action = args.shift();

      if (action === 'free') {
        const number = args.shift();
        return withRoomLock(message.guild.id, async () => {
          if (number === 'all') {
            const docs = await Room.find({ guild: message.guild.id });
            const failed = [];
            for (const doc of docs) {
              try {
                await releaseRoom(message.guild, doc);
              } catch (error) {
                failed.push(doc.number);
                // eslint-disable-next-line no-console
                console.error(`Could not free room ${doc.number}:`, error);
              }
            }
            if (failed.length) {
              return { failed, freed: docs.length - failed.length };
            }
            return { failed, freed: docs.length };
          } else {
            const doc = await Room.findOne({ guild: message.guild.id, number });
            if (!doc) {
              return null;
            }
            await releaseRoom(message.guild, doc);
            return { failed: [], freed: 1 };
          }
        }).then((result) => {
          if (!result) return message.channel.warn('There is no room with this number.');
          if (result.failed.length) {
            return message.channel.error(`Freed ${result.freed} rooms. Could not free rooms: ${result.failed.join(', ')}. Check bot permissions and retry.`);
          }
          return message.channel.success(number === 'all' ? 'All rooms were freed.' : 'Room was freed.');
        }).catch(async (error) => {
          // eslint-disable-next-line no-console
          console.error('Could not free room:', error);
          // eslint-disable-next-line no-console
          await message.channel.error('Could not free the room. Check bot permissions and retry.').catch(console.error);
        });
      }
    }
  },
};
