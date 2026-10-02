import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeTiers, modelPreferenceKey, modelValue, nextTier, parseModelValue, selectExecution, tierList } from '../src/execution.mjs';
import { completes, liveFixture, settle, until, workerDouble } from './live-double.mjs';

const efforts = (...values) => values.map(reasoningEffort => ({ reasoningEffort }));
const catalog = [
  { provider: 'codex', model: 'light', isDefault: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: efforts('low', 'high') },
  { provider: 'codex', model: 'heavy', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: efforts('low', 'high') },
  { provider: 'claude', model: 'opus', defaultReasoningEffort: null, supportedReasoningEfforts: efforts('high') },
];
const tier = (provider, model, effort = null) => ({ provider, model, effort });

test('Auto starts on the first available tier and falls back to the provider default without tiers', () => {
  const tiers = [tier('codex', 'light'), tier('codex', 'heavy', 'high')];
  const first = selectExecution('auto', catalog, 'codex', { tiers });
  assert.deepEqual([first.provider, first.model, first.effort, first.mode], ['codex', 'light', 'low', 'auto']);
  assert.match(first.reason, /first tier/);
  const fallback = selectExecution('auto', catalog, 'codex', { tiers: [] });
  assert.deepEqual([fallback.model, fallback.effort], ['heavy', 'high']); assert.match(fallback.reason, /default reported by Codex/);
  assert.deepEqual(selectExecution('auto', catalog, 'codex'), fallback);
  assert.equal(selectExecution(tier('codex', 'heavy', 'low'), catalog, 'codex', { tiers }).mode, 'manual');
});

test('stale tier entries are dropped when the run is resolved and never escalated to', () => {
  const tiers = [tier('codex', 'retired'), tier('claude', 'opus', 'high'), tier('codex', 'light', 'high'), tier('codex', 'heavy', 'max')];
  assert.deepEqual(activeTiers(tiers, catalog), [tier('claude', 'opus', 'high'), tier('codex', 'light', 'high')]);
  assert.deepEqual(selectExecution('auto', catalog, 'codex', { tiers }).model, 'opus');
  assert.deepEqual(nextTier(tier('claude', 'opus', 'high'), tiers, catalog), tier('codex', 'light', 'high'));
  assert.equal(nextTier(tier('codex', 'light', 'high'), tiers, catalog), null);
  assert.equal(nextTier(tier('codex', 'heavy', 'high'), tiers, catalog), null);
  assert.deepEqual(selectExecution('auto', [], 'codex', { tiers }).model, null);
});

test('a learned model starts Auto only while it is still in the catalog', () => {
  const tiers = [tier('codex', 'light')];
  const learned = selectExecution('auto', catalog, 'codex', { tiers, learned: tier('claude', 'opus', 'high') });
  assert.deepEqual([learned.provider, learned.model, learned.mode], ['claude', 'opus', 'auto']); assert.match(learned.reason, /learned for this repository/);
  assert.equal(selectExecution('auto', catalog, 'codex', { tiers, learned: tier('codex', 'retired') }).model, 'light');
});

test('tier lists validate new entries, keep saved stale ones and reject duplicates', () => {
  const saved = tierList([tier('codex', 'light'), tier('codex', 'heavy', 'high')], catalog);
  assert.deepEqual(saved, [tier('codex', 'light', 'low'), tier('codex', 'heavy', 'high')]);
  const stale = [tier('codex', 'retired', 'low')];
  assert.deepEqual(tierList([...stale, tier('codex', 'light')], catalog, stale), [tier('codex', 'retired', 'low'), tier('codex', 'light', 'low')]);
  assert.throws(() => tierList([tier('codex', 'retired')], catalog), /unavailable/);
  assert.throws(() => tierList([tier('codex', 'light'), tier('codex', 'light', 'low')], catalog), /different model/);
  assert.throws(() => tierList([tier('codex', 'light', 'max')], catalog), /reasoning level/);
  for (const value of [null, 'light', [null], [{ provider: 'other', model: 'x' }], Array(9).fill(tier('codex', 'light'))]) assert.throws(() => tierList(value, catalog));
});

test('model preference values round-trip provider, model and effort', () => {
  assert.equal(modelValue(tier('codex', 'light', 'low')), 'codex/light@low');
  assert.equal(modelValue(tier('claude', 'opus')), 'claude/opus');
  assert.deepEqual(parseModelValue('codex/gpt-6.1-sol@high'), tier('codex', 'gpt-6.1-sol', 'high'));
  assert.deepEqual(parseModelValue('claude/opus'), tier('claude', 'opus'));
  for (const value of [undefined, '', 'codex', 'codex/', '/light', 'codex/light@', 'Codex/light']) assert.equal(parseModelValue(value), null);
});

const codexModels = catalog.filter(model => model.provider === 'codex').map(({ provider, ...model }) => model);
async function tieredFixture(t, behavior, { claude = null, modelSwitch = true, tiers = [tier('codex', 'light'), tier('codex', 'heavy', 'high')] } = {}) {
  const claudeAdapter = claude && { ...workerDouble(claude), models: async () => ({ available: true, message: 'Claude double', models: [{ model: 'opus', defaultReasoningEffort: null, supportedReasoningEfforts: efforts('high') }] }) };
  const fixture = await liveFixture(t, { behavior, services: claudeAdapter ? { adapters: { claude: claudeAdapter } } : {} });
  fixture.adapter.models = async () => ({ available: true, message: 'Codex double', models: codexModels });
  if (modelSwitch) fixture.adapter.contract = { sessions: true, modelSwitch: true };
  if (claudeAdapter) { claudeAdapter.contract = { sessions: true, modelSwitch: true }; fixture.live.providers.setEnabled('claude', true); }
  await fixture.live.refreshModels();
  fixture.live.setAutoTiers({ tiers });
  return { ...fixture, claude: claudeAdapter };
}
const writes = values => (options, turn) => { writeFileSync(join(options.workspace, 'value.txt'), values[turn - 1] ?? 'bad'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Done' }; };
const turnModels = adapter => adapter.calls.filter(call => !call.readOnly).map(call => `${call.execution.model}@${call.execution.effort}`);

test('escalation runs exactly one extra attempt on the next tier, resuming the same session', async t => {
  const { live, engine, project, adapter } = await tieredFixture(t, writes([]), { tiers: [tier('codex', 'light'), tier('codex', 'heavy', 'low'), tier('codex', 'heavy', 'high')] });
  const run = await live.create({ projectId: project.id, input: 'Always fails' }); await settle(engine, run);
  assert.equal(run.status, 'failed'); assert.match(run.events.at(-1).message, /including one escalation/);
  assert.deepEqual(turnModels(adapter), ['light@low', 'light@low', 'heavy@low']);
  assert.deepEqual(adapter.calls.map(call => call.sessionId), [null, 'session-1', 'session-1']);
  assert.deepEqual([run.attempt, run.execution.model, run.execution.mode], [3, 'heavy', 'auto']); assert.match(run.execution.reason, /Auto escalated from Codex light · low after 1 repair: check unit still failed/);
  assert.deepEqual([run.escalation.from, run.escalation.to, run.escalation.change], ['Codex light · low', 'Codex heavy · low', 'escalation']);
  assert.match(run.events.find(event => event.kind === 'model').message, /Escalated from Codex light · low to Codex heavy · low in the same session/);
  const { steps } = await live.steps.read(run.id);
  assert.deepEqual(steps.filter(step => step.kind === 'model').map(step => [step.change, step.from, step.to, step.fresh]), [['escalation', 'Codex light · low', 'Codex heavy · low', false]]);
  assert.equal(live.brain.lookup({ key: modelPreferenceKey, projectId: project.id }), null);
});

test('an escalation that produces a ready result is remembered for the repository', async t => {
  const { live, engine, project } = await tieredFixture(t, writes(['bad', 'bad', 'changed']));
  const run = await live.create({ projectId: project.id, input: 'Needs the heavy model' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events)); assert.equal(run.execution.model, 'heavy');
  const entry = live.brain.lookup({ key: modelPreferenceKey, projectId: project.id });
  assert.deepEqual([entry.value, entry.source, entry.origin.via, entry.mode, entry.answers.length], ['codex/heavy@high', 'observed', 'escalation', 'ask', 1]);
});

test('manual runs, runs without tiers and the last tier never escalate', async t => {
  const { live, engine, project, adapter } = await tieredFixture(t, writes([]));
  const manual = await live.create({ projectId: project.id, input: 'Manual run', execution: tier('codex', 'light', 'low') }); await settle(engine, manual);
  assert.deepEqual([manual.status, manual.attempt, manual.escalation], ['failed', 2, undefined]);
  live.setAutoTiers({ tiers: [tier('codex', 'heavy', 'high')] });
  const last = await live.create({ projectId: project.id, input: 'Last tier' }); await settle(engine, last);
  assert.deepEqual([last.status, last.attempt, last.execution.model], ['failed', 2, 'heavy']);
  live.setAutoTiers({ tiers: [] });
  const none = await live.create({ projectId: project.id, input: 'No tiers' }); await settle(engine, none);
  assert.deepEqual([none.status, none.attempt, none.execution.model], ['failed', 2, 'heavy']); assert.match(none.execution.reason, /default reported/);
  assert.equal(adapter.calls.length, 6);
});

test('escalating to another provider starts a fresh session with the ticket, diff summary and last failure', async t => {
  const { live, engine, project, adapter, claude } = await tieredFixture(t, writes([]), { claude: writes(['changed']), tiers: [tier('codex', 'light'), tier('claude', 'opus', 'high')] });
  const run = await live.create({ projectId: project.id, input: 'Hand it over' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events));
  assert.equal(adapter.calls.length, 2); assert.equal(claude.calls.length, 1);
  const [handover] = claude.calls;
  assert.equal(handover.sessionId, null); assert.deepEqual(handover.execution, { ...tier('claude', 'opus', 'high'), mode: 'auto', reason: run.execution.reason });
  assert.match(handover.prompt, /TICKET:\nHand it over/); assert.match(handover.prompt, /fresh session/);
  assert.match(handover.prompt, /CURRENT DIFF SUMMARY:\n value.txt \| 2/); assert.match(handover.prompt, /LAST FAILURE:\nRepair this failing mandatory check/);
  assert.deepEqual([run.provider, run.sessionId], ['claude', 'session-1']);
  assert.match(run.events.find(event => event.kind === 'model').message, /to Claude Code opus · high in a fresh session/);
});

test('an adapter that cannot switch models inside a session gets a fresh session on the same provider', async t => {
  const { live, engine, project, adapter } = await tieredFixture(t, writes(['bad', 'bad', 'changed']), { modelSwitch: false });
  const run = await live.create({ projectId: project.id, input: 'Fresh on the same provider' }); await settle(engine, run);
  assert.equal(run.status, 'ready');
  assert.deepEqual(adapter.calls.map(call => call.sessionId), [null, 'session-1', null]);
  assert.match(adapter.calls[2].prompt, /CURRENT DIFF SUMMARY/);
});

test('cancelling during the escalation attempt ends cancelled without publication', async t => {
  let release;
  const behavior = async (options, turn) => {
    if (turn < 3) return writes([])(options, turn);
    await new Promise(resolve => { release = resolve; options.signal.addEventListener('abort', resolve, { once: true }); });
    return { outcome: 'cancelled' };
  };
  const { live, engine, project } = await tieredFixture(t, behavior);
  const run = await live.create({ projectId: project.id, input: 'Cancel the escalation' });
  await until(() => run.attempt === 3 && release);
  engine.cancel(run.id); await settle(engine, run);
  assert.deepEqual([run.status, run.handoff], ['cancelled', null]);
});

test('operator picks climb the Brain ladder: suggest after two, Auto starts there after four', async t => {
  const { live, engine, project } = await tieredFixture(t, completes);
  const pick = tier('codex', 'heavy', 'low');
  for (let index = 0; index < 4; index++) {
    const run = await live.create({ projectId: project.id, input: `Manual pick ${index}`, execution: pick }); await settle(engine, run);
    if (index === 1) assert.deepEqual(live.modelSuggestions()[project.id], { ...pick, mode: 'suggest' });
  }
  const entry = live.brain.lookup({ key: modelPreferenceKey, projectId: project.id });
  assert.deepEqual([entry.value, entry.source, entry.origin.via, entry.mode, entry.scope], ['codex/heavy@low', 'operator', 'composer', 'auto', `project:${project.id}`]);
  const auto = await live.create({ projectId: project.id, input: 'Auto after learning' }); await settle(engine, auto);
  assert.deepEqual([auto.execution.model, auto.execution.effort, auto.execution.mode], ['heavy', 'low', 'auto']); assert.match(auto.execution.reason, /learned/);
  assert.equal(live.brain.find(entry.id).uses, 1);
  live.brain.setMode(entry.id, 'suggest');
  const pinned = await live.create({ projectId: project.id, input: 'Pinned to suggest' }); await settle(engine, pinned);
  assert.equal(pinned.execution.model, 'light');
  live.brain.setEnabled(entry.id, false);
  assert.equal(live.modelSuggestions()[project.id], undefined);
});

test('a switch on a stopped run applies to the follow-up, makes it manual and is remembered', async t => {
  const { live, engine, project, adapter, claude } = await tieredFixture(t, completes, { claude: completes });
  const run = await live.create({ projectId: project.id, input: 'Switch me' }); await settle(engine, run);
  assert.equal(run.execution.model, 'light');
  live.switchModel(run.id, tier('codex', 'heavy', 'high'));
  assert.deepEqual([run.execution.model, run.nextExecution.model], ['light', 'heavy']);
  const same = await live.followup(run.id, { input: 'Again, heavier' }); await settle(engine, same);
  assert.deepEqual([same.status, same.execution.model, same.execution.mode, same.sessionId, run.nextExecution], ['ready', 'heavy', 'manual', 'session-1', undefined]);
  assert.equal(adapter.calls.at(-1).sessionId, 'session-1'); assert.equal(adapter.calls.at(-1).execution.model, 'heavy');
  live.switchModel(same.id, tier('claude', 'opus', 'high'));
  const other = await live.followup(same.id, { input: 'Now on Claude' }); await settle(engine, other);
  assert.deepEqual([other.status, other.provider, claude.calls.length, claude.calls[0].sessionId], ['ready', 'claude', 1, null]);
  assert.match(claude.calls[0].prompt, /TICKET:\nSwitch me[\s\S]*LATEST FOLLOW-UP:\nNow on Claude[\s\S]*CURRENT DIFF SUMMARY/);
  const entry = live.brain.lookup({ key: modelPreferenceKey, projectId: project.id });
  assert.deepEqual([entry.value, entry.origin.via, entry.answers.length], ['claude/opus@high', 'switch', 2]);
  assert.throws(() => live.switchModel(run.id, tier('codex', 'light')), /cannot continue/);
});

test('a switch during a running turn waits for the repair turn and stops escalation', async t => {
  let release;
  const behavior = async (options, turn) => { if (turn === 1) await new Promise(resolve => { release = resolve; }); return writes(['bad', 'bad'])(options, turn); };
  const { live, engine, project, adapter } = await tieredFixture(t, behavior);
  const run = await live.create({ projectId: project.id, input: 'Switch mid-run' });
  await until(() => release);
  live.switchModel(run.id, tier('codex', 'light', 'high'));
  assert.equal(adapter.calls.length, 1); release();
  await settle(engine, run);
  assert.deepEqual(turnModels(adapter), ['light@low', 'light@high']);
  assert.deepEqual([run.status, run.execution.mode, run.escalation], ['failed', 'manual', undefined]);
});
