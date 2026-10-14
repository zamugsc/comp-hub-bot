const mongoose = require('mongoose');
const { consoles } = require('../consoles');
const { engineStyles } = require('../engine_styles');
const { hostGrades } = require('../host_grades');
const { natTypes } = require('../nat_types');
const { regions } = require('../regions');

const { Schema, model } = mongoose;

const keyMap = (k) => k.key;

const consoleKeys = consoles.map(keyMap);
const engineKeys = engineStyles.map(keyMap);
const hostGradeKeys = hostGrades.map(keyMap);
const natTypeNames = natTypes.map((n) => n.name);
const regionKeys = regions.map(keyMap);

const Player = new Schema({
  discordId: String,
  psn: String,
  flag: String,
  region: { type: String, enum: regionKeys.concat(null) },
  languages: [String],
  birthday: String,
  discordVc: Boolean,
  ps4Vc: Boolean,
  nat: { type: String, enum: natTypeNames.concat(null) },
  timeZone: String,
  favCharacter: String,
  favTrack: String,
  consoles: { type: [String], enum: consoleKeys.concat(null) },
  rankedName: String,
  favArena: String,
  color: String,
  engineStyle: { type: String, enum: engineKeys.concat(null) },
  oldPSNIDs: [String],
  oldRankedNames: [String],
  hostGrade: { type: String, enum: hostGradeKeys.concat(null) },
});

Player.methods = {
  getNatIcon() {
    // eslint-disable-next-line global-require
    const { client } = require('../../bot');

    let icon;

    if (!this.nat) {
      icon = client.getEmote('NAT_2_CLOSED', '1559797998941118555');
    } else {
      const natType = natTypes.find((n) => n.name === this.nat);
      switch (natType.key) {
        case 'nat1':
          icon = client.getEmote('NAT_1', '1559797995602452520');
          break;
        case 'nat2o':
          icon = client.getEmote('NAT_2_OPEN', '1559797994256076822');
          break;
        case 'nat2c':
          icon = client.getEmote('NAT_2_CLOSED', '1559797998941118555');
          break;
        case 'nat3':
          icon = client.getEmote('NAT_3', '1559797997221584906');
          break;
        default:
          icon = client.getEmote('NAT_2_CLOSED', '1559797998941118555');
          break;
      }
    }

    return icon;
  },
  getConsoleIcon() {
    // eslint-disable-next-line global-require
    const { client } = require('../../bot');

    let icon;

    if (!this.consoles) {
      icon = '';
    } else {
      const cons = Object.values(this.consoles).includes('PS5');
      if(cons)
      {
        icon = client.getEmote('PS5', '1559798002133237921');
      }
      else
      {
        icon = client.getEmote('PS4', '1559798000430227456');
      }
    }

    return icon;
  },
};

module.exports.Player = model('player', Player);
