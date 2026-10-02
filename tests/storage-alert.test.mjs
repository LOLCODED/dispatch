import test from 'node:test';
import assert from 'node:assert/strict';
import { boardView } from '../src/board-state.mjs';
import { oldCompletedCount } from '../web/lib/storage-alert.mjs';

const now = Date.parse('2026-10-01T12:00:00Z');
const ago = hours => new Date(now - hours * 60 * 60 * 1000).toISOString();
const run = (id, extra = {}) => ({ id, mode: 'live', status: 'ready', createdAt: ago(24), finishedAt: ago(13), ...extra });
const done = (id, at = ago(13)) => ({ done: { runId: id, at } });

test('storage reminder counts completed tasks at the twelve-hour boundary', () => {
  const runs = [run('old'), run('boundary'), run('recent'), run('review'), run('active', { status: 'implementing' }), run('failed', { status: 'failed' })];
  const board = { items: { old: done('old'), boundary: done('boundary', ago(12)), recent: done('recent', ago(11)), active: done('active') } };
  assert.equal(oldCompletedCount(boardView({ runs, board }), now), 2);
});

test('storage reminder counts landed tasks but respects the latest completion time', () => {
  const runs = [run('landed', { worktreeRemovedAt: ago(12) }), run('recently-landed', { worktreeRemovedAt: ago(1) }), run('invalid', { finishedAt: undefined, worktreeRemovedAt: 'invalid' })];
  assert.equal(oldCompletedCount(boardView({ runs }), now), 1);
});

test('storage reminder counts conversations once and excludes reopened follow-ups', () => {
  const runs = [run('root', { supersededBy: 'next' }), run('next', { previousRunId: 'root' }), run('reopened', { supersededBy: 'working' }), run('working', { previousRunId: 'reopened', status: 'implementing' })];
  const board = { items: { root: done('next'), reopened: done('reopened') } };
  assert.equal(oldCompletedCount(boardView({ runs, board }), now), 1);
});
