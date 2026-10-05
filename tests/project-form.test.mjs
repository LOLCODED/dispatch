import test from 'node:test';
import assert from 'node:assert/strict';
import { commandStep, databaseForm, databasePayload, formChanged, formFromInspect, formFromProject, newCommands, projectPayload, uniqueId, unusedScripts } from '../web/lib/project-form.mjs';

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

test('database settings load from both saved shapes and save an engine with its connection', () => {
  assert.deepEqual(databaseForm({ envFile: '.env', variable: 'DATABASE_URL' }), { engine: '', source: 'env', connector: '', envFile: '.env', variable: 'DATABASE_URL', query: '', format: 'csv', nullMarker: '' });
  const saved = { engine: 'commands', connection: { from: 'envFile', envFile: '.env', variables: ['DB_HOST', 'DB_USER'] }, commands: { query: { command: 'mysql', args: ['--batch', '-e', '{sql}'] }, format: 'tsv', null: 'NULL' } };
  assert.deepEqual(databasePayload(databaseForm(saved)), { engine: 'commands', connection: saved.connection, commands: { query: 'mysql --batch -e {sql}', format: 'tsv', null: 'NULL' } });
  assert.deepEqual(databasePayload(databaseForm({ source: 'connector', connector: 'ado' })), { engine: null, connection: { from: 'connector', connector: 'ado' } });
  assert.equal(databasePayload(databaseForm(null)), null);
});
