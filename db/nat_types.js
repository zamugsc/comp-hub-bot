const getEmote = require('../utils/getEmote');

module.exports.natTypes = [
  {
    key: 'nat1',
    name: 'NAT 1',
    description: 'Choose if you are not behind a firewall.',
    emote: getEmote('NAT_1', '1559797995602452520'),
    default: false,
  },
  {
    key: 'nat2o',
    name: 'NAT 2 Open',
    description: 'Choose if you have portforwarding or UPNP enabled.',
    emote: getEmote('NAT_2_OPEN', '1559797994256076822'),
    default: false,
  },
  {
    key: 'nat2c',
    name: 'NAT 2 Closed',
    description: 'Choose if you are unsure.',
    emote: getEmote('NAT_2_CLOSED', '1559797998941118555'),
    default: true,
  },
  {
    key: 'nat3',
    name: 'NAT 3',
    description: 'Choose if you use mobile hotspot internet.',
    emote: getEmote('NAT_3', '1559797997221584906'),
    default: false,
  },
];
