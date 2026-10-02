import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '../src/engine.mjs';
import { Tasks } from '../src/tasks.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dispatch-tasks-'));
  const engine = new Engine({ dataDir: directory });
  let starts = 0;
  const live = { engine, projects: [{ id: 'project' }], create: async (input, { taskId }) => {
    starts++; await new Promise(resolve => setTimeout(resolve, 10));
    const run = { id: 'run', taskId, ...input, status: 'ready' };
    engine.runs.push(run); engine.store.save(); return run;
  } };
  t.after(async () => { await engine.shutdown(); rmSync(directory, { recursive: true, force: true }); });
  return { engine, live, tasks: new Tasks(live), starts: () => starts, directory };
}
test('concurrent starts coalesce and persisted linkage prevents replay after restart', async t => {
  const { tasks, live, starts, directory } = fixture(t);
  const task = tasks.save({ projectId: 'project', input: 'Build a site' });
  const [first, second] = await Promise.all([tasks.start(task.id), tasks.start(task.id)]);
  assert.equal(first.id, second.id); assert.equal(starts(), 1);
  const recoveredEngine = new Engine({ dataDir: directory });
  const recovered = new Tasks({ ...live, engine: recoveredEngine }); assert.equal((await recovered.start(task.id)).id, first.id); assert.equal(starts(), 1);
  recoveredEngine.runs.push({ id: 'followup', status: 'implementing', events: [] }); recoveredEngine.get(first.id).supersededBy = 'followup';
  assert.equal(recovered.list()[0].status, 'implementing'); assert.equal((await recovered.start(task.id)).id, 'followup');
  await recoveredEngine.shutdown();
});
test('failed intake leaves the saved task available and permits explicit retry', async t => {
  const { tasks, live } = fixture(t);
  const task = tasks.save({ projectId: 'project', input: 'https://tracker.example/p/issues/1' });
  const create = live.create; live.create = async () => { throw new Error('Intake unavailable'); };
  await assert.rejects(tasks.start(task.id), /Intake unavailable/);
  assert.equal(tasks.list()[0].status, 'saved');
  live.create = create; assert.equal((await tasks.start(task.id)).status, 'ready');
  assert.throws(() => tasks.save({ projectId: 'missing', input: 'Task' }), /repository/);
  assert.throws(() => tasks.save({ projectId: 'project', input: ' ' }), /instructions/);
  await assert.rejects(tasks.start('missing'), /not found/);
});

test('saved task choices distinguish models and retain them across restart and start', async t => {
  const { tasks, live, directory } = fixture(t);
  live.modelCatalog = { models: [{ provider: 'codex', model: 'test-sol', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] };
  const execution = { provider: 'codex', model: 'test-sol', effort: 'high' };
  const input = { projectId: 'project', input: 'Plan a change', execution };
  const task = tasks.save(input); assert.equal(tasks.save(input).id, task.id); assert.equal(task.executionMode, undefined);
  assert.notEqual(tasks.save({ ...input, execution: 'auto' }).id, task.id);
  const recoveredEngine = new Engine({ dataDir: directory }); t.after(() => recoveredEngine.shutdown());
  const recovered = new Tasks({ ...live, engine: recoveredEngine });
  const run = await recovered.start(task.id); assert.deepEqual(run.execution, execution); assert.equal(run.executionMode, undefined);
});

test('saved tasks keep their repository list or hand the choice to the agent', async t => {
  const { tasks, live } = fixture(t);
  live.projects = [{ id: 'project', name: 'Portal', repositoryPath: '/code/portal' }, { id: 'other', name: 'Other', repositoryPath: '/code/other' }];
  const listed = tasks.save({ projectIds: ['other', 'project'], input: 'Both' });
  assert.equal(listed.projectId, 'other'); assert.deepEqual(listed.projectIds, ['other', 'project']);
  assert.equal(tasks.save({ projectIds: ['other', 'project'], input: 'Both' }).id, listed.id);
  assert.notEqual(tasks.save({ projectId: 'other', input: 'Both' }).id, listed.id);
  const agent = tasks.save({ projectIds: 'all', input: 'Fix Other first' });
  assert.equal(agent.projectId, 'other'); assert.equal(agent.projectIds, 'all');
  assert.throws(() => tasks.save({ input: 'No repository' }), /saved repository/);
  const run = await tasks.start(listed.id); assert.deepEqual(run.projectIds, ['other', 'project']);
});

test('a task can name the run it came from only when that run is in the same repository', t => {
  const { tasks, engine } = fixture(t);
  engine.runs.push({ id: 'source', projectId: 'project', status: 'ready', events: [] }, { id: 'elsewhere', projectId: 'other', status: 'ready', events: [] });
  assert.equal(tasks.save({ projectId: 'project', input: 'Deferred finding', sourceRunId: 'source' }).sourceRunId, 'source');
  assert.throws(() => tasks.save({ projectId: 'project', input: 'Another', sourceRunId: 'elsewhere' }), /source run/);
  assert.equal(tasks.save({ projectId: 'project', input: 'Plain' }).sourceRunId, undefined);
});
