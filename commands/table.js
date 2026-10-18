const drawTable = require('../utils/drawTable');

module.exports = {
  name: 'table',
  description: 'Generate score table. https://gb.hlorenzi.com',
  cooldown: 10,
  guildOnly: true,
  aliases: ['t'],
  // eslint-disable-next-line consistent-return
  async execute(message, args = []) {
    if ((args[0] || '').toLowerCase() === 'import') {
      const match = message.content.match(/^\S+[ \t]+import\b[ \t]*(?:\r?\n)?([\s\S]*)$/i);
      return message.client.commands.get('lobby').importScores(message, match ? match[1] : '');
    }
    const rows = message.content.split('\n');
    rows.shift();

    if (!rows.length) {
      return message.channel.warn('Empty table.');
    }

    message.channel.info('Generating the table...').then((m) => {
      drawTable(rows.join('\n')).then((attachment) => {
        message.channel.send(message.author, { files: [attachment] }).then(() => {
          message.delete();
          m.delete();
          // eslint-disable-next-line no-console
        }).catch(console.error);
      });
    });
  },
};
