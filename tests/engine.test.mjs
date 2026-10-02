import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, maxQueueHoldSeconds } from '../src/engine.mjs';
import { LiveService } from '../src/live.mjs';
import { liveFixture, settle, until, gated, waitsForAbort, completes, workerDouble } from './live-double.mjs';

const ticket = (project, input) => ({ projectId: project.id, input });

test('slot limit keeps a second ticket queued until the first finishes', async t => {
  const gate = gated(), { engine, live, project } = await liveFixture(t, { concurrency: 1, behavior: gate.behavior });
  const first = await live.create(ticket(project, 'First ticket')), second = await live.create(ticket(project, 'Second ticket'));
  await until(() => first.status === 'implementing');
  assert.equal(second.status, 'queued'); assert.equal(engine.active.size, 1);
  gate.release(); await settle(engine, first); await settle(engine, second);
  assert.deepEqual([first.status, second.status], ['ready', 'ready']); assert.equal(second.handoff.simulated, false);
});
test('a follow-up takes the next live slot ahead of tickets queued before it', async t => {
  const gate = gated(), behavior = (options, call) => call === 2 ? gate.behavior(options) : completes(options);
  const { engine, live, project, adapter } = await liveFixture(t, { behavior });
  const finished = await live.create(ticket(project, 'Finished ticket')); await settle(engine, finished);
  const running = await live.create(ticket(project, 'Running ticket')), waiting = await live.create(ticket(project, 'Waiting ticket'));
  await until(() => running.status === 'implementing');
  const next = await live.followup(finished.id, { input: 'Merge it into main' });
  gate.release(); await settle(engine, running); await settle(engine, next); await settle(engine, waiting);
  assert.deepEqual(adapter.calls.map(call => call.workspace), [finished.workspace, running.workspace, finished.workspace, waiting.workspace]);
});
test('interrupting a running conversation hands its slot to the follow-up', async t => {
  const behavior = (options, call) => call === 1 ? waitsForAbort(options) : completes(options);
  const { engine, live, project, adapter } = await liveFixture(t, { behavior });
  const running = await live.create(ticket(project, 'Running ticket')), waiting = await live.create(ticket(project, 'Waiting ticket'));
  await until(() => running.status === 'implementing');
  const next = await live.interrupt(running.id, { input: 'Change of plan' });
  await settle(engine, next); await settle(engine, waiting);
  assert.deepEqual(adapter.calls.map(call => call.workspace), [running.workspace, running.workspace, waiting.workspace]);
  assert.equal(engine.holds, 0);
});
test('cancelling a queued run prevents work and cancelling an active run stops it without a handoff', async t => {
  const { engine, live, project, adapter } = await liveFixture(t, { concurrency: 1, behavior: waitsForAbort });
  const active = await live.create(ticket(project, 'Active ticket')), queued = await live.create(ticket(project, 'Queued ticket'));
  await until(() => active.status === 'implementing');
  engine.cancel(queued.id); await settle(engine, queued);
  assert.equal(queued.status, 'cancelled'); assert.equal(queued.startedAt, undefined);
  engine.cancel(active.id); await settle(engine, active);
  assert.equal(active.status, 'cancelled'); assert.equal(active.handoff, null); assert.equal(adapter.calls.length, 1);
  assert.throws(() => engine.cancel(active.id), error => error.status === 409);
});
test('restart marks unfinished runs interrupted and never replays them', async t => {
  const { engine, live, project, adapter } = await liveFixture(t, { behavior: waitsForAbort });
  const run = await live.create(ticket(project, 'Interrupted ticket'));
  await until(() => run.status === 'implementing');
  const recovered = new Engine({ dataDir: engine.dataDir }); t.after(() => recovered.shutdown());
  assert.equal(recovered.get(run.id).status, 'interrupted'); assert.equal(recovered.active.size, 0);
  assert.match(recovered.get(run.id).events.at(-1).message, /restarted/); assert.equal(adapter.calls.length, 1);
});
test('restart interrupts a question left pending on a run that already stopped', async t => {
  const { engine, live, project } = await liveFixture(t);
  const run = await live.create(ticket(project, 'Stopped with an open question')); await settle(engine, run);
  run.interactions.push({ id: 'left-open', kind: 'question', status: 'pending', questions: [] }); engine.store.save();
  const recovered = new Engine({ dataDir: engine.dataDir }); t.after(() => recovered.shutdown());
  assert.equal(recovered.get(run.id).status, run.status); assert.equal(recovered.get(run.id).interactions.at(-1).status, 'interrupted');
});
test('a restart keeps queued runs queued and starts them on the new server', async t => {
  const { engine, live, project } = await liveFixture(t, { concurrency: 1, behavior: waitsForAbort });
  const working = await live.create(ticket(project, 'Working ticket')), queued = await live.create(ticket(project, 'Queued ticket'));
  await until(() => working.status === 'implementing');
  await engine.shutdown();
  assert.deepEqual([working.status, queued.status], ['interrupted', 'queued']);
  const recovered = new Engine({ dataDir: engine.dataDir }), adapter = workerDouble(completes);
  new LiveService(recovered, { adapter }); t.after(() => recovered.shutdown());
  const run = recovered.get(queued.id);
  assert.equal(run.status, 'queued'); assert.match(run.events.at(-1).message, /Still queued/);
  recovered.pump(); await settle(recovered, run);
  assert.equal(run.status, 'ready'); assert.equal(adapter.calls.length, 1);
});
test('a queue hold lets working runs finish, starts nothing new, and lapses on its own', async t => {
  const gate = gated(), { engine, live, project } = await liveFixture(t, { concurrency: 1, behavior: gate.behavior });
  const working = await live.create(ticket(project, 'Working ticket')), queued = await live.create(ticket(project, 'Queued ticket'));
  await until(() => working.status === 'implementing');
  assert.deepEqual(engine.holdQueue(60).working, ['Working ticket']);
  gate.release(); await settle(engine, working);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(queued.status, 'queued'); assert.deepEqual(engine.holdQueue(1).working, []);
  await settle(engine, queued);
  assert.equal(queued.status, 'ready');
  assert.throws(() => engine.holdQueue(0), error => error.status === 400);
  assert.throws(() => engine.holdQueue(maxQueueHoldSeconds + 1), error => error.status === 400);
});
test('releasing a queue hold starts queued runs immediately', async t => {
  const { engine, live, project } = await liveFixture(t);
  engine.holdQueue(60);
  const queued = await live.create(ticket(project, 'Held ticket'));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(queued.status, 'queued');
  engine.releaseQueue(); await settle(engine, queued);
  assert.equal(queued.status, 'ready');
});
test('shutdown aborts active work and refuses new tickets', async t => {
  const { engine, live, project } = await liveFixture(t, { behavior: waitsForAbort });
  const run = await live.create(ticket(project, 'Shutdown ticket'));
  await until(() => run.status === 'implementing');
  await engine.shutdown();
  assert.equal(run.status, 'interrupted'); assert.equal(engine.active.size, 0); assert.equal(run.handoff, null);
  await assert.rejects(live.create(ticket(project, 'Late ticket')), error => error.status === 503);
});
test('duplicate active ticket rejected; a finished ticket can be dispatched again', async t => {
  const { engine, live, project } = await liveFixture(t);
  const run = await live.create(ticket(project, 'Same ticket'));
  await assert.rejects(live.create(ticket(project, 'Same ticket')), error => error.status === 409);
  await settle(engine, run); assert.equal(run.status, 'ready');
  const again = await live.create(ticket(project, 'Same ticket')); assert.notEqual(again.id, run.id);
  await settle(engine, again); assert.equal(again.status, 'ready');
});
test('a run without a live mode fails instead of executing', async t => {
  const { engine } = await liveFixture(t);
  const legacy = { id: 'legacy-1', mode: 'demo', status: 'queued', events: [], checks: [], artifacts: [], handoff: null };
  engine.runs.push(legacy); engine.pump(); await settle(engine, legacy);
  assert.equal(legacy.status, 'failed'); assert.match(legacy.events.at(-1).message, /Only live runs/);
});
test('tasks at a time defaults to one, persists, and a higher setting runs queued tickets together', async t => {
  const gate = gated(), { engine, live, project } = await liveFixture(t, { behavior: gate.behavior });
  assert.equal(engine.concurrency, 1);
  const first = await live.create(ticket(project, 'First parallel ticket')), second = await live.create(ticket(project, 'Second parallel ticket'));
  await until(() => first.status === 'implementing');
  assert.equal(second.status, 'queued');
  assert.throws(() => engine.setConcurrency(0), error => error.status === 400); assert.throws(() => engine.setConcurrency(5), error => error.status === 400);
  engine.setConcurrency(2);
  await until(() => second.status === 'implementing'); assert.equal(engine.active.size, 2);
  const restarted = new Engine({ dataDir: engine.dataDir }); t.after(() => restarted.shutdown()); assert.equal(restarted.concurrency, 2);
  gate.release(); await settle(engine, first); await settle(engine, second);
  assert.deepEqual([first.status, second.status], ['ready', 'ready']);
});
test('start now runs a queued ticket past the limit and only accepts queued runs', async t => {
  const gate = gated(), { engine, live, project } = await liveFixture(t, { behavior: gate.behavior });
  const first = await live.create(ticket(project, 'Running ticket')), second = await live.create(ticket(project, 'Early ticket'));
  await until(() => first.status === 'implementing');
  engine.startNow(second.id); engine.startNow(second.id);
  await until(() => second.status === 'implementing'); assert.equal(engine.active.size, 2);
  assert.ok(second.events.some(event => event.kind === 'start'));
  gate.release(); await settle(engine, first); await settle(engine, second);
  assert.deepEqual([first.status, second.status], ['ready', 'ready']);
  assert.throws(() => engine.startNow(first.id), error => error.status === 409);
});
