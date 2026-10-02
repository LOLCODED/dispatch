import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readModels, readRateLimits } from '../src/codex-models.mjs';
import { claudeLimits, claudeUsageText, codexLimits, windowLabel } from '../src/provider-limits.mjs';
import { modelChoice, selectExecution } from '../src/execution.mjs';

const models = [
  { provider: 'codex', model: 'test-sol', displayName: 'Test Sol', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] },
  { provider: 'codex', model: 'test-luna', displayName: 'Test Luna', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
];
const choice = (model, effort) => ({ provider: 'codex', model, effort });
test('Auto uses the reported default model and effort without inventing model names', () => {
  const auto = selectExecution('auto', models);
  assert.deepEqual([auto.provider, auto.model, auto.effort, auto.mode], ['codex', 'test-sol', 'high', 'auto']);
  assert.deepEqual(selectExecution(undefined, models), auto);
  const fallback = selectExecution(undefined, []);
  assert.deepEqual([fallback.model, fallback.effort, fallback.mode], [null, null, 'auto']); assert.match(fallback.reason, /CLI defaults/);
  const manual = selectExecution(choice('test-sol', 'low'), models);
  assert.equal(manual.mode, 'manual'); assert.equal(manual.effort, 'low');
});
test('unavailable harnesses, models, and reasoning efforts fail closed', () => {
  for (const value of [{ provider: 'claude', model: 'test-sol' }, choice('unknown', 'low'), choice('test-luna', 'high'), choice('--unsafe', 'low')]) assert.throws(() => modelChoice(value, models));
  for (const value of [null, false, [], 'unknown']) assert.throws(() => selectExecution(value, models));
});
test('choices are keyed by provider so identical model names never cross harnesses', () => {
  const catalog = [...models, { provider: 'claude', model: 'opus', displayName: 'Opus', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }, { provider: 'claude', model: 'haiku', displayName: 'Haiku', supportedReasoningEfforts: [] }];
  assert.deepEqual(modelChoice({ provider: 'claude', model: 'opus', effort: 'high' }, catalog), { provider: 'claude', model: 'opus', effort: 'high' });
  assert.deepEqual(modelChoice({ provider: 'claude', model: 'haiku' }, catalog), { provider: 'claude', model: 'haiku', effort: null });
  assert.throws(() => modelChoice({ provider: 'claude', model: 'haiku', effort: 'high' }, catalog), /reasoning level/);
  assert.throws(() => modelChoice({ provider: 'claude', model: 'test-sol' }, catalog), /unavailable/);
  assert.throws(() => modelChoice({ provider: 'unknown', model: 'auto' }, catalog), /enabled provider/);
  const fallback = selectExecution('auto', catalog, 'claude');
  assert.deepEqual([fallback.provider, fallback.model], ['claude', null]); assert.match(fallback.reason, /Claude Code CLI defaults/);
});
function rpcDouble(reply, seen) {
  return (command, args, options) => {
    assert.equal(command, 'codex'); assert.deepEqual(args, ['app-server', '--listen', 'stdio://']); assert.equal(options.env.OPENAI_API_KEY, undefined);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('close')); };
    child.stdin.on('data', chunk => {
      const message = JSON.parse(chunk.toString()); seen.push(message);
      const result = message.id === 1 ? { result: {} } : reply(message);
      if (message.id && result) queueMicrotask(() => {
        const bytes = Buffer.from(JSON.stringify({ id: message.id, ...result }) + '\n');
        for (let i = 0; i < bytes.length; i += 7) child.stdout.write(bytes.subarray(i, i + 7));
      });
    }); return child;
  };
}
test('model discovery reads paginated, fragmented RPC results without starting a model turn', async () => {
  const seen = [];
  const result = await readModels({ spawnProcess: rpcDouble(message => ({ result: message.params?.cursor ? { data: [models[1]], nextCursor: null } : { data: [models[0], { ...models[1], hidden: true }], nextCursor: 'page-2' } }), seen) });
  assert.equal(result.available, true); assert.deepEqual(result.models.map(m => m.model), ['test-sol', 'test-luna']);
  assert.deepEqual(seen.map(m => m.method), ['initialize', 'initialized', 'model/list', 'model/list']);
  assert.equal(seen[3].params.cursor, 'page-2');
});
test('discovery hides diagnostics, bounds pagination, and times out without a model fallback', async () => {
  const failed = await readModels({ spawnProcess: rpcDouble(() => ({ error: { message: 'secret diagnostic' } }), []) });
  assert.equal(failed.available, false); assert.deepEqual(failed.models, []); assert.doesNotMatch(failed.message, /secret/);
  const repeated = await readModels({ spawnProcess: rpcDouble(() => ({ result: { data: models, nextCursor: 'same' } }), []) });
  assert.equal(repeated.available, false);
  const timedOut = await readModels({ spawnProcess: rpcDouble(() => null, []), timeoutMs: 10 });
  assert.equal(timedOut.available, false);
});
test('plan usage is a read-only account query, normalized per window, and fails closed', async () => {
  const seen = [], rateLimits = { primary: { usedPercent: 51, windowDurationMins: 10080, resetsAt: 1791071335 }, secondary: { usedPercent: 140, windowDurationMins: 300, resetsAt: null }, planType: 'prolite', rateLimitReachedType: null };
  const result = await readRateLimits({ spawnProcess: rpcDouble(() => ({ result: { rateLimits } }), seen) });
  assert.deepEqual(seen.map(m => m.method), ['initialize', 'initialized', 'account/rateLimits/read']);
  assert.deepEqual([result.available, result.source, result.plan, result.limited], [true, 'live', 'prolite', false]);
  assert.deepEqual(result.windows, [{ label: 'Weekly', usedPercent: 51, resetsAt: '2026-10-03T23:48:55.000Z' }, { label: '5-hour', usedPercent: 100, resetsAt: null }]);
  const failed = await readRateLimits({ spawnProcess: rpcDouble(() => ({ error: { message: 'secret diagnostic' } }), []) });
  assert.equal(failed.available, false); assert.doesNotMatch(failed.message, /secret/);
  assert.equal(codexLimits({ primary: null, planType: '<script>' }).available, false); assert.equal(codexLimits({ planType: '<script>' }).plan, null);
});
test('Claude limit events become percent windows and unknown windows are dropped', () => {
  const limits = claudeLimits({ status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.254, resetsAt: 1790783400 }, seven_day: { utilization: 0.1 }, seven_day_opus: { utilization: 1 }, monthly_other: { utilization: 0.5 } } });
  assert.deepEqual(limits.windows.map(window => [window.label, window.usedPercent]), [['5-hour', 25], ['Weekly', 10], ['Weekly · Opus', 100]]);
  assert.deepEqual([limits.source, limits.limited], ['observed', false]);
  assert.equal(claudeLimits({ status: 'rejected' }).available, false); assert.equal(claudeLimits({ status: 'rejected' }).limited, true);
  assert.deepEqual([60, 1440, 90].map(windowLabel), ['1-hour', '1-day', '90-minute']);
});
test('Claude /usage text becomes percent windows with the CLI reset text and nothing else', () => {
  const report = claudeUsageText('You are using your subscription\n\nCurrent session: 1% used · resets Sep 30, 1:20pm (America/St_Johns)\nCurrent week (all models): 100% used · resets Oct 5, 6:30am (America/St_Johns)\nCurrent week (Fable): 16% used\n\nLast 24h · 1628 requests\n  71% of your usage came from subagent-heavy sessions');
  assert.deepEqual(report.windows, [
    { label: 'Current session', usedPercent: 1, resetsAt: null, resetsText: 'Resets Sep 30, 1:20pm (America/St_Johns)' },
    { label: 'Current week (all models)', usedPercent: 100, resetsAt: null, resetsText: 'Resets Oct 5, 6:30am (America/St_Johns)' },
    { label: 'Current week (Fable)', usedPercent: 16, resetsAt: null, resetsText: null }]);
  assert.equal(report.limited, true);
  assert.equal(claudeUsageText('Not logged in').available, false);
});
