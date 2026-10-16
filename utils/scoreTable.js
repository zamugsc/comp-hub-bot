// The visible Lorenzi template is the score record. Never infer races from totals.
function readTemplate(text, roster = null, initial = false) {
  if (typeof text !== 'string' || !text.trim() || text.includes('```')) {
    throw new Error('The score template is missing or invalid.');
  }
  const lines = text.replace(/\r/g, '').trim().split('\n');
  const rows = [];
  lines.forEach((line, index) => {
    if (!line.trim() || line.startsWith('#')) return;
    const match = line.match(/^(.+?)\s+(\d[^\s]*)$/);
    if (!match) return;
    if (!/^\d+(?:-\d+)?(?:\|\d+(?:-\d+)?)*$/.test(match[2])) {
      throw new Error('Invalid race columns: use scores such as 9 or 9-4 separated by |, without a trailing |.');
    }
    const cells = match[2].split('|');
    const scores = cells.map((cell) => {
      const [base, deduction = 0] = cell.split('-').map(Number);
      if (![base, deduction, base - deduction].every(Number.isSafeInteger)) throw new Error('Invalid score value.');
      return base - deduction;
    });
    rows.push({
      index, prefix: match[1], name: match[1].replace(/\s+\[[^\]]+\]$/, ''), scores, cells,
    });
  });
  const count = roster ? roster.length : rows.length;
  if (count < 4 || count > 8 || rows.length !== count || new Set(rows.map((row) => row.prefix)).size !== count) {
    throw new Error('The table must contain every player exactly once (four to eight players).');
  }
  if (roster && (roster.length !== rows.length
    || rows.some((row) => !roster.some((player) => player.prefix === row.prefix)))) {
    throw new Error('The score template does not match this lobby\'s saved roster.');
  }
  const races = rows[0].scores.length;
  if (rows.some((row) => row.scores.length !== races)) {
    throw new Error('Every player must have the same number of race columns.');
  }
  if (initial) {
    if (rows.some((row) => row.cells.some((cell) => !/^0+$/.test(cell)))) {
      throw new Error('The startup template already contains scores. Mid-match importing is not supported.');
    }
    rows.forEach((row) => { row.scores = []; row.cells = []; });
  }
  return { lines, rows, races: initial ? 0 : races };
}

function extractTemplate(message) {
  const blocks = [message.content, ...(message.embeds || []).map((embed) => embed.description)]
    .filter(Boolean).flatMap((text) => [...text.matchAll(/```(?:\w+\n)?([\s\S]*?)```/g)].map((match) => match[1].trim()));
  if (blocks.length !== 1) throw new Error('The results message must contain exactly one score template.');
  return blocks[0];
}

// Racing skips positions occupied by a tie; battle advances by one group.
function rankGroups(groups, battle = false) {
  let place = 1;
  return groups.map((players) => {
    const group = { place, players };
    place += battle ? 1 : players.length;
    return group;
  });
}

// Always derive placements from the original finishing groups, never an already adjusted order.
function raceAwards(groups, points, battle = false, penalties = []) {
  const order = groups.flat();
  if (!Array.isArray(points) || points.length !== order.length
    || points.some((point) => !Number.isSafeInteger(point) || point < 0)) {
    throw new Error('This lobby mode does not have a configured points system for this player count.');
  }
  const adjustments = new Map();
  for (const penalty of penalties) {
    if (!order.includes(penalty.playerId) || adjustments.has(penalty.playerId)
      || !Number.isSafeInteger(penalty.count) || penalty.count < 0
      || !Number.isSafeInteger(penalty.count * 4) || typeof penalty.last !== 'boolean') {
      throw new Error('Invalid player penalty.');
    }
    adjustments.set(penalty.playerId, penalty);
  }
  const adjusted = groups.map((group) => group.filter((id) => !adjustments.get(id)?.last)).filter((group) => group.length);
  const awards = new Map();
  rankGroups(adjusted, battle).forEach(({ place, players }) => {
    players.forEach((id) => awards.set(id, { place, base: points[place - 1] }));
  });
  order.forEach((id) => {
    const penalty = adjustments.get(id);
    if (penalty?.last) awards.set(id, { place: points.length, base: 0 });
    const award = awards.get(id);
    const deduction = (penalty?.count || 0) * 4;
    Object.assign(award, { cell: deduction ? `${award.base}-${deduction}` : String(award.base), total: award.base - deduction });
  });
  return awards;
}

function scoreRace(table, roster, selections, race, points, battle = false, penalties = []) {
  if (!Number.isInteger(race) || race < 1 || race > table.races + 1) throw new Error('Invalid race number.');
  const count = roster.length;
  // Accept the original flat order too, so callers and old drafts remain compatible.
  const groups = selections.map((selection) => (Array.isArray(selection) ? selection : [selection]));
  const order = groups.flat();
  if (groups.some((group) => !group.length) || order.length !== count || new Set(order).size !== count
    || order.some((id) => !roster.some((player) => player.discordId === id))) {
    throw new Error(`Select all ${count} players exactly once before saving scores.`);
  }
  const lines = table.lines.slice();
  const awards = raceAwards(groups, points, battle, penalties);
  table.rows.forEach((row) => {
    const player = roster.find((entry) => entry.prefix === row.prefix);
    const scores = (row.cells || row.scores).slice();
    scores[race - 1] = awards.get(player.discordId).cell;
    lines[row.index] = `${row.prefix} ${scores.join('|')}`;
  });
  return lines.join('\n');
}

function ordinal(number) {
  return `${number}${({ 1: 'st', 2: 'nd', 3: 'rd' })[number] || 'th'}`;
}

module.exports = {
  readTemplate, extractTemplate, scoreRace, raceAwards, rankGroups, ordinal,
};
