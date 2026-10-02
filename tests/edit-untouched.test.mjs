import test from 'node:test';
import assert from 'node:assert/strict';
import { gated, liveFixture, settle, until } from './live-double.mjs';
import { Tasks } from '../src/tasks.mjs';
import { editTarget } from '../src/board-state.mjs';

test('a queued run no agent has touched can be rewritten until a worker picks it up', async t => {
  const { release, behavior } = gated();
  const { engine, live, project } = await liveFixture(t, { behavior });
  const first = await live.create({ projectId: project.id, input: 'First ticket' });
  await until(() => engine.active.has(first.id));
  const second = await live.create({ projectId: project.id, input: 'Second ticket' });
  await assert.rejects(live.edit(first.id, { input: 'Changed' }), error => error.status === 409);
  const edited = await live.edit(second.id, { input: 'Rewritten ticket\nMore detail' });
  assert.equal(edited.id, second.id); assert.equal(edited.title, 'Rewritten ticket'); assert.equal(edited.input, 'Rewritten ticket\nMore detail');
  assert.equal(edited.status, 'queued'); assert.equal(engine.runs.filter(run => run.title === 'Rewritten ticket').length, 1);
  await assert.rejects(live.edit(second.id, { input: ' ' }), /ticket text/);
  release();
  await settle(engine, first); await until(() => second.status !== 'queued');
  await assert.rejects(live.edit(second.id, { input: 'Too late' }), error => error.status === 409);
  await settle(engine, second);
});

test('a saved task can be rewritten until it starts', async t => {
  const { live, project } = await liveFixture(t);
  const tasks = new Tasks(live);
  const task = tasks.save({ projectId: project.id, input: 'Original task' });
  const updated = tasks.update(task.id, { input: '  Updated task\nDetail ' });
  assert.equal(updated.id, task.id); assert.equal(updated.title, 'Updated task'); assert.equal(updated.input, 'Updated task\nDetail'); assert.equal(updated.execution, 'auto');
  assert.throws(() => tasks.update(task.id, { input: '' }), /instructions/);
  assert.throws(() => tasks.update('missing', { input: 'x' }), /not found/);
  await tasks.start(task.id);
  assert.throws(() => tasks.update(task.id, { input: 'Too late' }), error => error.status === 409);
});

test('only untouched work offers an edit', () => {
  const queued = { id: 'run', status: 'queued', resumable: false };
  assert.deepEqual(editTarget({ key: 'task', state: 'todo', latest: null, turns: 0 }), { kind: 'tasks', id: 'task' });
  assert.deepEqual(editTarget({ key: 'run', state: 'active', latest: queued, turns: 1 }), { kind: 'runs', id: 'run' });
  assert.equal(editTarget({ key: 'run', state: 'active', latest: { ...queued, previousRunId: 'earlier' }, turns: 2 }), null);
  assert.equal(editTarget({ key: 'run', state: 'active', latest: { ...queued, resumable: true }, turns: 1 }), null);
  assert.equal(editTarget({ key: 'run', state: 'active', latest: { ...queued, status: 'implementing' }, turns: 1 }), null);
  assert.equal(editTarget({ key: 'task', state: 'archived', latest: null, turns: 0 }), null);
});
