import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { databaseSettings, databaseUrl, parseCsv, sqlCall } from '../src/sql-tool.mjs';
import { tableView } from '../src/views.mjs';
import { DispatchToolCalls } from '../src/tool-calls.mjs';
import { toolNames } from '../src/dispatch-tools.mjs';

const url = 'postgres://dev:secret@localhost:5432/app';

test('database settings name an env file inside the repository and a variable', () => {
  assert.equal(databaseSettings(undefined), null);
  assert.deepEqual(databaseSettings({ envFile: ' .env.test ', variable: 'DATABASE_URL' }), { envFile: '.env.test', variable: 'DATABASE_URL' });
  for (const value of [{ envFile: '../.env', variable: 'A' }, { envFile: '/etc/env', variable: 'A' }, { envFile: '.env', variable: 'not valid' }, { variable: 'A' }, 'x']) assert.throws(() => databaseSettings(value), JSON.stringify(value));
});

test('queries run read-only through psql and never echo the connection string', async t => {
  const workspace = mkdtempSync(join(tmpdir(), 'dispatch-sql-')); t.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(join(workspace, '.env.test'), `OTHER=1\nexport DATABASE_URL="${url}"\n`);
  const run = { workspace, project: { database: { envFile: '.env.test', variable: 'DATABASE_URL' } } }, calls = [];
  assert.equal(databaseUrl(workspace, run.project.database), url);
  const execute = async (command, args, options) => { calls.push({ command, args, options }); return { exitCode: 0, output: `id,note\n1,${url}\n2,\\N\n` }; };
  const result = await sqlCall({ run, args: { query: 'select 1 as id' }, execute });
  assert.equal(calls[0].command, 'psql'); assert.deepEqual(calls[0].args.slice(-2), ['-c', 'select 1 as id']);
  assert.match(calls[0].options.env.PGOPTIONS, /default_transaction_read_only=on/); assert.equal(calls[0].options.inheritEnv, false);
  assert.equal(result.isError, false); assert.doesNotMatch(result.content[0].text, /secret/); assert.match(result.content[0].text, /1  \| <database>\n2  \| NULL\n\(2 rows\)/);
  assert.deepEqual(result.view, { type: 'table', label: 'SQL', columns: ['id', 'note'], rows: [['1', '<database>'], ['2', null]], rowCount: 2, truncated: false, query: 'select 1 as id' });
  const failed = await sqlCall({ run, args: { query: 'delete from x' }, execute: async () => ({ exitCode: 1, output: 'ERROR: cannot execute DELETE in a read-only transaction' }) });
  assert.equal(failed.isError, true); assert.match(failed.view.error, /read-only transaction/);
  await assert.rejects(sqlCall({ run: { workspace, project: { database: { envFile: '.env.missing', variable: 'DATABASE_URL' } } }, args: { query: 'select 1' }, execute }), /Copied from your checkout/);
});

test('dispatch_sql is attached only when the repository has a database', () => {
  const calls = new DispatchToolCalls({});
  assert.equal(toolNames(calls.tools({ project: { memory: false } }, { questions: 'native' })).includes('dispatch_sql'), false);
  assert.deepEqual(toolNames(calls.tools({ project: { memory: false, database: { envFile: '.env', variable: 'DATABASE_URL' } } }, { questions: 'native' })), ['dispatch_sql']);
});

test('a connector can provide the connection string, for example from a secret store', async () => {
  assert.deepEqual(databaseSettings({ source: 'connector', connector: 'ado' }), { source: 'connector', connector: 'ado' });
  for (const value of [{ source: 'connector' }, { source: 'connector', connector: 'Bad Id' }, { source: 'connector', connector: 'ado', extra: 1 }]) assert.throws(() => databaseSettings(value), JSON.stringify(value));
  const run = { workspace: '/nowhere', project: { database: { source: 'connector', connector: 'vault' } } }, asked = [];
  const connectorUrl = async (project, id) => { asked.push(id); return `${url}\n`; };
  const execute = async (command, args) => ({ exitCode: 0, output: `seen\n${args[0]}\n` });
  const result = await sqlCall({ run, args: { query: 'select 1' }, execute, connectorUrl });
  assert.deepEqual(asked, ['vault']); assert.deepEqual(result.view.rows, [['<database>']]);
  await assert.rejects(sqlCall({ run, args: { query: 'select 1' }, execute, connectorUrl: async () => 'mysql://x' }), /did not return a postgres/);
});

test('csv parsing keeps quoted commas, quotes and newlines, and the grid stops at its size budget', () => {
  assert.deepEqual(parseCsv('a,b\n"x,1","say ""hi""\nthere"\n'), [['a', 'b'], ['x,1', 'say "hi"\nthere']]);
  const rows = Array.from({ length: 2000 }, (_, index) => [String(index), 'x'.repeat(40)]);
  const grid = tableView(['n', 'text'], rows);
  assert.equal(grid.rowCount, 2000); assert.equal(grid.truncated, true); assert.ok(grid.rows.length > 100 && JSON.stringify(grid).length < 13_000);
});
