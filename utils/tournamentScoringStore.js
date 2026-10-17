// Let the existing scoring UI address either an ordinary lobby or one event game.
function tournamentScoringStore({ Lobby, Room, Game }) {
  async function gameFor(query) {
    const game = await Game.findOne(query);
    if (game && game.started && !await Lobby.findOne({
      _id: game.tournamentId, started: true, ffaManaged: true, ffaRound: game.round,
      ffaPhase: { $nin: ['ending', 'cancelled'] },
    })) return null;
    return game;
  }
  return {
    Lobby: {
      async findOne(query) {
        return await Lobby.findOne(query) || gameFor(query);
      },
      async findOneAndUpdate(query, update, options) {
        if (await Lobby.findOne(query)) return Lobby.findOneAndUpdate(query, update, options);
        const game = await gameFor(query);
        if (!game) return null;
        const values = { ...update.$set };
        // Opening a correction or saving changed scores withdraws that game's confirmation.
        if (game.finished && !game.completed
          && (values.scoringPanelId || Object.prototype.hasOwnProperty.call(values, 'scoringBackup'))) {
          values.finished = false;
          values.qualifiers = [];
        }
        return Game.findOneAndUpdate(query, { ...update, $set: values }, options);
      },
    },
    Room: {
      async findOne(query) {
        let actual = query;
        if (query.lobby) {
          const game = await Game.findOne({ _id: query.lobby });
          if (game) actual = { ...query, lobby: game.tournamentId, tournamentGame: game._id };
        }
        const room = await Room.findOne(actual);
        if (!room || !room.tournamentGame) return room;
        return { ...(room.toObject ? room.toObject() : room), lobby: room.tournamentGame };
      },
    },
  };
}

module.exports = tournamentScoringStore;
