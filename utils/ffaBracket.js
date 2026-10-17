// Event routes approved by the organizers. Values are finishing places, not seeds.
const quarterfinals = [
  [1, 2, 3, 4], [2, 1, 4, 3], [2, 1, 4, 3], [1, 2, 3, 4],
  [3, 4, 1, 2], [4, 3, 2, 1], [3, 4, 1, 2], [4, 3, 2, 1],
];
const semifinals = [
  [[1, 4], [2, 3]], [[2, 3], [1, 4]],
  [[1, 4], [2, 3]], [[2, 3], [1, 4]],
];

function seedGames(seeds) {
  if (![16, 32, 64].includes(seeds.length)
    || new Set(seeds.map((entry) => entry.discordId)).size !== seeds.length) {
    throw new Error('FFA tournaments require 16, 32 or 64 distinct players.');
  }
  const ordered = [...seeds].sort((a, b) => b.rating - a.rating
    || a.discordId.localeCompare(b.discordId));
  const groups = Array.from({ length: seeds.length / 8 }, () => []);
  ordered.forEach((entry, index) => {
    const band = Math.floor(index / groups.length);
    const slot = index % groups.length;
    groups[band % 2 ? groups.length - slot - 1 : slot].push(entry.discordId);
  });
  return groups;
}

function nextGames(games) {
  const ordered = [...games].sort((a, b) => a.match - b.match);
  if (![2, 4, 8].includes(ordered.length)) throw new Error('Invalid FFA round size.');
  const qualifiers = ordered.map((game, index) => {
    if (game.match !== index + 1 || !game.finished || game.qualifiers.length !== 4
      || new Set(game.qualifiers).size !== 4
      || game.qualifiers.some((id) => !game.players.includes(id))) {
      throw new Error('Every game needs four confirmed qualifiers before the round advances.');
    }
    return game.qualifiers;
  });
  if (new Set(qualifiers.flat()).size !== ordered.length * 4) throw new Error('Duplicate tournament qualifier.');
  if (ordered.length === 8) {
    return Array.from({ length: 4 }, (_, destination) => qualifiers
      .map((players, source) => players[quarterfinals[source][destination] - 1]));
  }
  if (ordered.length === 4) {
    return Array.from({ length: 2 }, (_, destination) => qualifiers
      .flatMap((players, source) => semifinals[source][destination].map((place) => players[place - 1])));
  }
  return [qualifiers.flat()];
}

function scoreOrder(game, readTemplate) {
  const table = readTemplate(game.scoringBackup, game.scoringRoster);
  if (!game.scoringEnabled || !game.scoringMessageId || game.scoringRecoveryId
    || game.scoringPanelId || table.races !== game.trackCount) {
    throw new Error('Save every race and finish any correction/recovery before confirming this game.');
  }
  const order = table.rows.map((row) => ({
    discordId: game.scoringRoster.find((player) => player.prefix === row.prefix).discordId,
    total: row.scores.reduce((sum, score) => sum + score, 0),
  })).sort((a, b) => b.total - a.total);
  const places = game.final ? 1 : 4;
  for (let index = 0; index < places; index += 1) {
    if (order[index + 1] && order[index].total === order[index + 1].total) {
      throw new Error('Tied qualifying positions need the organizer tie rule before this game can advance.');
    }
  }
  return order;
}

module.exports = { seedGames, nextGames, scoreOrder };
