import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Databases, databaseSettings, envFileValues, parseDelimited, textTable } from '../src/database.mjs';
import { DispatchToolCalls } from '../src/tool-calls.mjs';
import { toolNames } from '../src/dispatch-tools.mjs';

const url = 'postgres://dev:secret@localhost:5432/app';
const workspace = t => { const dir = mkdtempSync(join(tmpdir(), 'dispatch-db-')); t.after(() => rmSync(dir, { recursive: true, force: true })); writeFileSync(join(dir, '.env.test'), `OTHER=1\nexport DATABASE_URL="${url}"\nDB_USER=app\n`); return dir; };
const engines = (...ids) => ({ registry: { withHook: () => ids.map(id => ({ connector: { id } })) } });

test('older connection-only settings keep working and new settings name an engine and a connection', () => {
  assert.equal(databaseSettings(undefined), null);
  assert.deepEqual(databaseSettings({ envFile: ' .env.test ', variable: 'DATABASE_URL' }), { engine: null, connection: { from: 'envFile', envFile: '.env.test', variables: ['DATABASE_URL'] } });
  assert.deepEqual(databaseSettings({ source: 'connector', connector: 'ado' }), { engine: null, connection: { from: 'connector', connector: 'ado', variable: 'DATABASE_URL' } });
  assert.deepEqual(databaseSettings({ engine: 'commands', connection: { envFile: '.env', variables: ['DB_USER'] }, commands: { query: 'mysql --batch -e {sql}', format: 'tsv', null: 'NULL' } }).commands, { query: { command: 'mysql', args: ['--batch', '-e', '{sql}'] }, format: 'tsv', null: 'NULL' });
  for (const value of [{ envFile: '../.env', variable: 'A' }, { envFile: '/etc/env', variable: 'A' }, { envFile: '.env', variable: 'not valid' }, { variable: 'A' }, 'x', { engine: 'Bad Id', connection: { envFile: '.env', variable: 'A' } }, { engine: 'commands', connection: { envFile: '.env', variable: 'A' } }]) assert.throws(() => databaseSettings(value), JSON.stringify(value));
});

test('env files are read for the named variables only, quotes and export removed', t => {
  const dir = workspace(t);
  assert.deepEqual(envFileValues(dir, '.env.test', ['DATABASE_URL', 'DB_USER']), { DATABASE_URL: url, DB_USER: 'app' });
  assert.throws(() => envFileValues(dir, '.env.test', ['MISSING']), /MISSING is not set/);
  assert.throws(() => envFileValues(dir, '.env.missing', ['A']), /Copied from your checkout/);
});

test('delimited output keeps quoted delimiters, quotes and newlines; text tables mark NULL', () => {
  assert.deepEqual(parseDelimited('a,b\n"x,1","say ""hi""\nthere"\n'), [['a', 'b'], ['x,1', 'say "hi"\nthere']]);
  assert.deepEqual(parseDelimited('a\tb\n1\t2\n', '\t'), [['a', 'b'], ['1', '2']]);
  assert.equal(textTable(['id', 'note'], [['1', null]]), 'id | note\n---+-----\n1  | NULL\n(1 row)');
});

test('the only loaded query connector is the default engine; it gets the connection env and its output is redacted', async t => {
  const dir = workspace(t), seen = [];
  const live = { connectors: { ...engines('postgres'), invoke: async (project, id, hook, args) => { seen.push({ id, hook, ...args[0] }); return { columns: ['url'], rows: [[url], [null]] }; } } };
  const run = { workspace: dir, project: { database: databaseSettings({ envFile: '.env.test', variable: 'DATABASE_URL' }) } };
  const result = await new Databases(live).call(run, { query: 'select 1' });
  assert.deepEqual(seen, [{ id: 'postgres', hook: 'database.query', sql: 'select 1', env: { DATABASE_URL: url }, workspace: dir }]);
  assert.equal(result.isError, false); assert.doesNotMatch(result.content[0].text, /secret/); assert.deepEqual(result.view.rows, [['<database>'], [null]]); assert.equal(result.view.label, 'SQL');
  await assert.rejects(new Databases({ connectors: engines('a', 'b') }).query(run, 'select 1'), /Choose which database connector/);
  const failed = await new Databases({ connectors: { ...engines('postgres'), invoke: async () => { throw new Error(`could not connect to ${url}`); } } }).call(run, { query: 'select 1' });
  assert.equal(failed.isError, true); assert.equal(failed.view.error, 'could not connect to <database>');
});

test('the commands engine runs the operator command with the connection env and parses its output', async t => {
  const dir = workspace(t), calls = [];
  const execute = async (command, args, options) => { calls.push({ command, args, env: options.env }); return { exitCode: 0, output: 'id\tname\n1\tNULL\n' }; };
  const run = { workspace: dir, project: { database: databaseSettings({ engine: 'commands', connection: { envFile: '.env.test', variables: ['DB_USER'] }, commands: { query: 'mysql --batch -e {sql}', format: 'tsv', null: 'NULL' } }) } };
  const result = await new Databases({ connectors: engines() }, { execute }).call(run, { query: 'select 1' });
  assert.equal(calls[0].command, 'mysql'); assert.deepEqual(calls[0].args, ['--batch', '-e', 'select 1']); assert.equal(calls[0].env.DB_USER, 'app');
  assert.deepEqual(result.view.rows, [['1', null]]);
});

test('dispatch_sql is attached only when the repository has a database', () => {
  const calls = new DispatchToolCalls({});
  assert.equal(toolNames(calls.tools({ project: { memory: false } }, { questions: 'native' })).includes('dispatch_sql'), false);
  assert.deepEqual(toolNames(calls.tools({ project: { memory: false, database: { engine: null, connection: { from: 'envFile', envFile: '.env', variables: ['DATABASE_URL'] } } } }, { questions: 'native' })), ['dispatch_sql']);
});
