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

// Keep the 16-player pilot's roster fields readable without changing larger FFA signups.
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

module.exports = { DUO_TOURNAMENT_SIZES, validateDuoRoster, validateDuoRound, balanceDuoGroups, getAdvancingDuos, splitTournamentFields };
