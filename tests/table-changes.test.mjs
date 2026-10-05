import test from 'node:test';
import assert from 'node:assert/strict';
import { changeTotals, changesResult, changesText, normalizeChanges, tableChanges } from '../src/table-changes.mjs';
import { boundedView } from '../src/views.mjs';

const orders = rows => ({ name: 'public.orders', columns: ['id', 'status', 'total'], key: ['id'], rows });

test('rows match on the primary key: an update keeps its before cells, and unchanged tables are left out', () => {
  const before = [orders([[1, 'pending', 10], [2, 'awaiting_payment', 20], [3, 'paid', 30]]), { name: 'public.items', columns: ['id'], key: ['id'], rows: [[1]] }];
  const after = [orders([[1, 'expired', 10], [3, 'paid', 30], [4, 'pending', 40]]), { name: 'public.items', columns: ['id'], key: ['id'], rows: [[1]] }];
  const [change, ...rest] = tableChanges(before, after);
  assert.equal(rest.length, 0);
  assert.deepEqual({ inserted: change.inserted, updated: change.updated, deleted: change.deleted }, { inserted: 1, updated: 1, deleted: 1 });
  assert.deepEqual(change.rows, [
    { change: 'updated', cells: ['1', 'expired', '10'], before: ['1', 'pending', '10'] },
    { change: 'inserted', cells: ['4', 'pending', '40'] },
    { change: 'deleted', cells: ['2', 'awaiting_payment', '20'] },
  ]);
});

test('an added column is reported once, not as every row updated; a table without a key compares whole rows', () => {
  const [added] = tableChanges([orders([[1, 'paid', 10]])], [{ ...orders([[1, 'paid', 10, null]]), columns: ['id', 'status', 'total', 'note'] }]);
  assert.deepEqual([added.columnsAdded, added.updated, added.rows], [['note'], 0, []]);
  const log = rows => ({ name: 'public.log', columns: ['line'], key: [], rows });
  const [keyless] = tableChanges([log([['a'], ['a'], ['b']])], [log([['a'], ['c'], ['b']])]);
  assert.deepEqual([keyless.inserted, keyless.updated, keyless.deleted], [1, 0, 1]);
});

test('new, dropped and count-only tables', () => {
  const changes = tableChanges([{ name: 'public.old', columns: ['id'], key: ['id'], rows: [[1], [2]] }, { name: 'public.events', count: 50_000 }], [orders([[1, 'paid', 10]]), { name: 'public.events', count: 50_040 }]);
  const byName = Object.fromEntries(changes.map(change => [change.name, change]));
  assert.deepEqual([byName['public.orders'].created, byName['public.orders'].inserted, byName['public.orders'].columnsAdded], [true, 1, []]);
  assert.deepEqual([byName['public.old'].dropped, byName['public.old'].deleted], [true, 2]);
  assert.deepEqual([byName['public.events'].countOnly, byName['public.events'].inserted, byName['public.events'].rows], [true, 40, []]);
});

test('JSON values become text, and normalizing keeps only well-formed rows and known flags', () => {
  const [change] = tableChanges([{ name: 't', columns: ['id', 'data'], key: ['id'], rows: [[1, { a: 1 }]] }], [{ name: 't', columns: ['id', 'data'], key: ['id'], rows: [[1, { a: 2 }]] }]);
  assert.deepEqual(change.rows[0].before, ['1', '{"a":1}']);
  const [table] = normalizeChanges({ tables: [{ name: 't', inserted: -1, updated: 2, columns: ['id'], rows: [{ change: 'updated', cells: [1], before: [0] }, { change: 'moved', cells: [] }], countOnly: 'yes' }, { name: '' }] });
  assert.deepEqual(table, { name: 't', inserted: 0, updated: 2, deleted: 0, columnsAdded: [], columnsRemoved: [], key: [], columns: ['id'], rows: [{ change: 'updated', cells: ['1'], before: ['0'] }] });
  assert.deepEqual(normalizeChanges(null), []);
});

test('the agent reads totals and changed cells as before→after; the view keeps totals within its budget', () => {
  const rows = Array.from({ length: 300 }, (_, index) => [index, 'pending', 'x'.repeat(150)]);
  const tables = tableChanges([orders(rows)], [orders(rows.map(([id, , total]) => [id, 'expired', total]))]);
  const text = changesText(tables, { since: 'worker started' });
  assert.match(text, /^Database changes since worker started:\npublic\.orders: ~300\n {2}~ id=0 status=pending→expired\n/);
  assert.match(text, /… 280 more$/);
  assert.equal(changesText([], { since: 'x' }), 'Database changes since x: none.');
  assert.deepEqual(changeTotals(tables), { inserted: 0, updated: 300, deleted: 0 });
  const view = boundedView(changesResult({ since: 'worker started', tables }, { log: 'done' }).view);
  assert.equal(view.type, 'changes'); assert.equal(view.tables[0].updated, 300); assert.equal(view.log, 'done');
  assert.ok(view.tables[0].rows.length > 0 && view.tables[0].rows.length < 200); assert.ok(JSON.stringify(view).length < 14_000);
});
