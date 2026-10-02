import test from 'node:test';
import assert from 'node:assert/strict';
import { agentPrimary, maxTaskRepositories, mentionOrder, taskProjects } from '../src/repository.mjs';
import { agentMembers, taskRepositories } from '../src/repository-selection.mjs';

const projects = [{ id: 'a', name: 'Portal', repositoryPath: '/code/portal' }, { id: 'b', name: 'API', repositoryPath: '/code/api' }, { id: 'c', name: 'Service', repositoryPath: '/code/service' }];
const many = Array.from({ length: maxTaskRepositories + 1 }, (_, index) => ({ id: `p${index}`, name: `Repo ${index}`, repositoryPath: `/code/repo${index}` }));

test('projectIds names every repository with the first as primary and never inherits static links', () => {
  assert.deepEqual(taskRepositories({ projectIds: ['b', 'a', 'b'] }, projects), { mode: 'manual', ids: ['b', 'a'], inherit: false });
  assert.deepEqual(taskRepositories({ projectIds: ['a'], projectId: 'b' }, projects), { mode: 'manual', ids: ['a'], inherit: false });
  assert.throws(() => taskRepositories({ projectIds: [] }, projects), /saved repositories/);
  assert.throws(() => taskRepositories({ projectIds: ['a', 'missing'] }, projects), /saved repositories/);
  assert.throws(() => taskRepositories({ projectIds: [1] }, projects), /saved repositories/);
  assert.throws(() => taskRepositories({ projectIds: many.map(project => project.id) }, many), /at most 8/);
});

test('a lone projectId keeps the old behaviour and all hands the choice to the agent', () => {
  assert.deepEqual(taskRepositories({ projectId: 'a' }, projects), { mode: 'manual', ids: ['a'], inherit: true });
  assert.deepEqual(taskRepositories({}, projects), { mode: 'auto', ids: [], inherit: true });
  assert.deepEqual(taskRepositories({ projectId: 'auto' }, projects), { mode: 'auto', ids: [], inherit: true });
  assert.deepEqual(taskRepositories({ projectIds: 'all' }, projects), { mode: 'agent', ids: [], inherit: false });
  assert.deepEqual(taskRepositories({ projectId: 'all' }, projects), { mode: 'agent', ids: [], inherit: false });
  assert.throws(() => taskRepositories({ projectId: 'missing' }, projects), /saved repository/);
});

test('the agent starts in the repository mentioned first, else the first saved one', () => {
  assert.equal(agentPrimary('Fix the API and then Portal', projects).project.id, 'b');
  assert.match(agentPrimary('Fix the API and then Portal', projects).reason, /API, mentioned first/);
  assert.equal(agentPrimary('Portal needs the /code/api change', projects).project.id, 'a');
  assert.equal(agentPrimary('Fix the button', projects).project.id, 'a');
  assert.match(agentPrimary('Fix the button', projects).reason, /first saved repository/);
  assert.match(agentPrimary('Fix it', []).question, /Connect/);
  assert.deepEqual(mentionOrder('Service, then API', projects).map(project => project.id), ['c', 'b']);
  assert.deepEqual(agentMembers(projects[1], projects), ['a', 'c']);
  assert.throws(() => agentMembers(many[0], many), /tick the repositories/);
});

test('terminal tasks take --repo all or a list of repositories', () => {
  assert.deepEqual(taskProjects({ repo: 'all', input: 'x' }, projects), { all: true });
  assert.deepEqual(taskProjects({ repo: 'api,portal', input: 'x' }, projects).projects.map(project => project.id), ['b', 'a']);
  assert.deepEqual(taskProjects({ repo: ['api', '/code/service'], input: 'x' }, projects).projects.map(project => project.id), ['b', 'c']);
  assert.match(taskProjects({ repo: 'api,missing', input: 'x' }, projects).error, /No saved repository matches "missing"/);
  assert.match(taskProjects({ repo: 'all,api', input: 'x' }, projects).error, /cannot be combined/);
  assert.deepEqual(taskProjects({ cwd: '/code/service/src', input: 'x' }, projects).projects.map(project => project.id), ['c']);
  assert.match(taskProjects({ cwd: '/tmp', input: 'Fix it' }, projects).error, /--repo/);
});
