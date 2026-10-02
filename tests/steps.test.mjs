import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StepLog, limits } from '../src/steps.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-steps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const saves = [];
  return { dir, saves, log: new StepLog(dir, { store: { saveSoon: () => saves.push(1) } }) };
}

test('steps get ids and sequence numbers, are bounded and redacted, and page by sequence', async t => {
  const { log, saves } = fixture(t);
  const run = { id: 'run-1', attempt: 1 };
  const first = log.append(run, { kind: 'turn.start', provider: 'codex', tools: [] });
  const second = log.append(run, { kind: 'tool.call', callId: 'c1', name: 'command', input: { command: 'echo sk-abcdefghijklmnop' } });
  log.append(run, { kind: 'tool.result', callId: 'c1', name: 'command', output: 'y'.repeat(100000), isError: false });
  assert.equal(first.seq, 1); assert.equal(second.seq, 2); assert.match(first.id, /^[0-9a-f-]{36}$/); assert.deepEqual(first.turn, { attempt: 1, role: 'worker' });
  assert.equal(second.input.command, 'echo [REDACTED]');
  assert.equal(run.stepCount, 3); assert.deepEqual(run.stepSummary, { total: 3, browser: 0, tools: 1, turns: 1, bytes: 0 }); assert.equal(saves.length, 3);
  const page = await log.read('run-1', { limit: 2 });
  assert.deepEqual(page.steps.map(step => step.seq), [1, 2]); assert.equal(page.next, 2); assert.equal(page.total, 3);
  const rest = await log.read('run-1', { after: 2 });
  assert.equal(rest.steps.length, 1); assert.equal(rest.next, null); assert.ok(rest.steps[0].output.length <= limits.output);
  assert.deepEqual(await log.read('missing'), { steps: [], next: null, total: 0 });
  assert.throws(() => log.append(run, { kind: 'wish' }), /Unknown step kind/);
});

test('the file cap records one overflow step and recovery appends an interrupted status once', t => {
  const { log, dir } = fixture(t);
  const run = { id: 'run-2', attempt: 1 };
  limits.file = 5000;
  t.after(() => { limits.file = 64_000_000; });
  for (let index = 0; index < 40; index++) log.append(run, { kind: 'message', text: 'm'.repeat(400) });
  const lines = readFileSync(join(dir, 'live-steps', 'run-2.jsonl'), 'utf8').trim().split('\n');
  assert.equal(JSON.parse(lines.at(-1)).kind, 'overflow'); assert.ok(statSync(join(dir, 'live-steps', 'run-2.jsonl')).size < 8000);
  assert.ok(run.stepCount < 40);
  const fresh = { id: 'run-3', attempt: 1 };
  log.append(fresh, { kind: 'turn.start', provider: 'codex' });
  log.recover([{ ...fresh, status: 'interrupted' }, { id: 'run-none', status: 'interrupted' }]);
  assert.equal(log.lastKind('run-3'), 'status');
  log.recover([{ ...fresh, status: 'interrupted', stepCount: 2 }]);
  assert.equal(readFileSync(join(dir, 'live-steps', 'run-3.jsonl'), 'utf8').trim().split('\n').length, 2);
});
