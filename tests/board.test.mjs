import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '../src/engine.mjs';
import { Board } from '../src/board.mjs';
import { taskState } from '../src/board-state.mjs';
import { liveFixture, settle, until } from './live-double.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dispatch-board-'));
  const engine = new Engine({ dataDir: directory });
  engine.store.state.tasks.push({ id: 'task-1', title: 'Saved' });
  engine.runs.push({ id: 'root', mode: 'live', status: 'ready', taskId: 'task-2', supersededBy: 'next', events: [] }, { id: 'next', mode: 'live', status: 'failed', previousRunId: 'root', events: [] });
  engine.store.save();
  t.after(async () => { await engine.shutdown(); rmSync(directory, { recursive: true, force: true }); });
  return { engine, board: new Board({ engine }), directory };
}

test('an old state file gains an empty board and a malformed board is refused', t => {
  const { engine, directory } = fixture(t);
  assert.deepEqual(engine.store.state.board, { folders: [], items: {} });
  writeFileSync(join(directory, 'state.json'), JSON.stringify({ version: 2, runs: [], board: { folders: {}, items: {} } }));
  assert.throws(() => new Engine({ dataDir: directory }), /Invalid board/);
});

test('folders nest, rename, and hand their contents up when deleted', t => {
  const { board } = fixture(t);
  const parent = board.createFolder({ name: ' Sprint 42 ' }), child = board.createFolder({ name: 'Auth', parentId: parent.id });
  assert.equal(parent.name, 'Sprint 42');
  board.update('task-1', { folderId: child.id });
  assert.equal(board.renameFolder(child.id, { name: 'Login' }).name, 'Login');
  const grandchild = board.createFolder({ name: 'Deep', parentId: child.id });
  board.deleteFolder(child.id);
  assert.equal(board.state.items['task-1'].folderId, parent.id);
  assert.equal(board.folders.find(folder => folder.id === grandchild.id).parentId, parent.id);
  assert.throws(() => board.createFolder({ name: ' ' }), /1–60/);
  assert.throws(() => board.createFolder({ name: 'x', parentId: 'missing' }), /Folder not found/);
  assert.throws(() => board.update('task-1', { folderId: 'missing' }), /Folder not found/);
});

test('folders nest at most five deep', t => {
  const { board } = fixture(t);
  let parentId = null;
  for (let depth = 0; depth < 5; depth++) parentId = board.createFolder({ name: `L${depth}`, parentId }).id;
  assert.throws(() => board.createFolder({ name: 'Too deep', parentId }), /at most 5/);
});

test('follow-up and task ids resolve to one conversation key', t => {
  const { board } = fixture(t);
  assert.equal(board.update('next', { archived: true }).key, 'task-2');
  assert.equal(board.resolve('task-2').latest.id, 'next');
  assert.throws(() => board.resolve('unknown'), /Task not found/);
});

test('done and pause on a stopped task only set flags and persist across restart', async t => {
  const { engine, board, directory } = fixture(t);
  board.update('task-2', { done: true });
  assert.equal(taskState({ latest: engine.get('next'), item: board.state.items['task-2'] }), 'completed');
  await board.pause('task-2');
  assert.equal(engine.get('next').status, 'failed');
  const recovered = new Engine({ dataDir: directory }); t.after(() => recovered.shutdown());
  assert.equal(taskState({ latest: recovered.get('next'), item: recovered.store.state.board.items['task-2'] }), 'paused');
  await assert.rejects(board.pause('task-1'), /Start the task/);
  const resumed = await board.resume('task-2');
  assert.equal(resumed.runId, 'next'); assert.equal(resumed.item.pause, undefined);
});

test('pausing an active run stops it without publishing and resume continues the same session', async t => {
  const prompts = [];
  const { live, engine, project } = await liveFixture(t, { behavior: async (options, turn) => {
    prompts.push(options.prompt);
    if (turn === 1) { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return { outcome: 'cancelled', sessionId: 'session-1' }; }
    writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Updated' };
  } });
  const board = new Board(live), run = await live.create({ projectId: project.id, input: 'Start slowly' });
  await until(() => run.status === 'implementing' && run.sessionId);
  await assert.rejects(Promise.resolve().then(() => board.update(run.id, { archived: true })), /Stop or pause/);
  await board.pause(run.id);
  assert.equal(run.status, 'cancelled'); assert.equal(run.handoff, null); assert.match(run.events.at(-1).message, /Paused by operator/);
  assert.equal(taskState({ latest: run, item: board.state.items[run.id] }), 'paused');
  const { runId } = await board.resume(run.id), next = engine.get(runId);
  await settle(engine, next);
  assert.equal(next.previousRunId, run.id); assert.equal(next.sessionId, 'session-1'); assert.equal(next.status, 'ready');
  assert.match(prompts[1], /Continue where you left off/);
  await assert.rejects(board.resume(run.id), /not paused/);
});

test('pause is refused before the agent session exists', async t => {
  const { live, project } = await liveFixture(t, { behavior: async options => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return { outcome: 'cancelled' }; } });
  const board = new Board(live), run = await live.create({ projectId: project.id, input: 'Start slowly' });
  run.sessionId = undefined; run.status = 'preparing';
  await assert.rejects(board.pause(run.id), /session has not started/);
  run.status = 'publishing'; await assert.rejects(board.pause(run.id), /publishing/);
});
