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
