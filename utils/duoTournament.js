const greedyPartition = require('./greedyPartition');
const DUO_TOURNAMENT_SIZES = [16, 32, 64];

function validateDuoRoster(players, teams, allowSolos = false) {
  const paired = teams.flat();
  if (new Set(players).size !== players.length
    || teams.some((team) => team.length !== 2)
    || new Set(paired).size !== paired.length
    || paired.some((player) => !players.includes(player))
    || (!allowSolos && paired.length !== players.length)
    || (players.length - paired.length) % 2 !== 0) {
    throw new Error('The tournament must contain complete, distinct duos. Please check the signup roster.');
  }
}

function balanceDuoGroups(teams, ratings) {
  const ratedTeams = teams.map((players) => ({
    players,
    rank: players.reduce((sum, player) => sum + ratings.get(player), 0) / 2,
  }));
  return greedyPartition(ratedTeams, teams.length / 4, 4, 'rank')
    .map((group) => group.flatMap((team) => team.players));
}

function validateDuoRound(doc) {
  validateDuoRoster(doc.players, doc.teamList);
  const final = doc.players.length === 8;
  const groups = doc.tournamentGroups;
  const grouped = groups.flat();
  if (!DUO_TOURNAMENT_SIZES.includes(doc.maxPlayerCount)
    || ![8, ...DUO_TOURNAMENT_SIZES].includes(doc.players.length)
    || doc.players.length > doc.maxPlayerCount
    || groups.length !== doc.players.length / 8
    || groups.some((group) => group.length !== 8)
    || new Set(grouped).size !== doc.players.length
    || grouped.some((player) => !doc.players.includes(player))
    || doc.teamList.some((team) => !groups.some((group) => team.every((player) => group.includes(player))))) {
    throw new Error('The saved tournament round is incomplete. Please ask staff to check the lobby.');
  }
  return final;
}

function getAdvancingDuos(doc, mentions) {
  const final = validateDuoRound(doc);
  const groups = doc.tournamentGroups;
  if (mentions.some((player) => !doc.players.includes(player))) {
    throw new Error('You can only advance players from the current tournament round.');
  }
  // Either member identifies the pair. Mentioning both still selects just one duo.
  const teams = doc.teamList.filter((team) => team.some((player) => mentions.includes(player)));
  if (teams.length !== (final ? 1 : doc.players.length / 4)) {
    throw new Error(final
      ? 'Mention either player of the winning duo.'
      : `Mention either player of each advancing duo: two duos from each game (${doc.players.length / 4} duos total).`);
  }
  if (!final && groups.some((group) => teams.filter((team) => group.includes(team[0])).length !== 2)) {
    throw new Error('Exactly two duos must advance from each game.');
  }
  return teams.map((team) => [...team]);
}

// Balance whole teams and solo entries across two columns, with at most 24 lines per column.
function splitTournamentRoster(field, blocks) {
  if (blocks.length < 2) return [field];
  const lineCounts = blocks.map((block) => block.split('\n').length);
  let remainingLines = lineCounts.reduce((sum, count) => sum + count, 0);
  const minimumColumns = Math.max(2, Math.ceil(remainingLines / 24));
  const columnCount = minimumColumns + minimumColumns % 2;
  const fields = [];
  let offset = 0;
  for (let column = 0; column < columnCount; column += 1) {
    const remainingColumns = columnCount - column;
    const target = remainingLines / remainingColumns;
    let count = 1;
    let lines = lineCounts[offset];
    // Pick the closest whole-block boundary while reserving an entry for each later column.
    while (offset + count < blocks.length - remainingColumns + 1) {
      const nextLines = lineCounts[offset + count];
      if (lines + nextLines > 24 || Math.abs(lines - target) <= Math.abs(lines + nextLines - target)) break;
      lines += nextLines;
      count += 1;
    }
    fields.push({
      ...field,
      name: column ? 'Players (continued)' : field.name,
      value: blocks.slice(offset, offset + count).join('\n'),
      inline: true,
    });
    offset += count;
    remainingLines -= lines;
    // A full-width separator keeps the next row or lobby details out of this column pair.
    if (column % 2 === 1) fields.push({ name: '\u200B', value: '\u200B', inline: false });
  }
  return fields;
}

// Keep duo tournament fields below Discord's field limit.
function splitTournamentFields(fields) {
  return fields.flatMap((field) => {
    if (typeof field.value !== 'string' || field.value.length <= 1024) return [field];
    const chunks = [];
    let remaining = field.value;
    while (remaining.length > 1024) {
      const newline = remaining.lastIndexOf('\n', 1024);
      const end = newline > 0 ? newline : 1024;
      chunks.push(remaining.slice(0, end));
      remaining = remaining.slice(end).replace(/^\n/, '');
    }
    if (remaining) chunks.push(remaining);
    return chunks.map((value, i) => ({ ...field, name: i ? `${field.name} (continued)` : field.name, value }));
  });
}

module.exports = { DUO_TOURNAMENT_SIZES, validateDuoRoster, validateDuoRound, balanceDuoGroups, getAdvancingDuos, splitTournamentRoster, splitTournamentFields };
