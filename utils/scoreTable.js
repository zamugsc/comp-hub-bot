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
      throw new Error('The startup template already contains scores. Use `!t import` with the raw table to import manual scores.');
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

// Import alone infers unfinished races from trailing blank/zero placeholders.
// Saved High IQ tables continue to count every committed column, including zeros.
function readImport(text, roster, maxRaces, teams = []) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Paste the raw score table after `!t import`.');
  if (!Number.isSafeInteger(maxRaces) || maxRaces < 1) throw new Error('This lobby has an invalid race count.');
  text = text.replace(/\r/g, '').trim();
  if (text.startsWith('```')) text = extractTemplate({ content: text });
  if (text.includes('```')) throw new Error('Paste exactly one raw score table.');
  const lines = text.split('\n').map((line) => line.trim());
  const rows = [];
  const groups = [];
  for (const [index, line] of lines.entries()) {
    if (!line || line.startsWith('#')) continue;
    const matches = roster.flatMap((player) => {
      const name = player.prefix || player.name;
      if (line !== name && !line.startsWith(`${name} `) && !line.startsWith(`${name}\t`)) return [];
      let suffix = line.slice(name.length).trim();
      let prefix = name;
      if (!player.prefix) {
        const flag = suffix.match(/^\[[^\]]+\](?:\s+|$)/);
        if (flag) { prefix += ` ${flag[0].trim()}`; suffix = suffix.slice(flag[0].length).trim(); }
      }
      if (suffix && !/^[\d\s|\-]+$/.test(suffix)) return [];
      return [{ ...player, prefix, cells: suffix ? suffix.split('|').map((cell) => cell.trim()) : [], index }];
    });
    if (matches.length > 1) throw new Error('Player names in this table are ambiguous. Use the original lobby template.');
    if (matches.length) {
      const entry = matches[0];
      if (entry.cells.some((cell) => cell && !/^\d+(?:-\d+)?$/.test(cell))) {
        throw new Error('Invalid race columns: use scores such as 9 or 9-4 separated by |.');
      }
      rows.push(entry);
      if (groups.length) groups[groups.length - 1].push(entry.discordId);
      continue;
    }
    if (/^.+\s+#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(line) || /^Team\s+\S+/i.test(line)) {
      groups.push([]);
    } else if (!rows.length && !groups.length && index === lines.findIndex((entry) => entry && !entry.startsWith('#'))
      && !/\s+[\d|][\d|\-\s]*$/.test(line)) {
      // An optional plain title precedes the player/team rows.
    } else throw new Error('The imported table contains an unknown player or invalid row. Use this lobby\'s template.');
  }
  if (rows.length !== roster.length || new Set(rows.map((entry) => entry.discordId)).size !== roster.length) {
    throw new Error('The imported table must contain every lobby player exactly once.');
  }
  const teamKey = (members) => members.slice().sort().join(',');
  const expected = teams.filter((team) => team.length).map(teamKey).sort();
  const actual = groups.map(teamKey).sort();
  if (expected.length !== actual.length || expected.some((team, i) => team !== actual[i])) {
    throw new Error('The imported table\'s teams do not match this lobby. Keep the original team assignments.');
  }
  const columns = rows[0].cells.length;
  if (rows.some((entry) => entry.cells.length !== columns)) throw new Error('Every player must have the same number of race columns.');
  if (columns > maxRaces) throw new Error('The imported table contains more race columns than this lobby allows.');
  const filled = Array.from({ length: columns }, (_, i) => rows.some((entry) => entry.cells[i] && !/^0+$/.test(entry.cells[i])));
  const races = filled.lastIndexOf(true) + 1;
  if (filled.slice(0, races).includes(false)) throw new Error('An unplayed race column appears before a filled one. Fill races in order.');
  if (rows.some((entry) => entry.cells.slice(0, races).includes(''))) {
    throw new Error('A played race contains an empty player score. Complete that column before importing.');
  }
  rows.forEach((entry) => {
    const cells = races ? entry.cells.slice(0, races) : Array(maxRaces).fill('0');
    lines[entry.index] = `${entry.prefix} ${cells.join('|')}`;
  });
  const resolved = rows.map(({ discordId, name, prefix }) => ({ discordId, name, prefix }));
  const table = readTemplate(lines.join('\n'), resolved, races === 0);
  return { ...table, roster: resolved };
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

function penaltyDeduction(penalty) {
  return penalty.count * 4 + (penalty.laphit === undefined ? 0 : penalty.laphit);
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
      || (penalty.laphit !== undefined && (!Number.isSafeInteger(penalty.laphit) || penalty.laphit < 0))
      || !Number.isSafeInteger(penaltyDeduction(penalty)) || typeof penalty.last !== 'boolean') {
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
    const deduction = penalty ? penaltyDeduction(penalty) : 0;
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
  readTemplate, readImport, extractTemplate, scoreRace, raceAwards, penaltyDeduction, rankGroups, ordinal,
};
