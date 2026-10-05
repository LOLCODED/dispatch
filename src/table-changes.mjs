// Compares two states of a database's tables, each given by a connector as { name, columns, key, rows } (rows as arrays in column
// order) or { name, count } for a table too large to keep, so any engine can hand its rows over and get the same changes back.
const sampleLimit = 200, changeKinds = ['inserted', 'updated', 'deleted'];

const cellText = value => value === null || value === undefined ? null : typeof value === 'object' ? JSON.stringify(value) : String(value);
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function tableState(value) {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name) return null;
  if (!Array.isArray(value.rows)) return { name: value.name, count: Number.isInteger(value.count) ? value.count : 0 };
  const columns = (Array.isArray(value.columns) ? value.columns : []).map(String);
  const key = (Array.isArray(value.key) ? value.key : []).map(String).filter(column => columns.includes(column));
  return { name: value.name, columns, key, rows: value.rows.filter(Array.isArray).map(row => columns.map((_, index) => cellText(row[index]))) };
}

// Rows match on the primary key; without one a row is only its values, so a changed row reads as one deleted and one inserted.
function keyed(table, identity) {
  const positions = identity.map(column => table.columns.indexOf(column)), rows = new Map();
  for (const row of table.rows) {
    const id = JSON.stringify(positions.map(index => row[index] ?? null));
    rows.set(rows.has(id) ? `${id}#${rows.size}` : id, row);
  }
  return rows;
}

function rowChanges(name, before, after) {
  const shared = after.columns.filter(column => before.columns.includes(column));
  const identity = after.key.length && after.key.every(column => shared.includes(column)) ? after.key : shared;
  const old = keyed(before, identity), now = keyed(after, identity), counts = { inserted: 0, updated: 0, deleted: 0 }, rows = [];
  const record = (change, cells, previous) => { counts[change]++; if (rows.length < sampleLimit) rows.push({ change, cells, ...(previous ? { before: previous } : {}) }); };
  const previousCell = (row, column, fallback) => { const index = before.columns.indexOf(column); return index < 0 ? fallback : row[index]; };
  for (const [id, row] of now) {
    const previous = old.get(id);
    if (!previous) record('inserted', row);
    else {
      const aligned = after.columns.map((column, index) => previousCell(previous, column, row[index]));
      if (aligned.some((cell, index) => cell !== row[index])) record('updated', row, aligned);
    }
  }
  for (const [id, row] of old) if (!now.has(id)) record('deleted', after.columns.map(column => previousCell(row, column, null)));
  const columnsAdded = before.columns.length ? after.columns.filter(column => !before.columns.includes(column)) : [];
  const columnsRemoved = after.columns.length ? before.columns.filter(column => !after.columns.includes(column)) : [];
  if (!counts.inserted && !counts.updated && !counts.deleted && !columnsAdded.length && !columnsRemoved.length) return null;
  return { name, ...counts, columnsAdded, columnsRemoved, key: after.key, columns: after.columns, rows };
}

function countChanges(name, before, after) {
  if (before === after) return null;
  return { name, inserted: Math.max(0, after - before), updated: 0, deleted: Math.max(0, before - after), columnsAdded: [], columnsRemoved: [], countOnly: true, key: [], columns: [], rows: [] };
}

const rowCount = table => table ? table.rows?.length ?? table.count : 0;
const nothing = table => ({ name: table.name, columns: [], key: table.key, rows: [] });

function compare(name, then, now) {
  if (then?.rows && now?.rows) return rowChanges(name, then, now);
  if (!then && now?.rows) return rowChanges(name, nothing(now), now);
  if (then?.rows && !now) return rowChanges(name, then, { ...then, rows: [] });
  return countChanges(name, rowCount(then), rowCount(now));
}

export function tableChanges(before, after) {
  const states = list => new Map((Array.isArray(list) ? list : []).map(tableState).filter(Boolean).map(table => [table.name, table]));
  const earlier = states(before), later = states(after), changes = [];
  for (const name of new Set([...later.keys(), ...earlier.keys()])) {
    const then = earlier.get(name), now = later.get(name), change = compare(name, then, now);
    if (change) changes.push({ ...change, ...(!then ? { created: true } : !now ? { dropped: true } : {}) });
  }
  return changes;
}

const count = value => Number.isInteger(value) && value >= 0 ? value : 0;
const names = value => (Array.isArray(value) ? value : []).slice(0, 200).map(cell => String(cell).slice(0, 200));
const flags = table => Object.fromEntries(['countOnly', 'created', 'dropped'].filter(flag => table[flag] === true).map(flag => [flag, true]));

function sampleRows(rows, columns) {
  return (Array.isArray(rows) ? rows : []).filter(row => isRecord(row) && changeKinds.includes(row.change) && Array.isArray(row.cells)).slice(0, sampleLimit).map(row => ({
    change: row.change, cells: columns.map((_, index) => cellText(row.cells[index])), ...(Array.isArray(row.before) ? { before: columns.map((_, index) => cellText(row.before[index])) } : {}),
  }));
}

// A connector's or command's answer gets one shape before dispatch stores or shows it.
export function normalizeChanges(value) {
  const tables = Array.isArray(value?.tables) ? value.tables : [];
  return tables.filter(table => isRecord(table) && typeof table.name === 'string' && table.name).slice(0, 200).map(table => {
    const columns = names(table.columns);
    return { name: table.name.slice(0, 200), inserted: count(table.inserted), updated: count(table.updated), deleted: count(table.deleted), columnsAdded: names(table.columnsAdded), columnsRemoved: names(table.columnsRemoved), key: names(table.key), columns, ...flags(table), rows: sampleRows(table.rows, columns) };
  });
}

const totalsLine = table => [table.inserted && `+${table.inserted}`, table.updated && `~${table.updated}`, table.deleted && `−${table.deleted}`].filter(Boolean).join(' ') || 'no row changes';
export const changeTotals = tables => tables.reduce((sum, table) => ({ inserted: sum.inserted + table.inserted, updated: sum.updated + table.updated, deleted: sum.deleted + table.deleted }), { inserted: 0, updated: 0, deleted: 0 });

function tableText(table, perTable) {
  const notes = [table.created && 'new table', table.dropped && 'dropped', table.countOnly && 'too large to compare rows; counts only', table.columnsAdded.length && `added ${table.columnsAdded.join(', ')}`, table.columnsRemoved.length && `removed ${table.columnsRemoved.join(', ')}`].filter(Boolean);
  const lines = [`${table.name}: ${totalsLine(table)}${notes.length ? ` (${notes.join('; ')})` : ''}`];
  const shown = (cells, index) => cells[index] === null ? 'NULL' : cells[index];
  for (const row of table.rows.slice(0, perTable)) {
    const cells = table.columns.map((column, index) => row.before && row.before[index] !== row.cells[index] ? `${column}=${shown(row.before, index)}→${shown(row.cells, index)}` : table.key.includes(column) || row.change !== 'updated' ? `${column}=${shown(row.cells, index)}` : null).filter(Boolean);
    lines.push(`  ${{ inserted: '+', updated: '~', deleted: '−' }[row.change]} ${cells.join(' ').slice(0, 400)}`);
  }
  const total = table.inserted + table.updated + table.deleted;
  if (total > Math.min(perTable, table.rows.length) && table.rows.length) lines.push(`  … ${total - Math.min(perTable, table.rows.length)} more`);
  return lines.join('\n');
}

// The agent reads totals for every table and a few changed rows of each; changed cells read before→after.
export function changesText(tables, { since, perTable = 20 } = {}) {
  const heading = `Database changes since ${since ?? 'the snapshot'}:`;
  return tables.length ? [heading, ...tables.map(table => tableText(table, perTable))].join('\n') : `${heading} none.`;
}

export const changesResult = ({ since, tables }, extra = {}) => ({
  content: [{ type: 'text', text: [extra.prefix, changesText(tables, { since })].filter(Boolean).join('\n\n') }],
  isError: false,
  view: { type: 'changes', label: extra.label ?? 'Changes', title: extra.title ?? `since ${since}`, since, tables, ...(extra.log ? { log: extra.log } : {}) },
});
