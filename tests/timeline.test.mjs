import test from 'node:test';
import assert from 'node:assert/strict';
import { browserCaption, browserNarration, filterSteps, groupByTurn, hashStep, neighbour, ownSteps, phaseRows, phaseTitle, playableSteps, stepArtifacts, stepHash, stepTitle, timelinePhases } from '../web/lib/timeline.mjs';

const steps = ownSteps([
  { seq: 1, kind: 'status', status: 'queued', turn: { attempt: 0, role: 'worker' } },
  { seq: 2, kind: 'turn.start', turn: { attempt: 1, role: 'worker' } },
  { seq: 3, kind: 'tool.call', name: 'command', input: { command: 'npm test -- --grep balance' }, turn: { attempt: 1, role: 'worker' } },
  { seq: 4, kind: 'tool.result', callId: 'c', turn: { attempt: 1, role: 'worker' } },
  { seq: 5, kind: 'browser.step', tool: 'dispatch_browser_click', args: { ref: 'e12' }, screenshotAfter: 'shot-1', target: { x: 1, y: 1, width: 2, height: 2 }, turn: { attempt: 1, role: 'worker' } },
  { seq: 6, kind: 'browser.step', tool: 'dispatch_browser_type', args: { ref: 'e3', text: 'hello world this is long enough to clip' }, screenshotAfter: null, turn: { attempt: 1, role: 'worker' } },
  { seq: 7, kind: 'check.start', name: 'unit', turn: { attempt: 1, role: 'worker' } },
  { seq: 8, kind: 'check.end', name: 'unit', status: 'passed', artifactIds: ['trace-1'], turn: { attempt: 1, role: 'worker' } },
  { seq: 9, kind: 'turn.start', turn: { attempt: 1, role: 'reviewer' } },
], { id: 'run-2' }, 1);

test('grouping hides result and start halves, keeps turn order, and filters to browser steps', () => {
  const groups = groupByTurn(steps);
  assert.deepEqual(groups.map(group => [group.attempt, group.role, group.steps.length]), [[0, 'worker', 1], [1, 'worker', 5], [1, 'reviewer', 1]]);
  assert.ok(!groups.flatMap(group => group.steps).some(step => ['tool.result', 'check.start'].includes(step.kind)));
  assert.deepEqual(filterSteps(steps, { browserOnly: true }).map(step => step.seq), [5, 6]);
  assert.deepEqual(playableSteps(steps).map(step => step.seq), [5]);
});

test('timeline phases fold bookkeeping into outcomes, end on the final status and keep only matching rows when filtered', () => {
  const at = second => `2026-10-01T10:00:${String(second).padStart(2, '0')}Z`, worker = attempt => ({ attempt, role: 'worker' });
  const run = ownSteps([
    { seq: 1, at: at(0), kind: 'status', status: 'preparing', message: 'Checking the workspace.', turn: worker(0) },
    { seq: 2, at: at(1), kind: 'turn.start', turn: worker(1) },
    { seq: 3, at: at(2), kind: 'files', paths: ['a.txt'], turn: worker(1) },
    { seq: 4, at: at(3), kind: 'turn.end', outcome: 'completed', turn: worker(1) },
    { seq: 5, at: at(4), kind: 'patch', turn: worker(1) },
    { seq: 6, at: at(9), kind: 'check.end', name: 'unit', status: 'failed', turn: worker(1) },
    { seq: 7, at: at(10), kind: 'turn.start', turn: worker(2) },
    { seq: 8, at: at(12), kind: 'turn.end', outcome: 'completed', turn: worker(2) },
    { seq: 9, at: at(13), kind: 'status', status: 'failed', message: 'Repair allowance exhausted.', turn: worker(2) },
  ], { id: 'run-1' }, 0);
  const phases = timelinePhases(run);
  assert.deepEqual(phases.map(item => [item.type, item.type === 'end' ? item.status : phaseTitle(item), item.tone]), [['phase', 'Prepare', ''], ['phase', 'Attempt 1', 'failed'], ['phase', 'Repair 1', 'passed'], ['end', 'failed', 'failed']]);
  assert.equal(phases[0].note, 'Checking the workspace.');
  assert.deepEqual([phases[1].outcome, phases[1].durationMs], ['checks failed', 8000]);
  assert.deepEqual(phaseRows(phases).map(step => step.seq), [3, 6]);
  assert.equal(phases[3].message, 'Repair allowance exhausted.');
  assert.deepEqual(timelinePhases(run, { checksOnly: true }).map(item => [item.type, item.rows.map(step => step.seq)]), [['phase', [6]]]);
  assert.equal(phaseTitle({ attempt: 1, role: 'reviewer', runIndex: 1 }, true), 'Run 2 · Review');
});

test('neighbour clamps at the ends and titles stay short and specific', () => {
  const visible = filterSteps(steps);
  assert.equal(neighbour(visible, visible[0], -1).seq, 1); assert.equal(neighbour(visible, visible.at(-1), 1).seq, 9); assert.equal(neighbour(visible, null, 1).seq, 1); assert.equal(neighbour(visible, visible[1], 1).seq, 3);
  assert.equal(stepTitle(steps[4]), 'click e12'); assert.equal(stepTitle(steps[5]), 'type e3 “hello world this is lon…”');
  assert.equal(stepTitle(steps[2]), 'command npm test -- --grep balance'); assert.equal(stepTitle(steps[7]), 'Check unit · passed'); assert.equal(stepTitle(steps[8]), 'Reviewer turn 1 started');
  assert.equal(stepHash(steps[4], 'run-2'), '#step=5'); assert.equal(hashStep('#step=5', 'run-2'), 'run-2:5'); assert.equal(hashStep('', 'run-2'), null);
});

test('a follow-up timeline keeps earlier runs apart and links to their steps', () => {
  const earlier = ownSteps([{ seq: 5, kind: 'message', text: 'first', turn: { attempt: 1, role: 'worker' } }], { id: 'aaaa-1' }, 0);
  const merged = [...earlier, ...steps];
  assert.deepEqual(groupByTurn(merged).slice(0, 2).map(group => [group.runIndex, group.steps[0].key]), [[0, 'aaaa-1:5'], [1, 'run-2:1']]);
  assert.equal(neighbour(merged, earlier[0], 1).key, 'run-2:1');
  assert.equal(stepHash(earlier[0], 'run-2'), '#step=aaaa-1.5'); assert.equal(hashStep('#step=aaaa-1.5', 'run-2'), 'aaaa-1:5');
});

test('step artifacts resolve screenshots, check evidence and patches from the run', () => {
  const run = { artifacts: [{ id: 'shot-1', name: 'Browser step 1.jpg' }, { id: 'trace-1', name: 'trace.zip' }, { id: 'patch-1', name: 'turn-1.patch' }] };
  assert.deepEqual(stepArtifacts(steps[4], run).map(item => item.id), ['shot-1']);
  assert.deepEqual(stepArtifacts(steps[7], run).map(item => item.id), ['trace-1']);
  assert.deepEqual(stepArtifacts({ kind: 'patch', artifactId: 'patch-1' }, run).map(item => item.id), ['patch-1']);
  assert.deepEqual(stepArtifacts({ kind: 'tool.call', result: { imageArtifactIds: ['shot-1'] } }, run).map(item => item.id), ['shot-1']);
  assert.deepEqual(stepArtifacts({ kind: 'message' }, run), []);
});

test('browser captions name the element the agent acted on and the message that explains it', () => {
  assert.deepEqual(browserCaption({ tool: 'dispatch_browser_click', args: { ref: 'e12' }, target: { label: 'Send invite' } }), { verb: 'Click', object: 'Send invite' });
  assert.deepEqual(browserCaption(steps[4]), { verb: 'Click', object: 'e12' });
  assert.deepEqual(browserCaption({ tool: 'dispatch_browser_navigate', args: { url: 'http://localhost:5173/settings' } }), { verb: 'Open', object: 'localhost:5173/settings' });
  assert.deepEqual(browserCaption({ tool: 'dispatch_browser_type', args: { ref: 'e3', text: 'sam@example.com' }, target: { label: 'Email' } }), { verb: 'Type', object: 'Email “sam@example.com”' });
  assert.deepEqual(browserCaption({ tool: 'dispatch_browser_press', args: { truncated: true } }), { verb: 'Press', object: '' });
  const said = browserNarration([{ seq: 1, kind: 'browser.step' }, { seq: 2, kind: 'message', text: 'Opening the  invite dialog.' }, { seq: 3, kind: 'browser.step' }, { seq: 4, kind: 'browser.step' }]);
  assert.equal(said.get(1), ''); assert.equal(said.get(3), 'Opening the invite dialog.'); assert.equal(said.get(4), 'Opening the invite dialog.');
});

test('an accepted check reads as accepted, not failed, in its phase and in the checks filter', () => {
  const turn = { attempt: 1, role: 'worker' }, run = { id: 'r1' };
  const accepted = ownSteps([
    { seq: 1, kind: 'check.end', name: 'unit', status: 'failed', turn },
    { seq: 2, kind: 'check.accepted', name: 'unit', revision: 'tree1', turn },
  ], run, 0);
  const [phase] = timelinePhases(accepted);
  assert.deepEqual([phase.outcome, phase.tone], ['checks accepted', 'passed']);
  assert.equal(stepTitle(accepted[1]), 'Check unit · accepted, fails on the base commit too');
  assert.deepEqual(filterSteps(accepted, { checksOnly: true }).map(step => step.seq), [1, 2]);
  const other = ownSteps([{ seq: 1, kind: 'check.end', name: 'lint', status: 'failed', turn }, { seq: 2, kind: 'check.accepted', name: 'unit', turn }], run, 0);
  assert.equal(timelinePhases(other)[0].outcome, 'checks failed', 'accepting one check does not hide another failure');
});
