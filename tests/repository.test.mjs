import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listFolders, localPath } from '../src/folders.mjs';
import { agentCanDecide, mentionedProjects, maxTaskRepositories, projectForPath, resolveRepository, taskProject } from '../src/repository.mjs';

test('CLI-style paths expand home and relative folders without shell interpretation', () => {
  assert.equal(localPath('~/code/my app'), resolve(homedir(), 'code/my app'));
  assert.equal(localPath('"./my app"'), resolve('my app'));
  assert.equal(localPath('$(touch unsafe)'), resolve('$(touch unsafe)'));
  assert.throws(() => localPath(''), /path/);
  assert.throws(() => localPath('~someone/code'), /home/);
});

test('Auto repository selection asks on unknown and ambiguous targets; explicit choices win', () => {
  const projects = [{ id: 'a', name: 'Portal', repositoryPath: '/code/portal' }, { id: 'b', name: 'API', repositoryPath: '/code/api' }];
  assert.equal(resolveRepository('Fix Portal', projects).project.id, 'a');
  assert.equal(resolveRepository('Fix Portal and API', projects).project, undefined);
  assert.match(resolveRepository('Fix the button', projects).question, /Which repository/);
  assert.equal(resolveRepository('Fix Portal', projects, 'b').project.id, 'b');
  assert.equal(resolveRepository('Fix Portal', projects, 'removed').project, undefined);
  assert.equal(resolveRepository('Fix the button', [projects[0]]).project.id, 'a');
  assert.match(resolveRepository('Fix the button', []).question, /Connect/);
});

test('the agent decides an unchosen repository only when several are saved and all fit in one task', () => {
  const saved = count => Array.from({ length: count }, (_, index) => ({ id: `p${index}` }));
  assert.equal(agentCanDecide(saved(1)), false);
  assert.equal(agentCanDecide(saved(2)), true);
  assert.equal(agentCanDecide(saved(maxTaskRepositories)), true);
  assert.equal(agentCanDecide(saved(maxTaskRepositories + 1)), false);
});

test('repository mentions match complete names and paths and preserve ambiguity', () => {
  const projects = [{ id: 'a', name: 'Portal', repositoryPath: '/code/portal' }, { id: 'b', name: 'API', repositoryPath: '/code/api' }, { id: 'c', name: 'app.v2', repositoryPath: '/code/app.v2' }];
  assert.deepEqual(mentionedProjects('Fix Portal please', projects).map(p => p.id), ['a']);
  assert.deepEqual(mentionedProjects('Fix /code/api', projects).map(p => p.id), ['b']);
  assert.deepEqual(mentionedProjects('Fix Portal and API', projects).map(p => p.id), ['a', 'b']);
  assert.deepEqual(mentionedProjects('Fix portal-extra or rapid or appXv2', projects), []);
  assert.deepEqual(mentionedProjects('Fix app.v2', projects).map(p => p.id), ['c']);
});

test('terminal tasks pick --repo, then the working directory, then the composer rules', () => {
  const projects = [{ id: 'a', name: 'Portal', repositoryPath: '/code/portal' }, { id: 'b', name: 'API', repositoryPath: '/code/portal/api' }, { id: 'c', name: 'Web', repositoryPath: '/code/web' }];
  assert.equal(projectForPath('/code/portal/api/src', projects).id, 'b');
  assert.equal(projectForPath('/code/portal-old', projects), undefined);
  assert.equal(taskProject({ repo: 'web', cwd: '/code/portal', input: 'x' }, projects).project.id, 'c');
  assert.equal(taskProject({ repo: '/code/portal', input: 'x' }, projects).project.id, 'a');
  assert.match(taskProject({ repo: 'missing', input: 'x' }, projects).error, /No saved repository/);
  assert.equal(taskProject({ cwd: '/code/portal/docs', input: 'Fix Web' }, projects).project.id, 'a');
  assert.equal(taskProject({ cwd: '/tmp', input: 'Fix Web' }, projects).project.id, 'c');
  const unknown = taskProject({ cwd: '/tmp', input: 'Fix it' }, projects);
  assert.match(unknown.error, /--repo/); assert.equal(unknown.candidates.length, 3);
});

test('folder listings name a missing folder instead of a generic read failure', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-folders-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'app')); writeFileSync(join(root, 'file.txt'), '');
  assert.deepEqual((await listFolders(root)).folders.map(folder => folder.name), ['app']);
  await assert.rejects(listFolders(join(root, 'missing')), /does not exist: .*missing/);
  await assert.rejects(listFolders(join(root, 'file.txt')), /does not exist/);
});
