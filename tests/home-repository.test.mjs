import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/engine.mjs';
import { LiveService } from '../src/live.mjs';
import { Tasks } from '../src/tasks.mjs';
import { namedProjects } from '../src/repository.mjs';
import { completes, settle, temporaryRepository, workerDouble } from './live-double.mjs';

async function emptyFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-home-')), prompts = [];
  const engine = new Engine({ dataDir: join(dir, 'data') });
  const live = new LiveService(engine, { adapter: workerDouble(options => { prompts.push(options.prompt); return completes(options); }) });
  t.after(async () => { await engine.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  return { engine, live, prompts, home: join(realpathSync(join(dir, 'data')), 'home') };
}

test('with no repository saved a task starts in dispatch home and tells the agent it can save one', async t => {
  const { engine, live, prompts, home } = await emptyFixture(t);
  const run = await live.create({ input: 'Write a haiku to value.txt' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  assert.deepEqual(live.projects.map(project => [project.name, project.repositoryPath, project.validation.length]), [['dispatch home', home, 0]]);
  assert.equal(run.projectId, live.projects[0].id);
  assert.match(prompts[0], /This worktree is dispatch home.*dispatch_repository add/);
});

test('a repository named on its own is chosen; several or none start in dispatch home with the saved ones listed for the agent', async t => {
  const { engine, live, prompts } = await emptyFixture(t);
  const { dir, repo } = await temporaryRepository(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const saved = await live.saveProject({ repositoryPath: repo, name: 'portal', baseBranch: 'main', confirmed: true, validation: [] });
  const named = await live.create({ input: 'Fix the portal header' }); await settle(engine, named);
  assert.equal(named.projectId, saved.id); assert.match(named.repositorySelection.reason, /Selected portal/);
  const vague = await live.create({ input: 'Fix the header' }); await settle(engine, vague);
  assert.equal(live.projects.find(project => project.id === vague.projectId).name, 'dispatch home');
  assert.match(prompts.at(-1), new RegExp(`saved repositories: portal \\(${repo}\\)`));
  const tasks = new Tasks(live);
  assert.equal(tasks.save({ input: 'Later: fix the portal footer' }).projectId, saved.id);
  assert.equal(tasks.save({ input: 'Later: write a poem' }).projectId, vague.projectId);
});

test('a deleted dispatch home is recreated on the next task under the same saved repository', async t => {
  const { engine, live, home } = await emptyFixture(t);
  const [first, second] = await Promise.all([live.create({ input: 'First task' }), live.create({ input: 'Second task' })]);
  await settle(engine, first); await settle(engine, second);
  assert.equal(live.projects.length, 1);
  rmSync(home, { recursive: true, force: true });
  const again = await live.create({ input: 'Third task' }); await settle(engine, again);
  assert.ok(existsSync(join(home, '.git')));
  assert.equal(live.projects.length, 1); assert.equal(again.projectId, live.projects[0].id);
  assert.equal(again.status, 'ready', JSON.stringify(again.events.map(event => event.message)));
});

test('a mention inside a longer mention of another repository does not count as naming it', () => {
  const projects = [{ id: 'a', name: 'Browser test repository', repositoryPath: '/data/repository' }, { id: 'b', name: 'Second repository', repositoryPath: '/data/second' }, { id: 'c', name: 'API', repositoryPath: '/code/api' }];
  assert.deepEqual(namedProjects('Review the result (Second repository)', projects).map(project => project.id), ['b']);
  assert.deepEqual(namedProjects('Fix the repository and the API', projects).map(project => project.id), ['a', 'c']);
  assert.deepEqual(namedProjects('Fix Browser test repository and Second repository', projects).map(project => project.id), ['a', 'b']);
});
