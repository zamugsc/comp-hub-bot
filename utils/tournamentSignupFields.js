// Keep solo tournament rosters in balanced column pairs without dropping players.
function tournamentSignupFields(fields) {
  const [roster, ...details] = fields;
  const entries = roster.value.split('\n');
  if (entries.some((entry) => entry.length > 1024)) {
    throw new Error('A tournament roster entry exceeds Discord\'s 1024-character field limit.');
  }

  const splitColumns = (columnCount) => {
    const columns = [];
    let offset = 0;
    for (let column = 0; column < columnCount; column += 1) {
      const count = Math.ceil((entries.length - offset) / (columnCount - column));
      columns.push(entries.slice(offset, offset + count).join('\n'));
      offset += count;
    }
    return columns;
  };
  let columnCount = entries.length <= 32 && roster.value.length <= 1024
    ? 1 : Math.min(2, entries.length);
  let columns = splitColumns(columnCount);
  while (columns.some((value) => value.length > 1024)) {
    columnCount = Math.min(entries.length, columnCount + 2);
    columns = splitColumns(columnCount);
  }

  const rosterFields = [];
  columns.forEach((value, column) => {
    rosterFields.push({ ...roster, name: column ? 'Players (continued)' : roster.name, value, inline: true });
    // Keep each pair together and put the lobby details below the roster.
    if (column % 2 === 1) rosterFields.push({ name: '\u200B', value: '\u200B', inline: false });
  });

  return [
    ...rosterFields,
    // Per-game posts retain the ranked information; avoid duplicating the full
    // roster in another oversized field on the main tournament message.
    ...details.filter((field) => field.name !== ':credit_card: Ranked Information'
      && !(Array.isArray(field.value) && field.value.length === 0)),
  ];
}

module.exports = tournamentSignupFields;
