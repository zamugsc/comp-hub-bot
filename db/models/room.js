const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const Room = new Schema({
  guild: String,
  number: Number,
  lobby: { type: Schema.Types.ObjectId, ref: 'lobbies', default: null },
  tournamentGame: { type: Schema.Types.ObjectId, ref: 'tournament_game', default: null },
  cleanupAt: { type: Date, default: null },
});

module.exports.Room = model('room', Room);
