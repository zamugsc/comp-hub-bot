function tournamentTableTitle(tournament, roomNumber) {
  const mode = tournament.getTitle().replace(/^(?:Ranked|Unranked)\s+/, '')
    .replace(/\s+Tournament(?:\s.*)?$/, '');
  return `${mode} Tournament #${tournament.number} - Round of ${tournament.players.length} - Room #${roomNumber}`;
}

// Keep the existing rows, race columns and optional Lorenzi title directive.
// Headerless backups receive a title rather than losing their first player.
function applyTournamentTableTitle(text, title) {
  if (!title || typeof text !== 'string' || !text.trim()) return text;
  const lines = text.replace(/\r/g, '').trim().split('\n');
  const first = lines[0];
  const directive = first.startsWith('#title ');
  const header = directive ? `#title ${title}` : title;
  if (first === header) return text;
  if (directive || /^Lobby #\S+ - /.test(first)
    || /^.+ Tournament #\d+ - Round of \d+ - Room #\d+$/.test(first)) lines[0] = header;
  else lines.unshift(header, '');
  return lines.join('\n');
}

module.exports = { tournamentTableTitle, applyTournamentTableTitle };
