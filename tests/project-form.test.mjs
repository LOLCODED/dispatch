import test from 'node:test';
import assert from 'node:assert/strict';
import { commandStep, databasesForm, databasesPayload, formChanged, newDatabase, tunnelDatabase, formFromInspect, formFromProject, newCommands, projectPayload, uniqueId, unusedScripts } from '../web/lib/project-form.mjs';

const project = {
  repositoryPath: '/repo', name: 'repo', baseBranch: 'main', review: true, memory: true, trackRemote: false,
  validation: [{ id: 'build', command: 'npm', args: ['run', 'build'], timeoutSeconds: 120 }, { id: 'browser-smoke', kind: 'browser-smoke', url: '/health' }],
  setup: [], checkScopes: [{ id: 'docs', paths: ['docs/**'], checks: [] }], instructions: ['Never touch main.'], protectedPaths: [],
  browser: { enabled: false }, connectors: { example: { enabled: true, actions: { comment: true }, settings: {} }, forge: { enabled: false, actions: {}, settings: { remote: 'upstream' } } },
};

test('a saved project round-trips through the form unchanged', () => {
  const form = formFromProject(project), payload = projectPayload(form, '/repo');
  assert.deepEqual(payload.validation, project.validation);
  assert.deepEqual(payload.checkScopes, project.checkScopes);
  assert.deepEqual(payload.connectors, { example: { enabled: true, actions: { comment: true }, settings: {} }, forge: { enabled: false, actions: {}, settings: { remote: 'upstream' } } });
  assert.equal(payload.trackRemote, false); assert.equal(payload.confirmed, true);
  assert.equal(formChanged(form, formFromProject(project)), false);
});

test('only commands that were not saved before need approval', () => {
  const saved = formFromProject(project), form = { ...saved, validation: [...saved.validation, commandStep('make test', ['build'])] };
  assert.deepEqual(newCommands(form, saved), ['make test']);
  assert.deepEqual(newCommands(saved, null), ['npm run build']);
});

test('new commands get unique ids and long-running scripts are confirmed explicitly', () => {
  assert.equal(uniqueId('build', ['build', 'build-2']), 'build-3');
  assert.deepEqual(commandStep('npm run build', ['build']), { id: 'build-2', command: 'npm', args: ['run', 'build'] });
  assert.equal(commandStep('npm run dev', []).confirmedLongRunning, true);
  assert.equal(commandStep('dispatch browser-smoke', []), null);
  assert.equal(commandStep('   ', []), null);
});

test('inspection suggests checks and a text-only shortcut, and offers only finite unused scripts', () => {
  const info = { repositoryPath: '/repo', name: 'repo', baseBranch: 'main', scripts: { check: 'x', test: 'y', dev: 'z', lint: 'w' }, suggestedChecks: ['check', 'test'], suggestInstall: true };
  const form = formFromInspect(info);
  assert.deepEqual(form.validation.map(step => step.id), ['check', 'test']);
  assert.deepEqual(form.scopes, [{ id: 'text-only', paths: ['*.md', 'docs/**'], checks: ['check'] }]);
  assert.deepEqual(unusedScripts(info, form), ['lint']);
});

test('blank path lines are dropped and empty shortcuts are left out on save', () => {
  const form = { ...formFromProject(project), scopes: [{ id: 'a', paths: ['web/**', ' ', ''], checks: ['build'] }, { id: 'b', paths: [''], checks: [] }] };
  assert.deepEqual(projectPayload(form, '/repo').checkScopes, [{ id: 'a', paths: ['web/**'], checks: ['build'] }]);
});

test('a plain folder round-trips without a base branch and never sends Git-only settings', () => {
  const folder = { ...project, git: false, baseBranch: null, trackRemote: false, dispatchCoAuthor: false, connectors: {} };
  const form = formFromProject(folder), payload = projectPayload({ ...form, trackRemote: true, dispatchCoAuthor: true }, '/repo');
  assert.equal(form.git, false); assert.equal(form.base, '');
  assert.equal(payload.baseBranch, null); assert.equal(payload.trackRemote, false); assert.equal(payload.dispatchCoAuthor, false); assert.deepEqual(payload.connectors, {});
  assert.equal(formFromInspect({ repositoryPath: '/folder', name: 'folder', git: false, baseBranch: null, branches: [], scripts: {}, suggestedChecks: [], suggestInstall: false }).git, false);
  assert.equal(formChanged(form, formFromProject(folder)), false);
});

test('databases load from both saved shapes and save with their names, access and connector options', () => {
  assert.deepEqual(databasesForm({ envFile: '.env', variable: 'DATABASE_URL' }), [{ name: 'default', access: 'read', options: {}, perTask: { on: false, provider: '', migrate: '', create: '', drop: '', snapshot: '', changes: '', env: '' }, engine: '', source: 'env', connector: '', envFile: '.env', variable: 'DATABASE_URL', query: '', format: 'csv', nullMarker: '' }]);
  const saved = [
    { name: 'local', access: 'write', engine: 'commands', connection: { from: 'envFile', envFile: '.env', variables: ['DB_HOST', 'DB_USER'] }, commands: { query: { command: 'mysql', args: ['--batch', '-e', '{sql}'] }, format: 'tsv', null: 'NULL' }, perTask: { provider: 'commands', migrate: { command: 'npm', args: ['run', 'db:migrate'] }, create: { command: 'createdb', args: ['-T', 'app', '{task}'] }, drop: { command: 'dropdb', args: ['--if-exists', '{task}'] }, env: { DATABASE_URL: 'postgres://127.0.0.1/{task}' } } },
    { name: 'staging', access: 'read', engine: null, connection: { from: 'connector', connector: 'ado', variable: 'DATABASE_URL', options: { keyVault: 'kv-staging' } } },
  ];
  assert.deepEqual(databasesPayload(databasesForm(saved)), [
    { name: 'local', access: 'write', engine: 'commands', connection: saved[0].connection, commands: { query: 'mysql --batch -e {sql}', format: 'tsv', null: 'NULL' }, perTask: { provider: 'commands', migrate: 'npm run db:migrate', create: 'createdb -T app {task}', drop: 'dropdb --if-exists {task}', env: 'DATABASE_URL=postgres://127.0.0.1/{task}' } },
    { name: 'staging', access: 'read', engine: null, connection: saved[1].connection },
  ]);
  assert.deepEqual(databasesPayload(databasesForm(null)), []);
  assert.deepEqual(databasesPayload([newDatabase('prod')]), []);
});

test('a database behind a tunnel you run reads its URL from your environment and queries it with psql', () => {
  const [payload] = databasesPayload([tunnelDatabase('staging')]);
  assert.deepEqual(payload, { name: 'staging', access: 'read', engine: 'commands', connection: { from: 'environment', variables: ['DATABASE_URL'] }, commands: { query: 'psql {DATABASE_URL} -X --csv -c {sql}', format: 'csv' } });
  assert.equal(databasesForm([{ name: 'staging', connection: payload.connection }])[0].source, 'environment');
  assert.deepEqual(databasesPayload([{ ...tunnelDatabase('staging'), variable: '' }]), []);
});
