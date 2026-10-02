import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Storage } from '../src/storage.mjs';
import { formatBytes, purgeTargets } from '../src/storage-plan.mjs';
import { liveFixture, settle } from './live-double.mjs';

test('purge targets only finished tasks past the age cutoff, and worktree purges skip tasks without one', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const tasks = [
    { id: 'old', finished: true, worktree: true, lastActivityAt: '2026-09-01T00:00:00Z' },
    { id: 'recent', finished: true, worktree: true, lastActivityAt: '2026-09-30T12:00:00Z' },
    { id: 'running', finished: false, worktree: true, lastActivityAt: '2026-08-01T00:00:00Z' },
    { id: 'answer', finished: true, worktree: false, lastActivityAt: '2026-08-01T00:00:00Z' },
  ];
  assert.deepEqual(purgeTargets(tasks, { scope: 'worktrees' }, now).map(task => task.id), ['old', 'recent']);
  assert.deepEqual(purgeTargets(tasks, { scope: 'tasks', olderThanDays: 7 }, now).map(task => task.id), ['old', 'answer']);
  assert.equal(formatBytes(0), '0 B'); assert.equal(formatBytes(1500), '1.5 KB'); assert.equal(formatBytes(677e6), '677 MB');
});

test('usage attributes worktrees, evidence and logs to their task; deleting a task removes its files and records', async t => {
  const { live, engine, project, dir } = await liveFixture(t);
  const storage = new Storage(live), data = join(dir, 'data');
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  const next = await live.followup(run.id, { input: 'Once more' }); await settle(engine, next);
  mkdirSync(join(data, 'live-artifacts', next.id), { recursive: true }); writeFileSync(join(data, 'live-artifacts', next.id, 'shot.png'), Buffer.alloc(5000));
  engine.store.state.board.items[run.id] = { archivedAt: new Date().toISOString() };

  const usage = await storage.usage();
  const task = usage.tasks.find(item => item.id === run.id);
  assert.equal(usage.tasks.length, 1); assert.equal(task.latestId, next.id); assert.equal(task.finished, true); assert.equal(task.worktree, true);
  assert.ok(task.worktreeBytes > 0 && task.bytes > task.worktreeBytes);
  assert.deepEqual(new Set(usage.categories.map(item => item.id)), new Set(['worktrees', 'evidence', 'logs', 'records']));
  assert.equal(usage.totalBytes, usage.categories.reduce((sum, item) => sum + item.bytes, 0)); assert.ok(usage.freeBytes > 0);

  await storage.deleteTask(next.id);
  assert.equal(existsSync(run.workspace), false); assert.equal(existsSync(join(data, 'live-artifacts', next.id)), false); assert.equal(existsSync(live.steps.path(run.id)), false);
  assert.deepEqual(engine.runs, []); assert.equal(engine.store.state.board.items[run.id], undefined);
  await assert.rejects(storage.deleteTask(run.id), /Task not found/);
});

test('purging worktrees keeps task history, purging tasks removes it, and unfinished tasks are left alone', async t => {
  const { live, engine, project } = await liveFixture(t);
  const storage = new Storage(live);
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  await assert.rejects(storage.purge({ scope: 'everything' }), /Purge scope/);
  await assert.rejects(storage.purge({ scope: 'tasks', olderThanDays: 3 }), /Age must be/);
  assert.deepEqual(await storage.purge({ scope: 'worktrees', olderThanDays: 1 }), { removed: 0, failed: [] });
  assert.deepEqual(await storage.purge({ scope: 'worktrees' }), { removed: 1, failed: [] });
  assert.equal(existsSync(run.workspace), false); assert.ok(run.worktreeRemovedAt); assert.equal(engine.runs.length, 1);
  run.status = 'implementing';
  assert.deepEqual(await storage.purge({ scope: 'tasks' }), { removed: 0, failed: [] });
  await assert.rejects(storage.deleteTask(run.id), /Stop this task/);
  run.status = 'ready';
  assert.deepEqual(await storage.purge({ scope: 'tasks' }), { removed: 1, failed: [] });
  assert.deepEqual(engine.runs, []);
});
