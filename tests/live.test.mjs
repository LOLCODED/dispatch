import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { Engine } from '../src/engine.mjs';
import { LiveService } from '../src/live.mjs';
import { git, plainText } from '../src/local-tools.mjs';
import { exampleTracker, issueUrl, parseIssueRef } from './tracker-double.mjs';
import { completesWithFiles, liveFixture, settle, until } from './live-double.mjs';
import { Tasks } from '../src/tasks.mjs';
import { taskState } from '../src/board-state.mjs';
const fixture = (t, behavior, tracker = exampleTracker()) => liveFixture(t, { behavior: behavior ?? completesWithFiles, services: { connectors: [tracker.connector] } });
test('live worktree preserves dirty checkout, commits new files and resumes follow-up session', async t => {
  const { live, engine, project, repo } = await fixture(t);
  writeFileSync(join(repo, 'value.txt'), 'my uncommitted work');
  const run = await live.create({ projectId: project.id, input: 'Change the value' });
  await settle(engine, run); assert.equal(run.status, 'ready', JSON.stringify(run.events)); assert.equal(run.handoff.simulated, false);
  assert.equal(readFileSync(join(repo, 'value.txt'), 'utf8'), 'my uncommitted work'); assert.equal(await git(repo, ['branch', '--show-current']), 'main');
  assert.match((await live.diff(run.id)).diff, /new.txt/); assert.equal(await git(run.workspace, ['rev-parse', 'HEAD^{tree}']), run.revision);
  const next = await live.followup(run.id, { input: 'Check the result again' }); await settle(engine, next);
  assert.equal(next.status, 'ready'); assert.equal(next.sessionId, run.sessionId); assert.equal(next.workspace, run.workspace); assert.equal(run.supersededBy, next.id);
  assert.equal(next.headSha, run.headSha); assert.deepEqual(next.checks.map(check => [check.status, check.durationMs, check.reusedFrom?.runId]), [['passed', 0, run.id]]); assert.match(next.checks[0].output, /^Reused: unit passed at .* \(run [0-9a-f]{8}, attempt 1\)/);
  await assert.rejects(live.followup(run.id, { input: 'Old continuation' }), /most recent/);
});
test('repair remains bounded and resumes the exact session', async t => {
  const seen = [], choices = [];
  const { live, engine, project } = await fixture(t, async (options, turn) => { seen.push(options.sessionId); choices.push(options.execution); writeFileSync(join(options.workspace, 'value.txt'), turn === 1 ? 'bad' : 'changed'); return { outcome: 'completed', sessionId: 'session-1' }; });
  live.adapter.models = async () => ({ available: true, models: [{ model: 'test-sol', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] });
  await live.refreshModels();
  const run = await live.create({ projectId: project.id, input: 'Repair this', execution: { provider: 'codex', model: 'test-sol', effort: 'high' } }); await settle(engine, run);
  assert.equal(run.status, 'ready'); assert.equal(run.attempt, 2); assert.deepEqual(seen, [null, 'session-1']); assert.deepEqual(run.checks.map(c => c.status), ['failed', 'passed']);
  assert.deepEqual(choices.map(choice => [choice.model, choice.effort]), [['test-sol', 'high'], ['test-sol', 'high']]);
});
test('check scopes decide from the diff: matched scopes skip the rest, unmatched files run everything', async t => {
  const files = ['NOTES.md', 'value.txt', 'web/copy/en.json', 'NOTES.md'];
  const { live, engine, project } = await fixture(t, async (options, turn) => { const file = join(options.workspace, files[turn - 1]); mkdirSync(join(options.workspace, 'web/copy'), { recursive: true }); writeFileSync(file, 'changed'); if (turn === 3) writeFileSync(join(options.workspace, 'NOTES.md'), 'changed too'); return { outcome: 'completed', sessionId: 'session-1' }; });
  const lint = { id: 'lint', command: process.execPath, args: ['-e', ''] };
  const rules = await live.saveProject({ ...project, confirmed: true, validation: [lint, ...project.validation], textOnly: { paths: ['*.md'], checks: ['lint'] } }, project.id);
  assert.deepEqual(rules.checkScopes, [{ id: 'text-only', paths: ['*.md'], checks: ['lint'] }]); assert.equal(rules.textOnly, undefined);
  const text = await live.create({ projectId: project.id, input: 'Fix a typo in the notes' }); await settle(engine, text);
  assert.equal(text.status, 'ready', JSON.stringify(text.events)); assert.deepEqual(text.checks.map(check => [check.name, check.status]), [['unit', 'skipped'], ['lint', 'passed']]);
  assert.match(text.checks[0].output, /scope text-only \(\*\.md\), which requires lint/);
  const code = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, code);
  assert.equal(code.status, 'ready'); assert.deepEqual(code.checks.map(check => [check.name, check.status]), [['lint', 'passed'], ['unit', 'passed']]);
  const scoped = await live.saveProject({ ...rules, confirmed: true, checkScopes: [...rules.checkScopes, { id: 'copy', paths: ['web/copy/*.json'], checks: [] }] }, project.id);
  assert.deepEqual(scoped.checkScopes.map(scope => scope.id), ['text-only', 'copy']);
  const mixed = await live.create({ projectId: project.id, input: 'Update copy and notes' }); await settle(engine, mixed);
  assert.equal(mixed.status, 'ready', JSON.stringify(mixed.events)); assert.deepEqual(mixed.checks.map(check => [check.name, check.status]), [['unit', 'skipped'], ['lint', 'passed']]);
  assert.match(mixed.checks[0].output, /scopes text-only \(\*\.md\); copy \(web\/copy\/\*\.json\), which require lint/);
  assert.deepEqual((await live.saveProject({ ...scoped, confirmed: true }, project.id)).checkScopes, scoped.checkScopes);
});
test('a turn that changes nothing ends blocked before any check runs', async t => {
  const { live, engine, project } = await fixture(t, async (options, turn) => { if (turn === 2) writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: turn === 1 ? 'Wrote the app to ~/elsewhere' : 'Done' }; });
  const run = await live.create({ projectId: project.id, input: 'Build something' }); await settle(engine, run);
  assert.equal(run.status, 'blocked'); assert.deepEqual(run.checks, []); assert.equal(run.handoff, null); assert.equal(run.question, undefined);
  assert.match(run.events.at(-1).message, /No changes in the worktree/);
  const next = await live.followup(run.id, { input: 'Put it in this repository' }); await settle(engine, next);
  assert.equal(next.status, 'ready', JSON.stringify(next.events)); assert.deepEqual(next.checks.map(check => check.status), ['passed']);
});
test('the worker decides a ticket is a question: no diff plus the answered marker ends ready with no checks, and a follow-up can still change code', async t => {
  const prompts = [];
  const { live, engine, project } = await fixture(t, async (options, turn) => { prompts.push(options.prompt); if (turn === 2) writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: turn === 1 ? 'The value lives in value.txt:1.\nDISPATCH_ANSWERED' : 'Changed it.' }; });
  const run = await live.create({ projectId: project.id, input: 'Where is the value stored?' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events)); assert.equal(run.kind, 'change'); assert.equal(run.answered, true); assert.deepEqual(run.checks, []); assert.equal(run.handoff, null);
  assert.match(prompts[0], /only asks a question, answer it without editing files[\s\S]*DISPATCH_ANSWERED on its own line/); assert.match(run.events.at(-1).message, /Answer ready/);
  const next = await live.followup(run.id, { input: 'Now change it' }); await settle(engine, next);
  assert.equal(next.status, 'ready', JSON.stringify(next.events)); assert.equal(next.answered, undefined); assert.equal(next.sessionId, run.sessionId); assert.deepEqual(next.checks.map(check => check.status), ['passed']);
});
test('a plan with no diff waits for approval instead of ending ready, and approving it implements the plan', async t => {
  const prompts = [];
  const { live, engine, project } = await fixture(t, async (options, turn) => { prompts.push(options.prompt); if (turn === 2) writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: turn === 1 ? 'Plan: change value.txt.\nDISPATCH_PLAN' : 'Changed it.' }; });
  const run = await live.create({ projectId: project.id, input: 'Plan how to change the value' }); await settle(engine, run);
  assert.equal(run.status, 'blocked', JSON.stringify(run.events)); assert.equal(run.plan, true); assert.equal(run.answered, undefined); assert.deepEqual(run.checks, []); assert.equal(run.handoff, null);
  assert.match(prompts[0], /asks for a plan, write it without editing files and end with DISPATCH_PLAN/); assert.match(run.events.at(-1).message, /Plan ready/);
  const next = await live.followup(run.id, { input: 'Implement the plan' }); await settle(engine, next);
  assert.equal(next.status, 'ready', JSON.stringify(next.events)); assert.equal(next.plan, undefined); assert.equal(next.sessionId, run.sessionId); assert.deepEqual(next.checks.map(check => check.status), ['passed']);
});
test('unbuilt work keeps the tested result but needs a decision, and moving it to a new task returns the run to review', async t => {
  const { live, engine, project } = await fixture(t, async options => { writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Changed the value.\nDISPATCH_REMAINING:\n- Let one task change several repositories.\n- Add extensions.\nNotes for next time:\n- none' }; });
  const run = await live.create({ projectId: project.id, input: 'Change the value and plan the rest' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events)); assert.ok(run.headSha); assert.deepEqual(run.remaining, { items: ['Let one task change several repositories.', 'Add extensions.'], resolution: null });
  assert.equal(taskState({ latest: run }), 'decision');
  const tasks = new Tasks(live);
  assert.throws(() => tasks.settleRemaining(run.id, { action: 'later' }), /Choose task or finish/);
  tasks.settleRemaining(run.id, { action: 'task' });
  const [task] = tasks.list();
  assert.equal(run.remaining.resolution, 'task'); assert.equal(run.remaining.taskId, task.id); assert.equal(task.sourceRunId, run.id); assert.match(task.input, /- Let one task change several repositories\.\n- Add extensions\.[\s\S]*on branch /);
  assert.equal(taskState({ latest: run }), 'review');
  assert.throws(() => tasks.settleRemaining(run.id, { action: 'finish' }), /no unbuilt work/);
});
test('failed checks cannot produce a handoff', async t => {
  const { live, engine, project, turns } = await fixture(t, async options => { writeFileSync(join(options.workspace, 'value.txt'), 'bad'); return { outcome: 'completed', sessionId: 'session-1' }; });
  const run = await live.create({ projectId: project.id, input: 'Fail repeatedly' }); await settle(engine, run);
  assert.equal(run.status, 'failed'); assert.equal(turns(), 2); assert.equal(run.handoff, null);
});
test('duplicate live tickets and cancellation cannot publish', async t => {
  const { live, engine, project } = await fixture(t, async options => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return { outcome: 'cancelled' }; });
  const run = await live.create({ projectId: project.id, input: 'Wait here' });
  await assert.rejects(live.create({ projectId: project.id, input: 'Wait here' }), /already/);
  while (run.status !== 'implementing') await sleep(10);
  engine.cancel(run.id); await settle(engine, run); assert.equal(run.status, 'cancelled'); assert.equal(run.handoff, null);
});
test('interrupt rejects blank input and stopped runs', async t => {
  const { live, engine, project } = await fixture(t);
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  await assert.rejects(live.interrupt(run.id, { input: 'Again' }), /has stopped/);
  await assert.rejects(live.followup(run.id, { input: '   ' }), /Enter follow-up/);
});
test('checks that mutate the candidate invalidate evidence', async t => {
  const { live, engine, project } = await fixture(t);
  project.validation = [{ id: 'mutate', command: process.execPath, args: ['-e', 'require("fs").writeFileSync("late.txt","changed")'], timeoutSeconds: 30 }];
  const run = await live.create({ projectId: project.id, input: 'Stale check' }); await settle(engine, run);
  assert.equal(run.status, 'failed'); assert.match(run.events.at(-1).message, /stale/); assert.equal(run.handoff, null);
});
test('missing auth blocks before agent execution', async t => {
  const { live, engine, project, turns } = await fixture(t); live.adapter.capabilities = async () => ({ available: true, authenticated: false, detail: 'Run codex login' });
  const run = await live.create({ projectId: project.id, input: 'Need login' }); await settle(engine, run); assert.equal(run.status, 'blocked'); assert.equal(turns(), 0);
});
test('ticket fields from a tracker are reduced to plain text', () => {
  assert.equal(plainText('<p>Hello &amp; goodbye</p><div>Line</div>'), 'Hello & goodbye\nLine');
  assert.equal(plainText('<b>Pass</b>'), 'Pass'); assert.equal(plainText(undefined), '');
});
test('project registration requires explicit confirmation and a check list, which may be empty', async t => {
  const { live, engine, repo, project } = await fixture(t);
  await assert.rejects(live.saveProject({ repositoryPath: repo }), /Confirm/);
  await assert.rejects(live.saveProject({ repositoryPath: repo, baseBranch: 'main', confirmed: true }, project.id), /at most 12 check/);
  const saved = await live.saveProject({ repositoryPath: repo, baseBranch: 'main', confirmed: true, validation: [], risk: { mode: 'agent' } }, project.id);
  assert.deepEqual(saved.validation, []);
  const run = await live.create({ projectId: saved.id, input: 'No checks' }); await settle(engine, run);
  assert.equal(run.status, 'ready'); assert.deepEqual(run.checks, []); assert.equal(run.riskFallbacks, undefined);
});
test('restart interrupts without replay and permits explicit same-session continuation', async t => {
  const { live, engine, project } = await fixture(t);
  const run = await live.create({ projectId: project.id, input: 'Recovery example' }); await settle(engine, run);
  run.status = 'implementing'; engine.store.save();
  const recovered = new Engine({ dataDir: engine.dataDir }); const resumed = new LiveService(recovered, { adapter: live.adapter });
  t.after(() => recovered.shutdown());
  const interrupted = recovered.get(run.id); assert.equal(interrupted.status, 'interrupted'); assert.equal(recovered.active.size, 0);
  const next = await resumed.followup(run.id, { input: 'Continue after restart' }); await settle(recovered, next); assert.equal(next.status, 'ready'); assert.equal(next.sessionId, run.sessionId);
});
test('live queue permits only one real worker and blocks still-alive recovered workers', async t => {
  let concurrent = 0, maximum = 0;
  const { live, engine, project } = await fixture(t, async options => { concurrent++; maximum = Math.max(maximum, concurrent); await sleep(60); writeFileSync(join(options.workspace, 'value.txt'), 'changed'); concurrent--; return { outcome: 'completed', sessionId: 'session-1' }; });
  const first = await live.create({ projectId: project.id, input: 'First task' });
  const second = await live.create({ projectId: project.id, input: 'Second task' });
  await settle(engine, first); await settle(engine, second); assert.equal(maximum, 1);
  first.workerPid = process.pid; first.status = 'interrupted';
  await assert.rejects(live.followup(first.id, { input: 'Resume' }), /still alive/);
  const third = await live.create({ projectId: project.id, input: 'Third task' }); await settle(engine, third); assert.equal(third.status, 'blocked');
});
test('agent changes to package scripts block validation and remain visible', async t => {
  const { live, engine, project, repo } = await fixture(t, async options => { writeFileSync(join(options.workspace, 'package.json'), JSON.stringify({ scripts: { test: 'echo bypass' } })); return { outcome: 'completed', sessionId: 'session-1' }; });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e 0' } })); await git(repo, ['add', 'package.json']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Add scripts']);
  const run = await live.create({ projectId: project.id, input: 'Change recipe' }); await settle(engine, run); assert.equal(run.status, 'blocked'); assert.equal(run.checks.length, 0); assert.match((await live.diff(run.id)).diff, /bypass/);
  assert.equal(run.scriptsAtBase, true); assert.equal(run.events.some(event => /protected baseline/.test(event.message)), false);
});
test('missing repair usage stays unknown rather than undercounting tokens', async t => {
  const { live, engine, project } = await fixture(t, async (options, turn) => { writeFileSync(join(options.workspace, 'value.txt'), turn === 1 ? 'bad' : 'changed'); return { outcome: 'completed', sessionId: 'session-1', ...(turn === 1 ? { usage: { input_tokens: 10, cached_input_tokens: 5, output_tokens: 2 } } : {}) }; });
  const run = await live.create({ projectId: project.id, input: 'Usage coverage test' }); await settle(engine, run); assert.equal(run.status, 'ready'); assert.equal(run.usage.input, null); assert.equal(run.usageReports.length, 2);
});
test('failed browser capture cannot turn a passing required check into a failure', async t => {
  const { live, engine, project } = await fixture(t); live.browserEvidence.start = () => { throw new Error('Capture unavailable'); };
  const run = await live.create({ projectId: project.id, input: 'Capture is optional' }); await settle(engine, run); assert.equal(run.status, 'ready'); assert.match(run.events.find(e => e.kind === 'browser').message, /Validation will still run/);
});

test('repository connector consent is explicit, preserved on edits and snapshotted', async t => {
  const { live, engine, project } = await fixture(t);
  assert.deepEqual(project.connectors, {});
  const url = issueUrl('project', 12);
  await assert.rejects(live.create({ projectId: project.id, input: url }), error => { assert.equal(error.status, 409); assert.equal(error.question.kind, 'connector'); assert.equal(error.question.projectId, project.id); assert.deepEqual(error.question.options.map(option => option.id), ['project', 'global', 'text']); return true; });
  assert.equal(engine.runs.length, 0);
  const updated = await live.saveProject({ ...project, confirmed: true, connectors: { example: { enabled: true } } }, project.id);
  const { connectors, ...withoutConnectors } = updated;
  assert.equal((await live.saveProject({ ...withoutConnectors, confirmed: true }, project.id)).connectors.example.enabled, true);
  const run = await live.create({ projectId: project.id, input: 'Snapshot connector consent' });
  updated.connectors.example.enabled = false;
  assert.equal(run.project.connectors.example.enabled, true);
  await settle(engine, run); assert.equal(run.status, 'ready');
});
test('a worker cannot replace branch ancestry and produce a ready handoff', async t => {
  const { live, engine, project } = await fixture(t, async options => {
    const branch = await git(options.workspace, ['branch', '--show-current']);
    await git(options.workspace, ['checkout', '--orphan', 'replacement']);
    await git(options.workspace, ['branch', '-D', branch]);
    await git(options.workspace, ['branch', '-m', branch]);
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    await git(options.workspace, ['add', '.']);
    await git(options.workspace, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Unrelated root']);
    return { outcome: 'completed', sessionId: 'session-1' };
  });
  const run = await live.create({ projectId: project.id, input: 'Do not replace history' });
  await settle(engine, run); assert.equal(run.status, 'failed'); assert.equal(run.checks.length, 0); assert.equal(run.handoff, null);
});

test('independent review uses a separate read-only turn and repairs in the owner session', async t => {
  const seen = [];
  let reviews = 0;
  const { live, engine, project } = await fixture(t, async options => {
    seen.push({ sessionId: options.sessionId, readOnly: options.readOnly });
    if (options.readOnly) {
      reviews++;
      options.onSession(`review-${reviews}`);
      return { outcome: 'completed', sessionId: `review-${reviews}`, summary: JSON.stringify(reviews === 1 ? { approved: false, findings: ['value.txt:1 — expected value not preserved — check fails'] } : { approved: true, findings: [] }), usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 2 } };
    }
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    return { outcome: 'completed', sessionId: 'owner', usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 3 } };
  });
  project.review = true;
  const run = await live.create({ projectId: project.id, input: 'Review and repair' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events)); assert.equal(run.sessionId, 'owner');
  assert.deepEqual(seen, [{ sessionId: null, readOnly: undefined }, { sessionId: null, readOnly: true }, { sessionId: 'owner', readOnly: undefined }, { sessionId: null, readOnly: true }]);
  assert.deepEqual(run.reviews.map(review => review.status), ['findings', 'passed']); assert.equal(run.checks.length, 2);
  assert.deepEqual(run.checks.map(check => [check.attempt, check.status, check.reusedFrom?.attempt ?? null]), [[1, 'passed', null], [2, 'passed', 1]]); assert.match(run.checks[1].output, /\(attempt 1\)/);
  assert.equal(run.reviews.at(-1).revision, run.revision);
});
test('malformed review output and reviewer edits cannot produce readiness', async t => {
  for (const mutate of [false, true]) {
    const { live, engine, project } = await fixture(t, async options => {
      if (!options.readOnly) writeFileSync(join(options.workspace, 'value.txt'), 'changed');
      else if (mutate) writeFileSync(join(options.workspace, 'late.txt'), 'reviewer edit');
      return { outcome: 'completed', sessionId: 'session-1', summary: mutate ? '{"approved":true,"findings":[]}' : 'Looks fine' };
    });
    project.review = true;
    const run = await live.create({ projectId: project.id, input: 'Fail closed on invalid review' }); await settle(engine, run);
    assert.equal(run.status, 'failed'); assert.equal(run.handoff, null); assert.equal(run.reviews[0].status, 'failed');
  }
});
test('review findings share the bounded repair allowance', async t => {
  const { live, engine, project, turns } = await fixture(t, async options => {
    if (!options.readOnly) writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    return { outcome: 'completed', sessionId: 'session-1', summary: '{"approved":false,"findings":["value.txt:1 — regression remains — check fails"]}' };
  });
  project.review = true;
  const run = await live.create({ projectId: project.id, input: 'Bound the review loop' }); await settle(engine, run);
  assert.equal(run.status, 'failed'); assert.equal(run.attempt, 2); assert.equal(turns(), 4); assert.equal(run.handoff, null);
});

test('cancellation during review never saves a handoff or starts a repair', async t => {
  const { live, engine, project, turns } = await fixture(t, async options => {
    if (options.readOnly) {
      await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      return { outcome: 'cancelled' };
    }
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    return { outcome: 'completed', sessionId: 'owner' };
  });
  project.review = true;
  const run = await live.create({ projectId: project.id, input: 'Cancel independent review' });
  while (run.status !== 'reviewing') await sleep(10);
  engine.cancel(run.id); await settle(engine, run);
  assert.equal(run.status, 'cancelled'); assert.equal(run.handoff, null); assert.equal(turns(), 2); assert.equal(run.reviews[0].status, 'cancelled');
});

async function pendingDecision(run) {
  for (let i = 0; i < 500; i++) { const request = run.interactions?.find(request => request.status === 'pending'); if (request) return request; await sleep(10); }
  throw new Error(`No decision appeared: ${run.status}`);
}
test('questions pause the owner session and cancellation clears the pending response', async t => {
  for (const cancel of [false, true]) {
    const { live, engine, project } = await fixture(t, async options => {
      try { const response = await options.onQuestion([{ id: 'scope', question: 'Which scope?', options: [{ label: 'Small' }] }]); assert.deepEqual(response.answers.scope.answers, ['Small']); }
      catch { assert.ok(cancel); }
      return { outcome: 'blocked', sessionId: 'session-1' };
    });
    const run = await live.create({ projectId: project.id, input: `Question ${cancel}` }); const request = await pendingDecision(run);
    if (cancel) engine.cancel(run.id); else live.interactions.answer(run.id, { requestId: request.id, answers: { scope: 'Small' } });
    await settle(engine, run); assert.equal(request.status, cancel ? 'cancelled' : 'answered'); assert.equal(run.handoff, null);
  }
});

test('Auto starts an unnamed repository in dispatch home rather than guessing, and an explicit choice still wins', async t => {
  const { live, engine, project } = await fixture(t);
  live.projects.push({ ...project, id: 'other', name: 'Other', repositoryPath: '/some/other' });
  const auto = await live.create({ projectId: 'auto', input: 'Change the value' }); await settle(engine, auto);
  assert.equal(live.projects.find(item => item.id === auto.projectId).name, 'dispatch home'); assert.match(auto.repositorySelection.reason, /No repository named/);
  const run = await live.create({ projectId: project.id, input: 'Change the value again' }); await settle(engine, run);
  assert.equal(run.status, 'ready'); assert.equal(run.repositorySelection.mode, 'manual'); assert.equal(run.projectId, project.id);
});

test('Auto resolves tracker ticket text after read-only intake rather than guessing from its URL', async t => {
  const tracker = exampleTracker({ read: async ref => ({ ...ref, key: 'example:test:5', title: 'Update repo', description: 'Change the value', acceptance: 'Pass' }) });
  const { live, engine, project } = await fixture(t, undefined, tracker);
  live.projects.push({ ...project, id: 'other', name: 'Other', repositoryPath: '/some/other' });
  project.connectors = { example: { enabled: true } };
  const run = await live.create({ projectId: 'auto', input: issueUrl('p', 5) }); await settle(engine, run);
  assert.equal(run.projectId, project.id); assert.equal(run.repositorySelection.mode, 'auto'); assert.equal(run.status, 'ready');
});

test('text typed around a tracker link reaches the worker as an operator note; a bare link adds none', async t => {
  const tracker = exampleTracker();
  tracker.connector.actions.read.hooks['ticket.detect'] = (input, ctx) => parseIssueRef(String(input).match(/https:\/\/tracker\.example\/\S+/)?.[0] ?? input, ctx);
  const prompts = [];
  const { live, engine, project } = await fixture(t, async (options, turn) => { prompts.push(options.prompt); return completesWithFiles(options, turn); }, tracker);
  project.connectors = { example: { enabled: true } };
  const noted = await live.create({ projectId: project.id, input: `Please take this one\n${issueUrl('p', 5)}\nKeep the old header` }); await settle(engine, noted);
  assert.equal(noted.ticket.title, 'Issue 5');
  assert.match(prompts[0], /TICKET:\nIssue 5[\s\S]*OPERATOR NOTE \(typed with the ticket link\):\nPlease take this one\nhttps:\/\/tracker\.example\/p\/issues\/5\nKeep the old header/);
  const bare = await live.create({ projectId: project.id, input: issueUrl('p', 6) }); await settle(engine, bare);
  assert.equal(bare.ticket.note, undefined); assert.doesNotMatch(prompts.at(-1), /OPERATOR NOTE/);
});

test('a connector can propose the branch, and in ask mode the composer is asked before any run exists', async t => {
  const tracker = exampleTracker(), read = tracker.read;
  const { live, engine, project } = await fixture(t, undefined, tracker);
  project.connectors = { example: { enabled: true } };
  const plain = await live.create({ projectId: project.id, input: issueUrl('p', 4) }); await settle(engine, plain);
  assert.equal(plain.branch, `dispatch/${plain.id}`);
  tracker.read = async ref => ({ ...await read(ref), branch: 'bug/{ticketId}-{slug}' });
  const proposed = await live.create({ projectId: project.id, input: issueUrl('p', 5) }); await settle(engine, proposed);
  assert.match(proposed.branch, /^bug\/5-issue-5/);
  live.setBranchNaming({ mode: 'ask' });
  await assert.rejects(live.create({ projectId: project.id, input: issueUrl('p', 6) }), error => error.status === 409 && error.question.kind === 'branch' && error.question.options.map(option => option.label).join() === 'bug/6-issue-6,dispatch/<run>');
  assert.equal(engine.runs.length, 2);
  await assert.rejects(live.create({ projectId: project.id, input: issueUrl('p', 6), branch: 'a..b' }), /valid Git branch/);
  const chosen = await live.create({ projectId: project.id, input: issueUrl('p', 6), branch: 'hotfix/{ticketId}' }); await settle(engine, chosen);
  assert.match(chosen.branch, /^hotfix\/6/);
  const saved = await live.create({ projectId: project.id, input: issueUrl('p', 7) }, { taskId: 'task-1' }); await settle(engine, saved);
  assert.match(saved.branch, /^bug\/7-issue-7/);
});

test('the brief keeps operator-only steps out of blocked options', async t => {
  const prompts = [];
  const { live, engine, project } = await fixture(t, async (options, turn) => { prompts.push(options.prompt); return completesWithFiles(options, turn); });
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.match(prompts[0], /two or three numbered options you can act on \("1\. Option — why"\), recommended first; operator-only steps go above\./);
});

test('a worker question persists, releases its slot, and resumes with the snapshotted model and fresh checks', async t => {
  const seen = [];
  const { live, engine, project } = await fixture(t, async (options, turn) => {
    seen.push({ execution: structuredClone(options.execution), sessionId: options.sessionId });
    if (turn === 1) return { outcome: 'blocked', sessionId: 'session-1', summary: 'DISPATCH_BLOCKED: Which value should I use?' };
    assert.match(options.prompt, /Use changed/); writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    return { outcome: 'completed', sessionId: 'session-1' };
  });
  live.adapter.models = async () => ({ available: true, models: [{ model: 'test-sol', defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] });
  await live.refreshModels();
  const run = await live.create({ projectId: project.id, input: 'Change the value', execution: { provider: 'codex', model: 'test-sol', effort: 'high' } }); await settle(engine, run);
  assert.equal(run.status, 'blocked'); assert.equal(run.question, 'Which value should I use?'); assert.equal(run.checks.length, 0); assert.equal(run.handoff, null); assert.equal(engine.active.size, 0);
  const recovered = new Engine({ dataDir: engine.dataDir }); t.after(() => recovered.shutdown());
  assert.equal(recovered.get(run.id).question, run.question);
  const next = await live.followup(run.id, { input: 'Use changed' }); await settle(engine, next);
  assert.equal(next.status, 'ready'); assert.equal(next.workspace, run.workspace); assert.equal(next.checks.length, 1);
  assert.deepEqual(seen.map(item => item.execution.model), ['test-sol', 'test-sol']); assert.equal(seen[1].sessionId, 'session-1');
});

test('unavailable model selections and providers never invoke a live worker', async t => {
  const { live, engine, project, turns } = await fixture(t);
  for (const execution of [{ provider: 'claude', model: 'anything' }, { provider: 'codex', model: 'not-listed', effort: 'high' }]) {
    await assert.rejects(live.create({ projectId: project.id, input: 'Change the value', execution }));
  }
  assert.equal(turns(), 0); assert.equal(engine.runs.length, 0);
});

test('Auto tracker intake only considers repositories that read the tracker and never reads through disabled connectors', async t => {
  let reads = 0;
  const tracker = exampleTracker({ read: async ref => { reads++; return { ...ref, key: `example:test:${reads}`, title: 'Update Other', description: 'Change the value', acceptance: 'Pass' }; } });
  const { live, engine, project, turns } = await fixture(t, undefined, tracker);
  const input = { projectId: 'auto', input: issueUrl('p', 8) };
  await assert.rejects(live.create(input), error => error.status === 409 && error.question.kind === 'connector'); assert.equal(reads, 0);
  project.connectors = { example: { enabled: true } };
  const other = { ...project, id: 'other', name: 'Other', connectors: { example: { enabled: false } }, repositoryPath: '/some/other' };
  live.projects.push(other);
  const run = await live.create(input); assert.equal(reads, 1); assert.equal(run.projectId, project.id);
  await settle(engine, run); assert.equal(run.status, 'ready');
  other.connectors = { example: { enabled: true } };
  await assert.rejects(live.create(input), error => { assert.equal(error.status, 409); assert.deepEqual(error.question.candidates.map(item => item.id), [project.id, 'other']); return true; });
  assert.equal(reads, 1); assert.equal(turns(), 1); assert.equal(live.pending.size, 0);
});

test('agent browser observations are retained without claiming validation success', async t => {
  const { live, engine, project } = await fixture(t, async options => {
    options.onBrowser({ phase: 'completed', label: 'browser/screenshot', images: [{ mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jcEIAAAAASUVORK5CYII=' }] });
    writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1' };
  });
  const run = await live.create({ projectId: project.id, input: 'Browser observation' }); await settle(engine, run);
  const observed = run.artifacts.filter(item => item.check !== 'patch');
  assert.equal(run.status, 'ready'); assert.equal(run.checks[0].revision, run.revision); assert.equal(observed.length, 1);
  assert.equal(observed[0].revision, null); assert.equal(observed[0].source, 'agent'); assert.equal(run.browser, undefined);
  assert.equal(run.artifacts.filter(item => item.check === 'patch').length, 1);
});

test('a stored Plan run continues as Auto and runs the setup it deferred', async t => {
  const { live, engine, project } = await fixture(t, async options => {
    assert.ok(existsSync(join(options.workspace, 'node_modules'))); writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1' };
  });
  project.setup = [{ id: 'setup', command: process.execPath, args: ['-e', 'require("fs").mkdirSync("node_modules",{recursive:true})'], timeoutSeconds: 10 }];
  await git(project.repositoryPath, ['config', 'core.excludesFile', '/dev/null']);
  writeFileSync(join(project.repositoryPath, '.gitignore'), 'node_modules/\n'); await git(project.repositoryPath, ['add', '.gitignore']); await git(project.repositoryPath, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Ignore setup output']);
  const stored = await live.create({ projectId: project.id, input: 'Plan this first' }); await settle(engine, stored);
  rmSync(join(stored.workspace, 'node_modules'), { recursive: true });
  delete stored.setupComplete; Object.assign(stored, { executionMode: 'plan', status: 'planned' });
  const next = await live.followup(stored.id, { input: 'Implement the plan', executionMode: 'plan' }); await settle(engine, next);
  assert.equal(next.status, 'ready', JSON.stringify(next.events)); assert.equal(next.sessionId, stored.sessionId); assert.equal(next.checks.length, 1); assert.equal(next.executionMode, undefined);
  for (const key of ['capabilitiesMs', 'worktreeMs', 'setupMs', 'lockWaitMs', 'publishMs', 'deliveryMs']) assert.ok(Number.isInteger(stored.timings[key]) && stored.timings[key] >= 0, key);
  assert.ok(next.timings.setupMs >= 0 && next.timings.worktreeMs === undefined);
});

test('runs have no time limit: agent turns get no timeout and a saved limit is ignored', async t => {
  const timeouts = [];
  const { live, engine, project } = await fixture(t, async options => { timeouts.push(options.timeoutMs); writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1' }; });
  assert.equal(project.timeoutMinutes, undefined);
  project.timeoutMinutes = 0.0001;
  const run = await live.create({ projectId: project.id, input: 'Take as long as needed' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events)); assert.deepEqual(timeouts, [undefined]);
});

test('long-running package scripts are never suggested and need explicit confirmation as checks', async t => {
  const { live, repo, project } = await fixture(t);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { check: 'x', test: 'x', start: 'x', dev: 'x', 'dev:api': 'x', serve: 'x', watch: 'x', preview: 'x', build: 'x' } }));
  const info = await live.inspect(repo);
  assert.deepEqual(info.suggestedChecks, ['check', 'test']);
  assert.deepEqual(info.longRunningScripts, ['start', 'dev', 'dev:api', 'serve', 'watch', 'preview']);
  const save = validation => live.saveProject({ ...project, confirmed: true, validation }, project.id);
  for (const args of [['run', 'dev'], ['start'], ['run', 'dev:api'], ['run-script', 'watch']]) await assert.rejects(save([{ id: 'long', command: 'npm', args }]), /long-running/);
  const saved = await save([{ id: 'serve', command: 'npm', args: ['run', 'serve'], confirmedLongRunning: true }, { id: 'test', command: 'npm', args: ['test'] }]);
  assert.deepEqual(saved.validation.map(step => [step.id, step.role, step.confirmedLongRunning]), [['serve', 'check', true], ['test', 'check', undefined]]);
  const withSetup = await live.saveProject({ ...project, confirmed: true, setup: [{ command: 'npm', args: ['run', 'dev'] }] }, project.id);
  assert.deepEqual(withSetup.setup.map(step => [step.id, step.role]), [['setup-1', 'setup']]);
  await assert.rejects(live.saveProject({ ...project, confirmed: true, setup: [{ command: 'npm', args: ['ci'], role: 'check' }] }, project.id), /setup role/);
});

test('cumulative session usage counts each repair and follow-up turn once', async t => {
  const cumulative = [{ input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 }, { input_tokens: 25, cached_input_tokens: 10, output_tokens: 5 }, { input_tokens: 40, cached_input_tokens: 12, output_tokens: 9 }];
  const { live, engine, project } = await fixture(t, async (options, turn) => {
    writeFileSync(join(options.workspace, 'value.txt'), turn === 1 ? 'bad' : 'changed');
    return { outcome: 'completed', sessionId: 'session-1', usage: null, cumulativeUsage: cumulative[turn - 1] };
  });
  const run = await live.create({ projectId: project.id, input: 'Usage delta test' }); await settle(engine, run);
  assert.equal(run.status, 'ready'); assert.deepEqual([run.usage.input, run.usage.cachedInput, run.usage.output], [25, 10, 5]);
  assert.deepEqual(run.workerTurns.map(turn => turn.usage.input_tokens), [10, 15]); assert.match(run.usage.basis, /per-turn deltas/);
  const next = await live.followup(run.id, { input: 'Follow up' }); await settle(engine, next);
  assert.equal(next.status, 'ready'); assert.deepEqual([next.usage.input, next.usage.cachedInput, next.usage.output], [15, 2, 4]);
});
test('a resumed session without an earlier cumulative total keeps usage unknown', async t => {
  const { live, engine, project } = await fixture(t, async options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    return { outcome: 'completed', sessionId: 'session-1', usage: null, cumulativeUsage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 5 } };
  });
  const run = await live.create({ projectId: project.id, input: 'Unknown usage test' }); await settle(engine, run);
  assert.equal(run.usage.input, 50);
  delete run.usageCumulative;
  const next = await live.followup(run.id, { input: 'Follow up' }); await settle(engine, next);
  assert.equal(next.status, 'ready'); assert.equal(next.usage.input, null); assert.equal(next.usage.output, null);
});

test('editing checks on a failed run updates the repository recipe and continues with fresh validation', async t => {
  const { live, engine, project, repo, turns } = await fixture(t, async options => { writeFileSync(join(options.workspace, 'value.txt'), 'other'); return { outcome: 'completed', sessionId: 'session-1' }; });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e 0' } }));
  await git(repo, ['add', 'package.json']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Add scripts']);
  const run = await live.create({ projectId: project.id, input: 'Checks are wrong' }); await settle(engine, run);
  assert.equal(run.status, 'failed'); assert.deepEqual(run.checks.map(check => check.status), ['failed', 'failed']);
  await assert.rejects(live.continueWithRecipe(run.id, { validation: [{ id: 'dev', command: 'npm', args: ['run', 'dev'] }] }), /long-running/);
  const validation = [{ id: 'other', command: process.execPath, args: ['-e', 'if(require("fs").readFileSync("value.txt","utf8")!=="other")process.exit(1)'] }];
  const next = await live.continueWithRecipe(run.id, { validation }); await settle(engine, next);
  assert.equal(next.status, 'ready', JSON.stringify(next.events)); assert.equal(next.recipeReplaced, true); assert.equal(next.input, 'Continue with the updated checks.');
  assert.equal(next.previousRunId, run.id); assert.equal(next.sessionId, run.sessionId); assert.equal(next.workspace, run.workspace); assert.equal(turns(), 3);
  assert.deepEqual(next.checks.map(check => [check.name, check.status, check.revision === next.revision, check.reusedFrom ?? null]), [['other', 'passed', true, null]]);
  assert.deepEqual(project.validation.map(step => step.id), ['other']); assert.equal(run.checks.length, 2); assert.equal(run.supersededBy, next.id);
  await assert.rejects(live.continueWithRecipe(run.id, { validation }), /most recent/);
});
test('a plain follow-up picks up checks saved for the repository after the task started', async t => {
  const { live, engine, project } = await fixture(t, async options => { writeFileSync(join(options.workspace, 'value.txt'), 'other'); return { outcome: 'completed', sessionId: 'session-1' }; });
  const run = await live.create({ projectId: project.id, input: 'Checks are wrong' }); await settle(engine, run);
  assert.equal(run.status, 'failed');
  await live.saveProject({ ...project, confirmed: true, validation: [{ id: 'other', command: process.execPath, args: ['-e', '0'] }] }, project.id);
  const next = await live.followup(run.id, { input: 'I fixed the checks' }); await settle(engine, next);
  assert.equal(next.status, 'ready', JSON.stringify(next.events.map(event => event.message)));
  assert.deepEqual(next.checks.map(check => [check.name, check.status]), [['other', 'passed']]);
  assert.ok(next.events.some(event => /picked up its saved settings: checks unit → other\./.test(event.message)));
  const again = await live.followup(next.id, { input: 'Nothing else' }); await settle(engine, again);
  assert.equal(again.events.some(event => /picked up its saved settings/.test(event.message)), false);
});

const writesOther = prompts => async options => { prompts.push(options.prompt); writeFileSync(join(options.workspace, 'value.txt'), 'other'); return { outcome: 'completed', sessionId: 'session-1' }; };
const failsUnless = (id, value) => ({ id, command: process.execPath, args: ['-e', `if(require("fs").readFileSync("value.txt","utf8")!==${JSON.stringify(value)})process.exit(1)`] });

test('a check that also fails on the base commit is run there once and the repair is told so', async t => {
  const prompts = [];
  const { live, engine, project } = await fixture(t, writesOther(prompts));
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'failed');
  assert.match(prompts[1], /Dispatch ran unit on the untouched base commit and it fails there too[\s\S]*DISPATCH_BLOCKED/);
  assert.equal(run.events.filter(event => /running it once on the base commit/.test(event.message)).length, 1);
  assert.ok(Object.values(run.baseChecks).every(result => result === 'failed'));
  assert.ok(Number.isFinite(run.timings.baseCheckMs));
  const next = await live.followup(run.id, { input: 'Try again' }); await settle(engine, next);
  assert.equal(next.events.some(event => /running it once on the base commit/.test(event.message)), false);
  assert.match(prompts.at(-1), /Dispatch ran unit on the untouched base commit/);
});

test('a check that passes on the base commit is repaired without a base note', async t => {
  const prompts = [];
  const { live, engine, project } = await fixture(t, writesOther(prompts));
  await live.saveProject({ ...project, confirmed: true, validation: [{ ...failsUnless('original', 'original'), id: 'keeps' }] }, project.id);
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'failed');
  assert.match(prompts[1], /^Repair this failing mandatory check without changing the validation recipe\./);
  assert.doesNotMatch(prompts[1], /untouched base commit/);
});

test('every in-scope check runs after a failure and one repair prompt carries all of them', async t => {
  const prompts = [];
  const { live, engine, project } = await fixture(t, writesOther(prompts));
  await live.saveProject({ ...project, confirmed: true, validation: [failsUnless('first', 'changed'), failsUnless('second', 'changed'), failsUnless('third', 'other')] }, project.id);
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.deepEqual(run.checks.filter(check => check.attempt === 1).map(check => [check.name, check.status]), [['first', 'failed'], ['second', 'failed'], ['third', 'passed']]);
  assert.match(prompts[1], /^Repair these failing mandatory checks[\s\S]*\n\nfirst: [\s\S]*\n\nsecond: /);
});

test('files a check rewrites are put back and named, and the run still fails as stale', async t => {
  const { live, engine, project } = await fixture(t);
  const rewrites = { id: 'snapshots', command: process.execPath, args: ['-e', 'const fs=require("fs");if(fs.readFileSync("value.txt","utf8")!=="changed")process.exit(1);fs.writeFileSync("value.txt","regenerated");fs.writeFileSync("report.txt","r");fs.rmSync("new.txt")'] };
  await live.saveProject({ ...project, confirmed: true, validation: [rewrites] }, project.id);
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'failed'); assert.equal(run.handoff, null);
  assert.match(run.events.at(-1).message, /Evidence is stale\. snapshots changed 3 files while it ran \(.*\); dispatch put them back\. A check must not change the code it tests/);
  assert.equal(readFileSync(join(run.workspace, 'value.txt'), 'utf8'), 'changed');
  assert.equal(existsSync(join(run.workspace, 'report.txt')), false); assert.equal(existsSync(join(run.workspace, 'new.txt')), true);
});

test('local files from the checkout reach the task worktree so checks that read them pass', async t => {
  const { live, engine, project, repo } = await fixture(t);
  writeFileSync(join(repo, '.gitignore'), '.env.test\n'); await git(repo, ['add', '.gitignore']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-q', '-m', 'Ignore env']);
  writeFileSync(join(repo, '.env.test'), 'READY=1');
  const needsEnv = { id: 'env', command: process.execPath, args: ['-e', 'if(require("fs").readFileSync(".env.test","utf8")!=="READY=1")process.exit(1)'] };
  await live.saveProject({ ...project, confirmed: true, validation: [needsEnv], localFiles: ['.env.test'] }, project.id);
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  assert.ok(run.events.some(event => event.message === 'Copied .env.test from your checkout.'));
  assert.equal(run.changedPaths.includes('.env.test'), false);
});

test('checks cannot be edited while a run is active', async t => {
  const { live, engine, project } = await fixture(t, async options => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return { outcome: 'cancelled' }; });
  const run = await live.create({ projectId: project.id, input: 'Still working' });
  while (run.status !== 'implementing') await sleep(10);
  await assert.rejects(live.continueWithRecipe(run.id, { validation: project.validation }), error => error.status === 409);
  engine.cancel(run.id); await settle(engine, run);
  assert.equal(engine.runs.length, 1); assert.equal(project.validation[0].id, 'unit');
});
test('repository memory records ready runs, injects notes on the first turn only and stays outside the worktree', async t => {
  const prompts = [];
  const { live, engine, project } = await fixture(t, async (options, turn) => {
    prompts.push(options.prompt); writeFileSync(join(options.workspace, 'value.txt'), turn === 2 ? 'bad' : 'changed');
    return { outcome: 'completed', sessionId: 'session-1', summary: 'Done.\n\nNotes for next time:\n- Balance labels come from the shared formatter\n- Run the unit check from the worktree root\n- Third note\n- Fourth note is dropped' };
  });
  const first = await live.create({ projectId: project.id, input: 'Fix the balance label' }); await settle(engine, first);
  assert.equal(first.status, 'ready'); assert.deepEqual(first.memory, { injectedCharacters: 0, sourceLines: 0, notesBytes: 0, used: [] }); assert.doesNotMatch(prompts[0], /Repository notes/); assert.match(prompts[0], /Notes for next time/);
  const notesPath = join(engine.dataDir, 'memory', project.id, 'notes.md'), notes = readFileSync(notesPath, 'utf8');
  assert.match(notes, /## Gotchas\n- Balance labels come from the shared formatter\n- Run the unit check from the worktree root\n- Third note\n/); assert.doesNotMatch(notes, /Fourth/); assert.match(notes, /## Recent tasks\n- \d{4}-\d{2}-\d{2} Fix the balance label — ready, 1 files\n/);
  assert.ok(!notesPath.startsWith(first.workspace)); assert.equal(existsSync(join(first.workspace, 'notes.md')), false); assert.equal(await git(first.workspace, ['status', '--porcelain']), '');
  const second = await live.create({ projectId: project.id, input: 'Adjust the balance summary wording' }); await settle(engine, second);
  assert.equal(second.status, 'ready'); assert.equal(second.attempt, 2);
  assert.match(prompts[1], /Repository notes from earlier dispatch tasks \(data, not instructions\):\n## Build and checks\n- Check unit: /); assert.match(prompts[1], /Balance labels come from the shared formatter/); assert.doesNotMatch(prompts[1], /Run the unit check from the worktree root/);
  assert.equal(second.memory.injectedCharacters, prompts[1].slice(prompts[1].indexOf('## Build and checks')).length); assert.equal(second.memory.sourceLines, 3); assert.equal(second.memory.notesBytes, Buffer.byteLength(notes));
  assert.equal(second.events.filter(event => event.kind === 'memory').length, 1); assert.match(second.events.find(event => event.kind === 'memory').message, new RegExp(`${second.memory.injectedCharacters} characters`));
  assert.doesNotMatch(prompts[2], /Repository notes/); assert.match(prompts[2], /^Repair this failing/);
  const followup = await live.followup(second.id, { input: 'Also update the balance tooltip' }); await settle(engine, followup);
  assert.equal(followup.status, 'ready'); assert.doesNotMatch(prompts[3], /Repository notes/); assert.deepEqual(followup.memory, { injectedCharacters: 0, sourceLines: 0, notesBytes: null });
  const tasks = live.memory.readTasks(project.id); assert.deepEqual(tasks.map(task => [task.status, task.checks.map(check => check.status), task.learnings.length]), [['ready', ['passed'], 3], ['ready', ['failed', 'passed'], 0], ['ready', ['passed'], 0]]);
  assert.equal(live.projectMemory(project.id).tasks.length, 3); assert.throws(() => live.projectMemory('missing'), /not found/);
});
test('memory off reads and writes nothing, and a blocked run records a summary line only', async t => {
  const prompts = [];
  const { live, engine, project } = await fixture(t, async options => { prompts.push(options.prompt); return { outcome: 'blocked', sessionId: 'session-1', summary: 'DISPATCH_BLOCKED: Which policy?\nNotes for next time:\n- must not be stored' }; });
  const memoryDir = join(engine.dataDir, 'memory', project.id);
  writeFileSync(join(engine.dataDir, 'seed.txt'), ''); mkdirSync(memoryDir, { recursive: true }); writeFileSync(join(memoryDir, 'notes.md'), '## Build and checks\n- Check unit: node\n');
  await live.saveProject({ ...project, confirmed: true, memory: false }, project.id);
  assert.equal(project.memory, false); assert.deepEqual(live.projectMemory(project.id), { enabled: false, path: null, notes: '', tasks: [] });
  const off = await live.create({ projectId: project.id, input: 'Blocked while off' }); await settle(engine, off);
  assert.equal(off.status, 'blocked'); assert.equal(off.memory, undefined); assert.doesNotMatch(prompts[0], /Repository notes|Notes for next time/); assert.equal(existsSync(join(memoryDir, 'tasks.jsonl')), false); assert.equal(off.events.some(event => event.kind === 'memory'), false);
  await live.saveProject({ ...project, confirmed: true, memory: true }, project.id);
  const blocked = await live.create({ projectId: project.id, input: 'Blocked while on' }); await settle(engine, blocked);
  assert.equal(blocked.status, 'blocked'); assert.match(prompts[1], /Repository notes from earlier dispatch tasks/); assert.equal(blocked.memory.injectedCharacters, '## Build and checks\n- Check unit: node\n'.length);
  const tasks = live.memory.readTasks(project.id); assert.equal(tasks.length, 1); assert.equal(tasks[0].status, 'blocked'); assert.deepEqual(tasks[0].learnings, []); assert.equal(readFileSync(join(memoryDir, 'notes.md'), 'utf8'), '## Build and checks\n- Check unit: node\n');
  await assert.rejects(live.saveProject({ ...project, confirmed: true, memory: 'yes' }, project.id), /boolean/);
});
test('the worker brief stays short and adds notes and browser guidance only when they apply', async t => {
  const prompts = [];
  const { live, engine, project } = await fixture(t, async options => { prompts.push(options.prompt); return completesWithFiles(options); });
  const run = await live.create({ projectId: project.id, input: 'Fix a typo' }); await settle(engine, run);
  assert.equal(run.status, 'ready'); assert.ok(run.workerTurns[0].promptCharacters < 2450, String(run.workerTurns[0].promptCharacters));
  assert.doesNotMatch(prompts[0], /Follow repository instructions|write outside the worktree/); assert.match(prompts[0], /Notes for next time/); assert.match(prompts[0], /own port/); assert.doesNotMatch(prompts[0], /browser checks/);
  await live.saveProject({ ...project, confirmed: true, memory: false, validation: [...project.validation, { id: 'e2e', command: process.execPath, args: ['-e', ''], browser: true }] }, project.id);
  const browser = await live.create({ projectId: project.id, input: 'Fix another typo' }); await settle(engine, browser);
  assert.equal(browser.status, 'ready'); assert.doesNotMatch(prompts[1], /Notes for next time|own port/); assert.match(prompts[1], /dispatch runs the browser checks/);
});
test('inspect suggests the dispatch browser only when a start script exists, and a created repository starts with it on', async t => {
  const { live, repo, dir } = await fixture(t); live.createRoot = dir;
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { check: 'x', test: 'x' } }));
  assert.equal((await live.inspect(repo)).suggestBrowser, false);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { check: 'x', preview: 'x' } }));
  assert.equal((await live.inspect(repo)).suggestBrowser, true);
  const project = await live.createRepository({ repositoryPath: join(dir, 'shown-app'), confirmed: true });
  assert.deepEqual(project.browser, { enabled: true, headed: false });
});
test('a new repository is created inside the allowed root with a browser smoke check, and refuses unsafe targets', async t => {
  const { live, dir, repo } = await fixture(t); live.createRoot = dir;
  for (const [path, reason] of [[join(dir, '..', 'escape'), /inside your home folder/], [join(repo, 'nested'), /inside an existing Git repository/], [join(dir, 'data'), /new or empty folder/], [join(dir, '.hidden', 'app'), /parent folder must exist|hidden/], [join(dir, 'missing-parent', 'app'), /parent folder must exist/]]) {
    await assert.rejects(live.createRepository({ repositoryPath: path, confirmed: true }), reason, path);
  }
  await assert.rejects(live.createRepository({ repositoryPath: join(dir, 'app') }), /Confirm/);
  const project = await live.createRepository({ repositoryPath: join(dir, 'todo-app'), confirmed: true, access: 'full' });
  assert.equal(project.name, 'todo-app'); assert.equal(project.baseBranch, 'main'); assert.equal(project.access, 'full'); assert.deepEqual(project.setup, []); assert.deepEqual(project.checkScopes, []);
  assert.deepEqual(project.validation.map(step => [step.id, step.kind, step.command, step.args]), [['browser-smoke', 'browser-smoke', 'dispatch', ['browser-smoke']]]);
  assert.equal(await git(project.repositoryPath, ['branch', '--show-current']), 'main'); assert.match(readFileSync(join(project.repositoryPath, '.gitignore'), 'utf8'), /node_modules/);
  await assert.rejects(live.createRepository({ repositoryPath: join(dir, 'todo-app'), confirmed: true }), /new or empty folder/);
  await assert.rejects(live.saveProject({ ...project, confirmed: true, access: 'sometimes' }, project.id), /inherit or full/);
});
test('the first turn in a repository without package.json sets the protected script baseline; later script changes still block', async t => {
  const { live, engine, dir } = await fixture(t, async (options, turn) => {
    writeFileSync(join(options.workspace, 'package.json'), JSON.stringify({ scripts: { dev: turn === 3 ? 'node other.mjs' : 'node serve.mjs', test: 'node -e 0' } })); writeFileSync(join(options.workspace, 'index.html'), `<h1>${turn}</h1>`);
    return { outcome: 'completed', sessionId: 'session-1' };
  });
  live.createRoot = dir;
  const created = await live.createRepository({ repositoryPath: join(dir, 'fresh'), confirmed: true, access: 'full' });
  const project = await live.saveProject({ ...created, confirmed: true, validation: [{ id: 'ok', command: process.execPath, args: ['-e', ''] }], risk: { mode: 'off' } }, created.id);
  const run = await live.create({ projectId: project.id, input: 'Scaffold the app' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events)); assert.equal(run.access, 'full'); assert.equal(run.scriptsAtBase, true);
  assert.deepEqual(run.packageScripts, { dev: 'node serve.mjs', test: 'node -e 0' }); assert.ok(run.events.some(event => /scripts are now the protected baseline/.test(event.message)));
  const same = await live.followup(run.id, { input: 'Tweak the heading' }); await settle(engine, same);
  assert.equal(same.status, 'ready', JSON.stringify(same.events)); assert.equal(same.events.some(event => /protected baseline/.test(event.message)), false);
  const changed = await live.followup(same.id, { input: 'Change the dev script' }); await settle(engine, changed);
  assert.equal(changed.status, 'blocked'); assert.match(changed.events.at(-1).message, /Validation scripts changed/);
  const added = live.addRecipeSteps(project.id, { validation: [{ id: 'test', command: 'npm', args: ['run', 'test'] }] });
  assert.deepEqual(added.validation.map(step => step.id), ['ok', 'test']);
  assert.throws(() => live.addRecipeSteps(project.id, { validation: [{ id: 'test', command: 'npm', args: ['run', 'test'] }] }), /unique/);
  assert.throws(() => live.addRecipeSteps('missing', { setup: [] }), /not found/);
});

test('the worktree starts from origin when it is ahead, records drift, and falls back to the local branch when the fetch fails or tracking is off', async t => {
  const { live, engine, project, repo, dir } = await fixture(t);
  const commit = async message => { await git(repo, ['add', '.']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', message]); return git(repo, ['rev-parse', 'HEAD']); };
  const bare = join(dir, 'origin.git'); await git(dir, ['init', '--bare', bare]);
  await git(repo, ['remote', 'add', 'origin', bare]); await git(repo, ['push', '-u', 'origin', 'main']);
  writeFileSync(join(repo, 'value.txt'), 'remote'); const ahead = await commit('Remote change'); await git(repo, ['push', 'origin', 'main']); await git(repo, ['reset', '--hard', 'HEAD~1']);
  const behind = await git(repo, ['rev-parse', 'HEAD']);
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events)); assert.equal(run.baseSha, ahead); assert.equal(run.baseSource, 'origin'); assert.ok(run.baseFetchedAt); assert.equal(run.handoff.baseMoved, 0);
  assert.equal(await git(repo, ['rev-parse', 'HEAD']), behind); assert.ok(run.events.some(event => /origin\/main is at .* Starting from origin\./.test(event.message)));
  await git(repo, ['reset', '--hard', ahead]); writeFileSync(join(repo, 'value.txt'), 'remote again'); await commit('Another remote change'); await git(repo, ['push', 'origin', 'main']); await git(repo, ['reset', '--hard', behind]);
  assert.equal(await live.baseDrift(run, new AbortController().signal), 1);
  await git(repo, ['remote', 'set-url', 'origin', join(dir, 'missing.git')]);
  const fallback = await live.create({ projectId: project.id, input: 'Change the value once more' }); await settle(engine, fallback);
  assert.equal(fallback.status, 'ready', JSON.stringify(fallback.events)); assert.equal(fallback.baseSource, 'local-unfetched'); assert.equal(fallback.baseSha, behind); assert.equal(fallback.handoff.baseMoved, null);
  assert.ok(fallback.events.some(event => /Could not fetch origin\/main; starting from the local branch/.test(event.message)));
  await live.saveProject({ ...project, confirmed: true, trackRemote: false }, project.id);
  const local = await live.create({ projectId: project.id, input: 'Change the value locally' }); await settle(engine, local);
  assert.equal(local.status, 'ready'); assert.equal(local.baseSource, 'local'); assert.equal(local.baseSha, behind); assert.ok(!local.events.some(event => /fetch/.test(event.message)));
});
test('operator instructions ride every turn including follow-ups, remembering appends them, and answers persist on the run', async t => {
  const prompts = [];
  let asked = false;
  const { live, engine, project } = await fixture(t, async options => {
    prompts.push(options.prompt);
    if (!asked) { asked = true; const answer = await options.onQuestion([{ id: 'q1', question: 'Which database?', options: [{ label: 'docker (Recommended)' }, { label: 'mcp' }] }]); assert.deepEqual(answer, { answers: { q1: { answers: ['docker'] } } }); }
    return completesWithFiles(options);
  });
  const saved = await live.saveProject({ ...project, confirmed: true, instructions: ['Prefer staging.', ' Never   use Prisma. ', 'Prefer staging.'] }, project.id);
  assert.deepEqual(saved.instructions, ['Prefer staging.', 'Never use Prisma.']); assert.deepEqual(saved.protectedPaths, []); assert.equal(saved.trackRemote, true);
  const run = await live.create({ projectId: project.id, input: 'Change the value' });
  await until(() => run.interactions.some(item => item.status === 'pending'));
  live.interactions.answer(run.id, { requestId: run.interactions[0].id, answers: { q1: ' docker ' } });
  await settle(engine, run); assert.equal(run.status, 'ready', JSON.stringify(run.events));
  assert.deepEqual(run.interactions[0].answers, { q1: 'docker' }); assert.equal(run.interactions[0].status, 'answered');
  assert.match(prompts[0], /OPERATOR INSTRUCTIONS \(standing rules[^\n]*\n- Prefer staging\.\n- Never use Prisma\.\n\nTICKET:/); assert.match(prompts[0], /Never run migrations or DDL/); assert.match(prompts[0], /Do not edit existing tests unless the ticket asks/);
  live.addInstruction(project.id, { text: 'Use the local docker db.' });
  const next = await live.followup(run.id, { input: 'Also rename the file' }); await settle(engine, next);
  assert.equal(next.status, 'ready'); assert.match(prompts.at(-1), /- Never use Prisma\.\n- Use the local docker db\.\n\nFOLLOW-UP:\nAlso rename the file/);
  assert.throws(() => live.addInstruction(project.id, { text: '  ' }), /Enter an instruction/);
  await assert.rejects(live.saveProject({ ...project, confirmed: true, instructions: Array.from({ length: 21 }, (_, index) => `rule ${index}`) }, project.id), /at most 20/);
  await assert.rejects(live.saveProject({ ...project, confirmed: true, instructions: ['x'.repeat(201)] }, project.id), /under 200 characters/);
  await assert.rejects(live.saveProject({ ...project, confirmed: true, trackRemote: 'yes' }, project.id), /Track remote/);
});
test('answers and follow-ups carry attached files to the agent by path', async t => {
  const prompts = [], answers = [], file = name => ({ name, data: Buffer.from(`${name} body`).toString('base64') });
  let asked = false;
  const { live, engine, project } = await fixture(t, async options => {
    prompts.push(options.prompt);
    if (!asked) { asked = true; answers.push(await options.onQuestion([{ id: 'q1', question: 'Which spec?' }])); }
    return completesWithFiles(options);
  });
  const run = await live.create({ projectId: project.id, input: 'Change the value' });
  await until(() => run.interactions?.some(item => item.status === 'pending'));
  assert.throws(() => live.interactions.answer(run.id, { requestId: run.interactions[0].id, answers: { q1: 'This one' }, files: [file('run.sh')] }), /supported documents/);
  live.interactions.answer(run.id, { requestId: run.interactions[0].id, answers: { q1: 'This one' }, files: [file('spec.md')] });
  await settle(engine, run); assert.equal(run.status, 'ready', JSON.stringify(run.events));
  assert.deepEqual(run.interactions[0].answers, { q1: 'This one' });
  const [spec] = JSON.parse(answers[0].answers.q1.answers[0].split('\n').at(-1));
  assert.equal(spec.name, 'spec.md'); assert.equal(readFileSync(spec.path, 'utf8'), 'spec.md body');
  assert.equal(run.artifacts.find(artifact => artifact.name === 'spec.md').check, 'Answer');
  const next = await live.followup(run.id, { input: 'Use this too', files: [file('notes.txt')] }); await settle(engine, next);
  assert.equal(next.status, 'ready', JSON.stringify(next.events));
  assert.equal(next.artifacts.find(artifact => artifact.source === 'context-file').check, 'Follow-up');
  assert.match(prompts.at(-1), /ATTACHED ORIGINAL FILES[^\n]*\n.*"notes\.txt".*"spec\.md"/);
});
test('runs carry stability flags and SQL to run from the tested diff, and protected paths are validated like check scopes', async t => {
  const { live, engine, project } = await fixture(t, async options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed'); mkdirSync(join(options.workspace, 'db'), { recursive: true });
    writeFileSync(join(options.workspace, 'db', '001.sql'), 'CREATE TABLE t (id int);\n'); writeFileSync(join(options.workspace, 'value.test.js'), 'x');
    return { outcome: 'completed', sessionId: 'session-1', summary: 'Done' };
  });
  await live.saveProject({ ...project, confirmed: true, protectedPaths: ['db/**', ' '] }, project.id);
  assert.deepEqual(live.projects[0].protectedPaths, ['db/**']);
  const run = await live.create({ projectId: project.id, input: 'Add a table' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events));
  assert.deepEqual(run.flags, { testsChanged: ['value.test.js'], sqlChanged: ['db/001.sql'], envChanged: [], lockfileChanged: [], protectedTouched: ['db/001.sql'] });
  assert.equal(run.sqlToRun, '-- db/001.sql\nCREATE TABLE t (id int);');
  await assert.rejects(live.saveProject({ ...project, confirmed: true, protectedPaths: ['**'] }, project.id), /matches every file/);
  await assert.rejects(live.saveProject({ ...project, confirmed: true, protectedPaths: 'db' }, project.id), /list of path patterns/);
});

test('an answer-only run reads the repository root read-only, ends ready with no worktree, checks, commit or notes, and cannot be diffed', async t => {
  const seen = [];
  const { live, engine, project, dir } = await fixture(t, async options => { if (!options.readOnly) return completesWithFiles(options); seen.push({ workspace: options.workspace, readOnly: options.readOnly, interactive: options.interactive, prompt: options.prompt }); return { outcome: 'completed', sessionId: 'answer-1', summary: 'The value lives in value.txt:1.' }; });
  const run = await live.create({ projectId: project.id, input: 'Where is the value stored?', kind: 'answer' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events)); assert.equal(run.kind, 'answer'); assert.equal(run.handoff, null); assert.deepEqual(run.checks, []); assert.equal(run.baseSha, undefined); assert.equal(run.branch, null);
  assert.deepEqual(seen.map(turn => [turn.workspace, turn.readOnly, turn.interactive]), [[project.repositoryPath, true, false]]); assert.match(seen[0].prompt, /Answer this question[\s\S]*QUESTION:\nWhere is the value stored\?/); assert.doesNotMatch(seen[0].prompt, /worktree/);
  assert.equal(run.summary, 'The value lives in value.txt:1.'); assert.match(run.events.at(-1).message, /Nothing was changed, checked or committed/);
  assert.equal(existsSync(join(dir, 'data', 'live-workspaces', run.id)), false); assert.equal(existsSync(join(dir, 'data', 'memory', project.id)), false);
  await assert.rejects(live.diff(run.id), /No live workspace/); await assert.rejects(live.removeWorktree(run.id), /no dispatch worktree/);
  await assert.rejects(live.create({ projectId: project.id, input: 'Another question', kind: 'plan' }), /change or answer/);
  const change = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, change); assert.equal(change.status, 'ready'); assert.equal(change.kind, 'change');
});
test('a finished worktree can be removed once its chain has stopped; the branch is deleted only when nothing unpushed remains', async t => {
  const { live, engine, project, repo } = await fixture(t);
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  const next = await live.followup(run.id, { input: 'Once more' }); await settle(engine, next);
  assert.ok(existsSync(run.workspace));
  await live.removeWorktree(run.id);
  assert.equal(existsSync(run.workspace), false); assert.ok(run.worktreeRemovedAt); assert.ok(next.worktreeRemovedAt); assert.equal(run.branchKept, true);
  assert.equal(await git(repo, ['rev-parse', '--verify', `refs/heads/${run.branch}`]), run.headSha);
  assert.ok(run.events.some(event => /Branch dispatch\/.* kept because it holds unpushed commits/.test(event.message)));
  await assert.rejects(live.followup(next.id, { input: 'Too late' }), /No resumable session/);
  const merged = await live.create({ projectId: project.id, input: 'Change the value again' }); await settle(engine, merged);
  await git(repo, ['merge', '--ff-only', merged.branch]);
  await live.removeWorktree(merged.id);
  assert.equal(merged.branchKept, false); await assert.rejects(git(repo, ['rev-parse', '--verify', `refs/heads/${merged.branch}`]));
  await assert.rejects(live.removeWorktree(merged.id), /no dispatch worktree|Stop the runs/).catch(() => {});
});
test('files the app writes during the browser smoke check are removed so the tested tree stays the candidate', async t => {
  const smoke = async ({ workspace }) => { writeFileSync(join(workspace, 'data.db'), 'sqlite'); mkdirSync(join(workspace, 'logs'), { recursive: true }); writeFileSync(join(workspace, 'logs', 'app.log'), 'started'); return { exitCode: 0, output: 'GET / → 200', timedOut: false, cancelled: false, durationMs: 5, artifacts: [] }; };
  const { live, engine, project } = await liveFixture(t, { behavior: completesWithFiles, services: { browserSmoke: smoke }, project: { validation: [{ id: 'browser-smoke', kind: 'browser-smoke' }] } });
  const run = await live.create({ projectId: project.id, input: 'Serve the value' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.slice(-3)));
  assert.equal(existsSync(join(run.workspace, 'data.db')), false); assert.equal(existsSync(join(run.workspace, 'logs', 'app.log')), false); assert.equal(existsSync(join(run.workspace, 'new.txt')), true);
  assert.ok(run.events.some(event => /removed 2 file\(s\) the app wrote while it ran: data\.db, logs\/app\.log/.test(event.message)));
  assert.deepEqual(run.checks.map(check => [check.name, check.status]), [['browser-smoke', 'passed']]);
});
test('the memory tool lists rules and notes, remembers agent notes and refuses to forget operator rules', async t => {
  const { live, engine, project } = await fixture(t, async (options, turn) => {
    if (turn === 1) {
      assert.deepEqual(await options.onMemory({ action: 'list' }), { rules: ['Never use Prisma'], notes: [] });
      assert.deepEqual(await options.onMemory({ action: 'remember', text: 'Seed the database before the unit check' }), { remembered: 'Seed the database before the unit check' });
      assert.deepEqual(await options.onMemory({ action: 'forget', text: 'prisma' }), { forgotten: [] });
      assert.deepEqual(await options.onMemory({ action: 'forget', text: 'seed database' }), { forgotten: ['Seed the database before the unit check'] });
      await assert.rejects(async () => options.onMemory({ action: 'remember' }), /text/);
    }
    writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Done\n\nNotes for next time:\n- Run npm ci first' };
  });
  live.addInstruction(project.id, { text: 'Never use Prisma' });
  const run = await live.create({ projectId: project.id, input: 'Use the memory tool' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events));
  assert.deepEqual(live.projects[0].instructions, ['Never use Prisma']);
  assert.deepEqual(live.brain.catalog({ projectId: project.id, kind: 'note' }).map(entry => [entry.text, entry.source, entry.origin.runId]), [['Run npm ci first', 'agent', run.id]]);
  assert.doesNotMatch(live.memory.readNotes(project.id), /Seed the database/);
});
test('a ready run leaves an ordered step log, a patch artifact that outlives the worktree, and correlated tool steps', async t => {
  const { live, engine, project, repo } = await fixture(t, async options => {
    options.onTool({ id: 'c1', name: 'command', phase: 'started', input: { command: 'ls' } });
    options.onTool({ id: 'c1', name: 'command', phase: 'completed', output: 'value.txt', isError: false });
    options.onTool({ id: 'd1', name: 'dispatch_memory', server: 'dispatch', phase: 'started', input: {} });
    options.onEvent('message', 'Working on it');
    return completesWithFiles(options);
  });
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'ready');
  const { steps, total } = await live.steps.read(run.id, { limit: 500 });
  assert.equal(total, run.stepCount);
  const kinds = steps.map(step => step.kind);
  assert.deepEqual(kinds.slice(0, 2), ['status', 'status']);
  for (const expected of ['turn.start', 'tool.call', 'tool.result', 'message', 'turn.end', 'files', 'patch', 'check.start', 'check.end', 'status']) assert.ok(kinds.includes(expected), expected);
  assert.ok(kinds.indexOf('turn.start') < kinds.indexOf('tool.call') && kinds.indexOf('tool.result') < kinds.indexOf('turn.end') && kinds.indexOf('files') < kinds.indexOf('check.start'));
  const call = steps.find(step => step.kind === 'tool.call'), result = steps.find(step => step.kind === 'tool.result');
  assert.equal(call.callId, 'c1'); assert.equal(result.callId, 'c1'); assert.deepEqual(call.input, { command: 'ls' });
  assert.ok(!steps.some(step => step.kind === 'tool.call' && step.name === 'dispatch_memory'));
  assert.deepEqual(steps.find(step => step.kind === 'turn.start').tools, ['dispatch_memory', 'dispatch_settings', 'dispatch_repository']);
  assert.ok(steps.find(step => step.kind === 'check.end').artifactIds.length === 0);
  const patch = run.artifacts.find(item => item.check === 'patch');
  assert.equal(patch.name, 'turn-1.patch'); assert.equal(patch.stepId, steps.find(step => step.kind === 'files').id);
  assert.equal(steps.at(-1).status, 'ready');
  await live.removeWorktree(run.id);
  const diff = await live.diff(run.id);
  assert.equal(diff.source, 'patch'); assert.match(diff.diff, /new\.txt/); assert.equal(diff.stale, false);
});
test('the dispatch browser is off unless the repository enables it; on, tool calls open it, start the app, record steps and stop before checks', async t => {
  const events = [], sessions = [];
  const jpeg = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(32, 1)]).toString('base64');
  const browserSession = () => { const session = { opened: null, closed: false, calls: [], open: async options => { session.opened = options; sessions.push(session); return session; }, call: async (op, args) => { session.calls.push([op, args]); return { url: 'http://127.0.0.1:1/', title: 'Fixture', snapshot: '- heading "Fixture"', consoleErrors: [], screenshot: jpeg }; }, close: async () => { session.closed = true; } }; return session; };
  const { live, engine, project } = await fixture(t, async (options, turn) => {
    events.push(options.tools?.list.map(tool => tool.name) ?? []);
    if (options.tools?.list.some(tool => tool.name === 'dispatch_browser_navigate')) {
      const result = await options.tools.call('dispatch_browser_navigate', { url: 'app:/' });
      events.push(result.isError ? result.content[0].text : 'navigated');
    }
    return completesWithFiles(options);
  });
  live.browserSession = browserSession;
  const off = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, off);
  assert.equal(off.status, 'ready'); assert.deepEqual(events, [['dispatch_memory', 'dispatch_settings', 'dispatch_repository']]); assert.equal(sessions.length, 0);
  writeFileSync(join(project.repositoryPath, 'package.json'), JSON.stringify({ scripts: { dev: `${process.execPath} -e "require('node:http').createServer((q,r)=>r.end('ok')).listen(process.env.PORT,'127.0.0.1');setInterval(()=>{},1000)"` } }));
  await git(project.repositoryPath, ['add', '.']); await git(project.repositoryPath, ['-c', 'user.name=T', '-c', 'user.email=t@localhost', 'commit', '-m', 'dev script']);
  await live.saveProject({ ...project, confirmed: true, browser: { enabled: true, headed: false } }, project.id);
  const on = await live.create({ projectId: project.id, input: 'Change the value again', browser: { headed: true } }); await settle(engine, on);
  assert.equal(on.status, 'ready', JSON.stringify(on.events));
  assert.ok(events[1].includes('dispatch_browser_navigate') && events[1].includes('dispatch_memory')); assert.equal(events[2], 'navigated');
  assert.equal(sessions.length, 1); assert.equal(sessions[0].opened.headless, false); assert.match(sessions[0].opened.profileDir, /browser-profiles/); assert.equal(sessions[0].closed, true);
  assert.deepEqual(sessions[0].calls.map(([op]) => op), ['navigate']); assert.match(sessions[0].calls[0][1].url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const shots = on.artifacts.filter(item => item.source === 'browser');
  assert.equal(shots.length, 1); assert.ok(shots[0].stepId);
  const { steps } = await live.steps.read(on.id, { limit: 500 });
  const browserStep = steps.find(step => step.kind === 'browser.step'), dev = steps.filter(step => step.kind === 'dev-server');
  assert.equal(browserStep.screenshotAfter, shots[0].id); assert.deepEqual(dev.map(step => step.phase), ['started', 'stopped']);
  assert.ok(Date.parse(on.devServer.stoppedAt) <= Date.parse(on.checks[0].startedAt)); assert.equal(on.devServerPid, null);
  assert.match(on.workerTurns[1]?.status ?? on.workerTurns[0].status, /completed/);
});

test('a worktree deleted outside dispatch is recorded on every run that shared it', async t => {
  const { live, engine, project, repo } = await liveFixture(t, { behavior: completesWithFiles });
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  const next = await live.followup(run.id, { input: 'Again' }); await settle(engine, next);
  const unstarted = await live.create({ projectId: project.id, input: 'Never started' }); engine.cancel(unstarted.id); await settle(engine, unstarted);
  live.reconcileWorktrees(); assert.equal(unstarted.worktreeRemovedAt, undefined); assert.equal(next.worktreeRemovedAt, undefined);
  await git(repo, ['worktree', 'remove', '--force', run.workspace]);
  live.reconcileWorktrees();
  for (const item of [run, next]) { assert.ok(item.worktreeRemovedAt); assert.match(item.events.at(-1).message, /removed outside dispatch/); }
});

test('a run whose repository browser profile is in use gets its own browser on a copied profile, removed when it closes', async t => {
  const root = join(tmpdir(), `dispatch-run-profile-${process.pid}-${Date.now()}`); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'project'), { recursive: true }); writeFileSync(join(root, 'project', 'Cookies'), 'session');
  const opened = [], logs = [];
  const stub = Object.assign(Object.create(LiveService.prototype), { profileRoot: root, browsers: new Map(), log: (run, kind, message) => logs.push(message) });
  stub.browserSession = () => ({ open: async ({ profileDir }) => { if (profileDir === join(root, 'project')) throw Object.assign(new Error('in use by PID 1'), { code: 'EPROFILELOCKED' }); opened.push(profileDir); return { close: async () => {} }; } });
  const run = { id: 'run-2', projectId: 'project', project: {} };
  await stub.browserFor(run);
  assert.deepEqual(opened, [join(root, '.runs', 'run-2')]); assert.equal(readFileSync(join(opened[0], 'Cookies'), 'utf8'), 'session'); assert.match(logs[0], /own profile/);
  await stub.closeBrowser(run);
  assert.equal(existsSync(opened[0]), false);
});

test('connector settings saved by an older version are cleaned at startup so the repository can still be saved', async t => {
  const { live, project } = await fixture(t);
  project.connectors = { example: false, exampleWriteback: false, github: { enabled: false, remote: 'origin', draft: true } };
  live.migrateConnectors();
  assert.deepEqual(project.connectors, { example: { enabled: false, actions: {}, settings: {} } });
  assert.deepEqual((await live.saveProject({ ...project, confirmed: true }, project.id)).connectors, project.connectors);
});
async function scriptsFixture(t) {
  const fixed = await fixture(t, async options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed'); writeFileSync(join(options.workspace, 'package.json'), JSON.stringify({ scripts: { test: 'node -e 0', postversion: 'git push --follow-tags' } }));
    return { outcome: 'completed', sessionId: 'session-1' };
  });
  writeFileSync(join(fixed.repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e 0' } }));
  await git(fixed.repo, ['add', '.']); await git(fixed.repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Scripts']);
  return fixed;
}
test('a script change blocks once and continuing the run accepts the new scripts', async t => {
  const { live, engine, project } = await scriptsFixture(t);
  const run = await live.create({ projectId: project.id, input: 'Push tags after npm version' }); await settle(engine, run);
  assert.equal(run.status, 'blocked'); assert.match(run.events.at(-1).message, /Validation scripts changed.*continue the run/);
  const next = await live.followup(run.id, { input: 'Go ahead' }); await settle(engine, next);
  assert.equal(next.status, 'ready', JSON.stringify(next.events)); assert.ok(next.events.some(event => /you continued the run, so they are now the protected baseline/.test(event.message)));
  const again = await live.followup(next.id, { input: 'Check again' }); await settle(engine, again);
  assert.equal(again.status, 'ready', JSON.stringify(again.events));
});
test('a repository that allows sensitive writes accepts script changes without blocking', async t => {
  const { live, engine, project } = await scriptsFixture(t);
  await live.saveProject({ ...project, confirmed: true, allowSensitiveFiles: true }, project.id);
  const run = await live.create({ projectId: project.id, input: 'Push tags after npm version' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events)); assert.ok(run.events.some(event => /allows writing sensitive files, so they are now the protected baseline/.test(event.message)));
});
