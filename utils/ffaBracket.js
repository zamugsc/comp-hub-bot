const { pointsFor } = require('../db/race_points');

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

function scoreOrder(game, readTemplate, { nextRoundFinal = false } = {}) {
  const table = readTemplate(game.scoringBackup, game.scoringRoster);
  if (!game.scoringEnabled || !game.scoringMessageId || game.scoringRecoveryId
    || game.scoringPanelId || table.races !== game.trackCount) {
    throw new Error('Save every race and finish any correction/recovery before confirming this game.');
  }
  const order = table.rows.map((row) => ({
    discordId: game.scoringRoster.find((player) => player.prefix === row.prefix).discordId,
    total: row.scores.reduce((sum, score) => sum + score, 0),
    row,
  })).sort((a, b) => b.total - a.total);
  const places = game.final ? 1 : 4;
  for (let start = 0; start < places;) {
    let end = start + 1;
    while (end < order.length && order[end].total === order[start].total) end += 1;
    // Semifinal ties wholly inside the top four do not affect final membership.
    const needsOrder = game.final || !nextRoundFinal || end > places;
    if (end - start > 1 && needsOrder) {
      const points = pointsFor(game.type, game.scoringRoster.length);
      if (!points) throw new Error('The tournament placement points could not be verified.');
      const tied = order.slice(start, end);
      for (const entry of tied) {
        entry.placementCounts = Array(points.length).fill(0);
        for (const cell of entry.row.cells) {
          // Point deductions preserve the award; forced-last is recorded as zero.
          const base = Number(cell.split('-')[0]);
          const place = base === 0 ? points.length - 1 : points.indexOf(base);
          if (place < 0) throw new Error(`Tied qualifying positions cannot be resolved: ${entry.row.name}'s base score ${base} is not a placement award. Correct the saved table.`);
          entry.placementCounts[place] += 1;
        }
      }
      tied.sort(comparePlacements);
      order.splice(start, tied.length, ...tied);
    }
    start = end;
  }
  // All four semifinal qualifiers enter the same final; only the cutoff matters.
  const firstTieCheck = !game.final && nextRoundFinal ? 3 : 0;
  for (let index = firstTieCheck; index < places; index += 1) {
    if (order[index + 1] && order[index].total === order[index + 1].total
      && comparePlacements(order[index], order[index + 1]) === 0) {
      throw new Error('Tied qualifying positions remain after comparing every placement count. The organizer special tie rule is still required.');
    }
  }
  return order.map(({ row, ...entry }) => entry);
}

function comparePlacements(a, b) {
  for (let place = 0; place < a.placementCounts.length; place += 1) {
    const difference = b.placementCounts[place] - a.placementCounts[place];
    if (difference) return difference;
  }
  return 0;
}

module.exports = { seedGames, nextGames, scoreOrder };
