import test from 'node:test';
import assert from 'node:assert/strict';
import { analytics, runInsights } from '../src/analytics.mjs';
const run = { id: 'r', mode: 'live', status: 'ready', createdAt: '2026-09-29T10:00:00Z', startedAt: '2026-09-29T10:00:10Z', finishedAt: '2026-09-29T10:01:10Z', attempt: 2, checks: [{ durationMs: 2000 }], usage: { input: 100, cachedInput: 80, output: 20 } };
test('timings separate queue and execution; cached tokens are not counted twice', () => {
  const value = runInsights(run); assert.equal(value.queueMs, 10000); assert.equal(value.executionMs, 60000); assert.equal(value.elapsedMs, 70000); assert.equal(value.checkMs, 2000); assert.equal(value.repairs, 1);
  assert.deepEqual(value.tokens, { input: 100, cachedInput: 80, uncachedInput: 20, output: 20, total: 120 });
});
test('old, active, and incomplete runs preserve unknowns and use the supplied clock', () => {
  assert.equal(runInsights({ status: 'interrupted' }).executionMs, null);
  const active = runInsights({ ...run, status: 'implementing', finishedAt: null, usage: {} }, Date.parse('2026-09-29T10:00:30Z'));
  assert.equal(active.executionMs, 20000); assert.equal(active.tokens.total, null);
  assert.equal(runInsights({ ...run, usage: { input: -1, output: 5 } }).tokens.total, null);
});
test('admin totals report missing usage explicitly', () => {
  const value = analytics([run, { ...run, id: 'unknown', usage: {} }]);
  assert.equal(value.totalRuns, 2); assert.deepEqual(value.tokens, { reportedTotal: 120, knownRuns: 1, unknownRuns: 1 }); assert.equal(value.averageCompletionMs, 60000);
});
test('token totals are grouped by the provider that ran each task', () => {
  const value = analytics([run, { ...run, id: 'unknown', usage: {} }, { ...run, id: 'claude', execution: { provider: 'claude' }, usage: { input: 10, cachedInput: null, output: 3 } }, { ...run, id: 'demo', mode: 'demo' }]);
  assert.deepEqual(value.providers, { codex: { runs: 2, reportedRuns: 1, input: 100, cachedInput: 80, output: 20 }, claude: { runs: 1, reportedRuns: 1, input: 10, cachedInput: 0, output: 3 } });
});
test('phase timings stay unknown for runs that never recorded them and average only over reported values', () => {
  assert.deepEqual(runInsights(run).phases, { capabilitiesMs: null, worktreeMs: null, setupMs: null, lockWaitMs: null, publishMs: null, deliveryMs: null });
  const timed = { ...run, id: 'timed', timings: { capabilitiesMs: 80, worktreeMs: 120, setupMs: 2000, lockWaitMs: 0, publishMs: 300 } };
  assert.equal(runInsights(timed).phases.setupMs, 2000); assert.equal(runInsights(timed).phases.deliveryMs, null);
  const value = analytics([run, timed, { ...timed, id: 'later', timings: { ...timed.timings, setupMs: 4000 } }, { ...timed, id: 'blocked', status: 'blocked' }]);
  assert.equal(value.averagePhasesMs.setupMs, 3000); assert.equal(value.averagePhasesMs.lockWaitMs, 0); assert.equal(value.averagePhasesMs.deliveryMs, null);
});
test('worker timing and instruction sizes are recorded independently of provider tokens', () => {
  const measured = runInsights({ ...run, workerTurns: [{ durationMs: 1200, promptCharacters: 500 }, { durationMs: 800, promptCharacters: 200 }] });
  assert.equal(measured.workerMs, 2000); assert.equal(measured.promptCharacters, 700);
  assert.equal(runInsights(run).workerMs, null);
  assert.equal(runInsights({ ...run, workerTurns: [{ status: 'running', promptCharacters: 200 }] }).workerMs, null);
});
