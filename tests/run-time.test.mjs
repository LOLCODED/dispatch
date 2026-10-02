import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationElapsed, runDurations, runElapsed } from '../web/lib/run-time.mjs';
import { boardView } from '../src/board-state.mjs';
const first = { id: 'a', startedAt: '2026-09-29T10:00:00Z', insights: { executionMs: 60000 } };
const second = { id: 'b', startedAt: '2026-09-29T10:05:00Z', insights: { executionMs: 30000 } };
const current = { id: 'c', startedAt: '2026-09-29T10:10:00Z', finishedAt: '2026-09-29T10:12:00Z', insights: { executionMs: 120000 } };
const now = Date.parse('2026-09-29T10:11:00Z');
test('the header timer counts from the first run of a follow-up chain', () => {
  assert.equal(conversationElapsed(current, [second, first], false, now), 11 * 60000);
  assert.equal(conversationElapsed(current, [second, first], true, now), 12 * 60000);
  assert.equal(conversationElapsed(current, [], false, now), 60000);
  assert.equal(conversationElapsed(current, [], true, now), 120000);
});
test('each run reports its own duration, oldest first', () => {
  assert.deepEqual(runDurations(current, [second, first], false, now), [{ id: 'a', label: 'Run 1', ms: 60000 }, { id: 'b', label: 'Run 2', ms: 30000 }, { id: 'c', label: 'Run 3', ms: 60000 }]);
  assert.equal(runElapsed({ insights: {} }, false, now), null);
});
test('a board entry for a follow-up chain reports when its first run started', () => {
  const runs = [
    { id: 'c2', status: 'implementing', title: 'c', previousRunId: 'c1', createdAt: '2026-09-30T12:00:00Z', startedAt: '2026-09-30T12:00:05Z' },
    { id: 'c1', status: 'ready', title: 'c', supersededBy: 'c2', createdAt: '2026-09-30T11:00:00Z', startedAt: '2026-09-30T11:00:05Z' },
  ];
  assert.equal(boardView({ runs }).active[0].startedAt, '2026-09-30T11:00:05Z');
});
