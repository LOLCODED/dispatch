import test from 'node:test';
import assert from 'node:assert/strict';
import { connectorApi } from '../../api.mjs';
import { validateConnector } from '../../contract.mjs';
import createPostgres, { postgresUrl } from '../index.mjs';

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
