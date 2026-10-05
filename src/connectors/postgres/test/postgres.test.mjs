import test from 'node:test';
import assert from 'node:assert/strict';
import { connectorApi } from '../../api.mjs';
import { validateConnector } from '../../contract.mjs';
import createPostgres, { postgresUrl } from '../index.mjs';
import { keptTables, rowsSql } from '../changes.mjs';

const url = 'postgres://dev:secret@localhost:5432/app';

test('queries run read-only through psql and NULL stays distinct from an empty string', async () => {
  const calls = [], runProcess = async (command, args, options) => { calls.push({ command, args, options }); return { exitCode: 0, output: 'id,note\n1,\n2,\\N\n' }; };
  const connector = validateConnector(createPostgres(connectorApi({ runProcess })));
  const query = connector.actions.query.hooks['database.query'];
  const result = await query({ sql: 'select 1', env: { DATABASE_URL: url } }, { settings: { variable: 'DATABASE_URL' } });
  assert.equal(calls[0].command, 'psql'); assert.deepEqual(calls[0].args.slice(-2), ['-c', 'select 1']); assert.ok(calls[0].args.includes(url));
  assert.match(calls[0].options.env.PGOPTIONS, /default_transaction_read_only=on/); assert.equal(calls[0].options.inheritEnv, false);
  assert.deepEqual(result, { columns: ['id', 'note'], rows: [['1', ''], ['2', null]] });
  await assert.rejects(createPostgres(connectorApi({ runProcess: async () => ({ exitCode: 1, output: 'ERROR: cannot execute DELETE in a read-only transaction' }) })).actions.query.hooks['database.query']({ sql: 'delete from x', env: { DATABASE_URL: url } }, { settings: { variable: 'DATABASE_URL' } }), /read-only transaction/);
});

test('the connection comes from the configured variable, or any postgres URL in the env', () => {
  assert.equal(postgresUrl({ PG: url }, 'DATABASE_URL'), url);
  assert.throws(() => postgresUrl({ DATABASE_URL: 'mysql://x' }, 'DATABASE_URL'), /not a postgres/);
});

test('a task database is a template clone of the development one, or a dump and restore when the source is busy', async () => {
  const calls = [], busy = { value: false };
  const runProcess = async (command, args) => { calls.push([command, ...args].join(' ')); return busy.value && args.some(arg => /template/.test(arg)) ? { exitCode: 1, output: 'source database "app" is being accessed by other users' } : { exitCode: 0, output: '' }; };
  const hooks = createPostgres(connectorApi({ runProcess })).actions.taskDatabases.hooks, ctx = { settings: { variable: 'DATABASE_URL' } }, task = { id: 'abc', name: 'dispatch_task_abc' };
  assert.deepEqual(await hooks['database.provision']({ task, env: { DATABASE_URL: url } }, ctx), { env: { DATABASE_URL: 'postgres://dev:secret@localhost:5432/dispatch_task_abc' } });
  assert.ok(calls.some(call => call.includes('create database "dispatch_task_abc" template "app"'))); assert.ok(calls.every(call => !call.startsWith('pg_dump')));
  calls.length = 0; busy.value = true;
  await hooks['database.provision']({ task, env: { DATABASE_URL: url } }, ctx);
  assert.ok(calls.some(call => call.startsWith('pg_dump'))); assert.ok(calls.some(call => call.startsWith('pg_restore')));
  calls.length = 0;
  await hooks['database.release']({ task, env: { DATABASE_URL: 'postgres://dev:secret@localhost:5432/dispatch_task_abc' } }, ctx);
  assert.ok(calls[0].includes('/postgres') && calls[0].includes('drop database if exists "dispatch_task_abc" with (force)'));
});

test('a database with write access gets a writable session; read access stays read-only', async () => {
  const seen = [], runProcess = async (command, args, options) => { seen.push(options.env.PGOPTIONS); return { exitCode: 0, output: 'n\n1\n' }; };
  const query = createPostgres(connectorApi({ runProcess })).actions.query.hooks['database.query'], ctx = { settings: { variable: 'DATABASE_URL' } };
  await query({ sql: 'insert into x values (1)', env: { DATABASE_URL: url }, readOnly: false }, ctx); await query({ sql: 'select 1', env: { DATABASE_URL: url } }, ctx);
  assert.doesNotMatch(seen[0], /read_only/); assert.match(seen[1], /default_transaction_read_only=on/);
});

test('changes read the task database in a read-only session and compare it with the snapshot’s rows', async () => {
  const tables = [{ name: 'public.orders', columns: ['id', 'status'], key: ['id'], count: 2 }, { name: 'public."Events"', columns: ['id'], key: ['id'], count: 30_000 }];
  let status = 'pending';
  const calls = [], runProcess = async (command, args, options) => {
    calls.push({ args, options }); const sql = args.at(-1);
    return { exitCode: 0, output: JSON.stringify(sql.includes('pg_class') ? tables : { 'public.orders': [{ id: 1, status }, { id: 2, status: 'paid' }] }) };
  };
  const hooks = createPostgres(connectorApi({ runProcess })).actions.changes.hooks, ctx = { settings: { variable: 'DATABASE_URL' } };
  const { snapshot } = await hooks['database.snapshot']({ env: { DATABASE_URL: url } }, ctx);
  assert.deepEqual(snapshot.tables, [{ name: 'public.orders', columns: ['id', 'status'], key: ['id'], rows: [[1, 'pending'], [2, 'paid']] }, { name: 'public."Events"', count: 30_000 }]);
  assert.ok(calls.every(call => /default_transaction_read_only=on/.test(call.options.env.PGOPTIONS) && call.options.maxOutput > 1_000_000));
  assert.match(calls[1].args.at(-1), /select 'public.orders' as name, \(select coalesce\(json_agg\(t\), '\[\]'\) from public.orders t\)/);
  status = 'expired'; tables[1].count = 30_005;
  const { tables: changes } = await hooks['database.changes']({ env: { DATABASE_URL: url }, snapshot }, ctx);
  assert.deepEqual(changes.map(change => [change.name, change.inserted, change.updated, change.countOnly ?? false]), [['public.orders', 0, 1, false], ['public."Events"', 5, 0, true]]);
});

test('the largest tables give up their rows first so a snapshot stays within its row budget', () => {
  assert.deepEqual([...keptTables([{ name: 'a', count: 60_000 }, { name: 'b', count: 15_000 }, { name: 'c', count: 19_000 }, { name: 'd', count: 10 }])].sort(), ['b', 'c', 'd']);
  assert.deepEqual([...keptTables(Array.from({ length: 8 }, (_, index) => ({ name: `t${index}`, count: 15_000 })))].length, 6);
  assert.match(rowsSql([{ name: 'public."it\'s"' }]), /select 'public."it''s"' as name/);
});
