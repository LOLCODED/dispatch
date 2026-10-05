import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Databases, databasesBrief, databasesSettings, envFileValues, parseDelimited, projectDatabases, textTable } from '../src/database.mjs';
import { DispatchToolCalls } from '../src/tool-calls.mjs';
import { toolNames } from '../src/dispatch-tools.mjs';

const url = 'postgres://dev:secret@localhost:5432/app';
const workspace = t => { const dir = mkdtempSync(join(tmpdir(), 'dispatch-db-')); t.after(() => rmSync(dir, { recursive: true, force: true })); writeFileSync(join(dir, '.env.test'), `OTHER=1\nexport DATABASE_URL="${url}"\nDB_USER=app\n`); return dir; };
const local = { name: 'local', access: 'write', connection: { envFile: '.env.test', variables: ['DATABASE_URL'] } };
const staging = { name: 'staging', access: 'read', engine: 'pg', connection: { from: 'connector', connector: 'ado', options: { vault: 'kv-staging' } } };
const prod = { name: 'prod', access: 'none', connection: { from: 'connector', connector: 'ado', options: { vault: 'kv-prod' } } };
function connectorsDouble({ hooks = { 'database.query': 'pg' }, answer = async () => ({ columns: ['n'], rows: [['1']] }) } = {}) {
  const calls = [];
  return { calls, registry: { withHook: hook => hooks[hook] ? [{ connector: { id: hooks[hook] } }] : [], hook: (id, hook) => Object.hasOwn(hooks, hook) ? {} : null, get: id => ({ name: id }) }, invoke: async (project, id, hook, args, options) => { calls.push({ id, hook, input: args[0], database: options.database }); return answer(hook, args[0], options); } };
}

test('older single-database settings become the read-only database "default"; named databases keep their access', () => {
  assert.deepEqual(databasesSettings({ envFile: ' .env.test ', variable: 'DATABASE_URL' }), [{ name: 'default', access: 'read', engine: null, connection: { from: 'envFile', envFile: '.env.test', variables: ['DATABASE_URL'] } }]);
  assert.deepEqual(databasesSettings({ source: 'connector', connector: 'ado' })[0].connection, { from: 'connector', connector: 'ado', variable: 'DATABASE_URL' });
  assert.deepEqual(databasesSettings([local, staging, prod]).map(entry => [entry.name, entry.access, entry.connection.options ?? null]), [['local', 'write', null], ['staging', 'read', { vault: 'kv-staging' }], ['prod', 'none', { vault: 'kv-prod' }]]);
  assert.deepEqual(projectDatabases({ database: { envFile: '.env', variable: 'A' } }).map(entry => entry.name), ['default']);
  for (const value of [[local, local], [{ ...local, name: 'Local DB' }], [{ ...local, access: 'admin' }], [{ ...local, perTask: { provider: 'pg' } }, { ...staging, perTask: { provider: 'pg' } }], [{ ...staging, connection: { ...staging.connection, options: { 'bad key': 'x' } } }], { engine: 'commands', connection: { envFile: '.env', variable: 'A' } }]) assert.throws(() => databasesSettings(value), JSON.stringify(value));
});

test('env files are read for the named variables only; delimited output and text tables keep NULL distinct', t => {
  const dir = workspace(t);
  assert.deepEqual(envFileValues(dir, '.env.test', ['DATABASE_URL', 'DB_USER']), { DATABASE_URL: url, DB_USER: 'app' });
  assert.throws(() => envFileValues(dir, '.env.test', ['MISSING']), /MISSING is not set/);
  assert.deepEqual(parseDelimited('a,b\n"x,1","say ""hi""\nthere"\n'), [['a', 'b'], ['x,1', 'say "hi"\nthere']]);
  assert.equal(textTable(['id', 'note'], [['1', null]]), 'id | note\n---+-----\n1  | NULL\n(1 row)');
});

test('queries go to the named database, read only unless its access is write, and a database set to none is refused', async t => {
  const dir = workspace(t), connectors = connectorsDouble({ hooks: { 'database.query': 'pg', 'database.url': 'ado' }, answer: async hook => hook === 'database.url' ? 'postgres://staging:hidden-password@db/app' : { columns: ['u'], rows: [['postgres://staging:hidden-password@db/app']] } });
  const run = { id: 'r1', workspace: dir, project: { databases: databasesSettings([local, staging, prod]) } }, databases = new Databases({ connectors, log() {} });
  await databases.call(run, { query: 'insert into x values (1)', database: 'local' });
  const result = await databases.call(run, { query: 'select 1', database: 'staging' });
  const queries = connectors.calls.filter(call => call.hook === 'database.query');
  assert.deepEqual(queries.map(call => [call.database.name, call.input.readOnly]), [['local', false], ['staging', true]]);
  assert.deepEqual(connectors.calls.find(call => call.hook === 'database.url').database, { name: 'staging', options: { vault: 'kv-staging' } });
  assert.deepEqual(result.view.rows, [['<database>']]); assert.equal(result.view.title, 'staging');
  assert.match((await databases.call(run, { query: 'select 1', database: 'prod' })).content[0].text, /does not allow the agent to use prod/);
  assert.match((await databases.call(run, { query: 'select 1' })).content[0].text, /Name the database: local, staging/);
  assert.equal(databasesBrief(databases.available(run.project)), ' Databases for dispatch_sql (pass database by name): local (read and write); staging (read only). Never change a database you can only read.');
});

test('a connector with database.connect opens one connection per run and database, reused until the run ends', async () => {
  const connectors = connectorsDouble({ hooks: { 'database.query': 'pg', 'database.connect': 'ado', 'database.disconnect': 'ado' }, answer: async hook => hook === 'database.connect' ? { env: { DATABASE_URL: 'postgres://u:p@127.0.0.1:61000/app' } } : { columns: [], rows: [] } });
  const run = { id: 'r2', workspace: '/w', project: { databases: databasesSettings([staging]) } }, databases = new Databases({ connectors, log() {} });
  await databases.call(run, { query: 'select 1' }); await databases.call(run, { query: 'select 2' });
  assert.equal(connectors.calls.filter(call => call.hook === 'database.connect').length, 1);
  assert.deepEqual(connectors.calls.find(call => call.hook === 'database.query').input.env, { DATABASE_URL: 'postgres://u:p@127.0.0.1:61000/app' });
  await databases.disconnect(run);
  assert.deepEqual(connectors.calls.filter(call => call.hook === 'database.disconnect').map(call => call.database.name), ['staging']);
  await databases.disconnect(run);
  assert.equal(connectors.calls.filter(call => call.hook === 'database.disconnect').length, 1);
});

test('the commands engine runs the operator command with the connection env and parses its output', async t => {
  const dir = workspace(t), calls = [];
  const execute = async (command, args, options) => { calls.push({ command, args, env: options.env }); return { exitCode: 0, output: 'id\tname\n1\tNULL\n' }; };
  const run = { id: 'r3', workspace: dir, project: { databases: databasesSettings([{ name: 'mysql', engine: 'commands', connection: { envFile: '.env.test', variables: ['DB_USER'] }, commands: { query: 'mysql --batch -e {sql}', format: 'tsv', null: 'NULL' } }]) } };
  const result = await new Databases({ connectors: connectorsDouble({ hooks: {} }) }, { execute }).call(run, { query: 'select 1' });
  assert.equal(calls[0].command, 'mysql'); assert.deepEqual(calls[0].args, ['--batch', '-e', 'select 1']); assert.equal(calls[0].env.DB_USER, 'app');
  assert.deepEqual(result.view.rows, [['1', null]]);
});

test('dispatch_sql is attached only when the repository has a database the agent may use', () => {
  const tools = databases => toolNames(new DispatchToolCalls({ databases: new Databases({}) }).tools({ project: { memory: false, databases } }, { questions: 'native' }));
  assert.deepEqual(tools(undefined), []); assert.deepEqual(tools(databasesSettings([prod])), []); assert.deepEqual(tools(databasesSettings([local])), ['dispatch_sql']);
});
