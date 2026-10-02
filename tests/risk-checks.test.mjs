import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { riskLevel, riskSettings, minimumChecks, optionalChecks, landingChecks } from '../src/risk-policy.mjs';
import { formFromProject, blankForm, projectPayload } from '../web/lib/project-form.mjs';
import { liveFixture, settle, until, unitCheck } from './live-double.mjs';
import { DispatchToolCalls } from '../src/tool-calls.mjs';
import { git } from '../src/local-tools.mjs';
import { terminal as stopped } from '../src/catalog.mjs';

const terminal = run => stopped.has(run.status);

const lint = { id: 'lint', command: process.execPath, args: ['-e', ''] };
const policy = (mode = 'agent') => ({ mode, minimumChecks: { low: ['lint'], medium: [], high: ['unit'] }, guidance: 'Shared helpers affect registration and sign-in.' });
const completed = { outcome: 'completed', sessionId: 'session-1', summary: 'Updated' };
const parse = result => { assert.equal(result.isError, false, result.content[0].text); return JSON.parse(result.content[0].text); };
async function assess(options, patch = {}) {
  const view = parse(await options.tools.call('dispatch_risk', { action: 'inspect' }));
  return parse(await options.tools.call('dispatch_risk', { action: 'submit', revision: view.revision, likelihood: 'low', impact: 'low', confidence: 'confident', checks: [], workflows: 'Documentation only', reason: 'Only prose changed; lint is sufficient. Unit workflows are unaffected.', ...patch }));
}
async function fixture(t, behavior, risk = policy()) {
  return liveFixture(t, { behavior, project: { validation: [lint, unitCheck], risk } });
}

test('risk matrix, minimums, settings validation and form round trips', () => {
  assert.equal(riskLevel('low', 'high'), 'medium'); assert.equal(riskLevel('high', 'medium'), 'high');
  assert.throws(() => riskLevel('unlikely', 'high'));
  assert.deepEqual(minimumChecks(policy(), 'high'), ['lint', 'unit']);
  assert.deepEqual(optionalChecks(policy(), ['lint', 'unit']), ['unit']); assert.deepEqual(optionalChecks(policy(), ['lint']), []);
  assert.equal(riskSettings(undefined, []).mode, 'off'); assert.equal(blankForm().risk.mode, 'agent');
  assert.throws(() => riskSettings({ ...policy(), minimumChecks: { high: ['missing'] } }, [lint]), /configured checks/);
  assert.throws(() => riskSettings({ mode: 'surprise' }, [lint]), /mode/);
  assert.throws(() => riskSettings({ ...policy(), guidance: 'x'.repeat(2001) }, [lint, unitCheck]), /2,000/);
  const project = { repositoryPath: '/repo', validation: [lint, unitCheck], setup: [], risk: policy('ask') };
  assert.deepEqual(projectPayload(formFromProject(project), '/repo').risk, policy('ask'));
  assert.deepEqual(landingChecks(policy(), ['lint', 'unit']), ['lint', 'unit']);
  assert.deepEqual(riskSettings({ ...policy(), landingChecks: ['unit', 'unit'] }, [lint, unitCheck]).landingChecks, ['unit']);
  assert.throws(() => riskSettings({ ...policy(), landingChecks: ['missing'] }, [lint, unitCheck]), /Landing checks/);
  const landed = formFromProject({ ...project, risk: { ...policy(), landingChecks: ['lint', 'unit'] } });
  assert.deepEqual(projectPayload({ ...landed, validation: [lint] }, '/repo').risk.landingChecks, ['lint']);
});

test('risk tools are absent when disabled or read-only', () => {
  const tools = new DispatchToolCalls({});
  const names = (risk, readOnly = false) => tools.tools({ project: { risk, memory: false } }, { questions: 'native' }, { readOnly }).map(tool => tool.name);
  assert.deepEqual(names(undefined), []); assert.deepEqual(names({ mode: 'off' }), []);
  assert.deepEqual(names(policy(), true), []); assert.deepEqual(names(policy()), ['dispatch_risk']);
});

test('agent plan skips unrelated checks, enforces minimums and exposes revision-bound audit', async t => {
  const { live, engine, project } = await fixture(t, async options => {
    assert.match(options.prompt, /RISK-BASED VERIFICATION/);
    writeFileSync(join(options.workspace, 'notes.md'), 'New prose');
    const result = await assess(options); assert.deepEqual(result.checks, ['lint']); return completed;
  });
  const run = await live.create({ projectId: project.id, input: 'Update prose' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events));
  assert.deepEqual(run.checks.map(check => [check.name, check.status]), [['unit', 'skipped'], ['lint', 'passed']]);
  assert.equal(run.riskSelection.revision, run.revision); assert.equal(run.riskAssessments[0].status, 'agent');
  const [audit] = live.brainCatalog({}).riskDecisions;
  assert.equal(audit.used, true); assert.equal(audit.runId, run.id); assert.equal(audit.level, 'low');
  assert.match(run.checks[0].output, /risk assessment/);
});

test('high risk cannot omit configured minimums', async t => {
  const { live, engine, project } = await fixture(t, async options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    const result = await assess(options, { likelihood: 'high', impact: 'high' });
    assert.deepEqual(result.checks, ['lint', 'unit']); return completed;
  });
  const run = await live.create({ projectId: project.id, input: 'Change shared workflow' }); await settle(engine, run);
  assert.equal(run.status, 'ready'); assert.ok(run.checks.every(check => check.status === 'passed'));
});

test('missing or stale assessments run all checks even when a path shortcut skips them', async t => {
  for (const stale of [false, true]) {
    const { live, engine, project } = await fixture(t, async options => {
      writeFileSync(join(options.workspace, 'value.txt'), 'changed');
      if (stale) { await assess(options); writeFileSync(join(options.workspace, 'notes.md'), 'Changed after assessment'); }
      return completed;
    });
    project.checkScopes = [{ id: 'text', paths: ['*.txt', '*.md'], checks: [] }];
    const run = await live.create({ projectId: project.id, input: 'Change value' }); await settle(engine, run);
    assert.equal(run.status, 'ready'); assert.equal(run.riskSelection.status, 'fallback');
    assert.deepEqual(run.checks.map(check => check.status), ['passed', 'passed']);
    assert.ok(live.brainCatalog({}).riskDecisions.some(item => item.status === 'fallback'));
  }
});

test('unknown check IDs are rejected; missing assessment cannot turn this into a skipped pass', async t => {
  const { live, engine, project } = await fixture(t, async options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    const view = parse(await options.tools.call('dispatch_risk', { action: 'inspect' }));
    const result = await options.tools.call('dispatch_risk', { action: 'submit', revision: view.revision, likelihood: 'low', impact: 'low', confidence: 'confident', checks: ['arbitrary shell'] });
    assert.equal(result.isError, true); assert.match(result.content[0].text, /configured check IDs/); return completed;
  });
  const run = await live.create({ projectId: project.id, input: 'Change value' }); await settle(engine, run);
  assert.equal(run.status, 'ready'); assert.equal(run.riskSelection.status, 'fallback');
});

for (const mode of ['ask', 'uncertain', 'manual']) test(`${mode} requires an explicit operator answer`, async t => {
  const { live, engine, project } = await fixture(t, async options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    await assess(options, mode === 'uncertain' ? { confidence: 'uncertain' } : mode === 'manual' ? { manualReview: 'Check registration in the live browser.' } : {}); return completed;
  }, policy(mode === 'ask' ? 'ask' : 'agent'));
  const run = await live.create({ projectId: project.id, input: 'Change value' });
  await until(() => live.interactions.pending.has(run.id));
  assert.deepEqual(run.checks, []); assert.equal(run.riskAssessments[0].status, 'proposed');
  const request = run.interactions.at(-1), answer = request.questions[0].options[0].label;
  live.interactions.answer(run.id, { requestId: request.id, answers: { risk: answer } });
  await settle(engine, run); assert.equal(run.status, 'ready', JSON.stringify(run.events));
  assert.equal(run.riskAssessments[0].status, 'operator');
  assert.equal(run.riskAssessments[0].manualReviewPassed === true, mode === 'manual');
});

test('a turn that ends while the plan awaits the operator waits for the answer before checks', async t => {
  let submitted;
  const { live, engine, project } = await fixture(t, async options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    const view = parse(await options.tools.call('dispatch_risk', { action: 'inspect' }));
    submitted = options.tools.call('dispatch_risk', { action: 'submit', revision: view.revision, likelihood: 'low', impact: 'low', confidence: 'confident', checks: [], workflows: 'Value file', reason: 'One value changed.', manualReview: 'Open the page.' });
    return completed;
  });
  const run = await live.create({ projectId: project.id, input: 'Change value' });
  await until(() => live.interactions.pending.has(run.id) && run.workerTurns.at(-1)?.finishedAt);
  assert.equal(terminal(run), false); assert.deepEqual(run.checks, []);
  const request = run.interactions.at(-1);
  live.interactions.answer(run.id, { requestId: request.id, answers: { risk: request.questions[0].options[0].label } });
  await settle(engine, run); assert.equal(run.status, 'ready', JSON.stringify(run.events));
  assert.equal(run.riskAssessments[0].status, 'operator'); assert.equal(parse(await submitted).status, 'operator');
});

test('a question left open when the run stops is cancelled, not offered', async t => {
  const { live, engine, project } = await fixture(t, async options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    const view = parse(await options.tools.call('dispatch_risk', { action: 'inspect' }));
    void options.tools.call('dispatch_risk', { action: 'submit', revision: view.revision, likelihood: 'low', impact: 'low', confidence: 'uncertain', checks: [], workflows: 'Value file', reason: 'One value changed.' });
    await until(() => live.interactions.pending.has(engine.runs[0].id));
    return { outcome: 'blocked', sessionId: 'session-1', summary: 'DISPATCH_BLOCKED: Need direction.' };
  });
  const run = await live.create({ projectId: project.id, input: 'Change value' }); await settle(engine, run);
  assert.equal(run.status, 'blocked'); assert.equal(live.interactions.pending.has(run.id), false);
  assert.equal(run.interactions.at(-1).status, 'cancelled');
  assert.throws(() => live.interactions.answer(run.id, { requestId: run.interactions.at(-1).id, answers: { risk: 'Use suggested checks' } }), /no longer pending/);
});

test('operator can require all checks and a change during approval invalidates selection', async t => {
  for (const mutate of [false, true]) {
    const { live, engine, project } = await fixture(t, async options => {
      writeFileSync(join(options.workspace, 'value.txt'), 'changed'); await assess(options); return completed;
    }, policy('ask'));
    const run = await live.create({ projectId: project.id, input: 'Change value' });
    await until(() => live.interactions.pending.has(run.id));
    if (mutate) writeFileSync(join(run.workspace, 'extra.txt'), 'edited during approval');
    const request = run.interactions.at(-1);
    live.interactions.answer(run.id, { requestId: request.id, answers: { risk: 'Run all configured checks' } });
    if (mutate) {
      await until(() => live.interactions.pending.has(run.id) && run.interactions.at(-1).id !== request.id);
      const fallback = run.interactions.at(-1);
      live.interactions.answer(run.id, { requestId: fallback.id, answers: { risk: fallback.questions[0].options[0].label } });
    }
    await settle(engine, run); assert.equal(run.status, 'ready');
    assert.equal(run.riskAssessments[0].status, mutate ? 'stale' : 'all-checks');
    assert.deepEqual(run.checks.map(check => check.status), ['passed', 'passed']);
  }
});

test('declined or free-text answers block even if the agent finishes successfully', async t => {
  for (const answer of ['Revise the plan', 'Please add coverage for shared authentication.']) {
    const { live, engine, project } = await fixture(t, async options => {
      writeFileSync(join(options.workspace, 'value.txt'), 'changed'); await assess(options); return completed;
    }, policy('ask'));
    const run = await live.create({ projectId: project.id, input: 'Change value' });
    await until(() => live.interactions.pending.has(run.id));
    live.interactions.answer(run.id, { requestId: run.interactions.at(-1).id, answers: { risk: answer } });
    await settle(engine, run); assert.equal(run.status, 'blocked'); assert.equal(run.handoff, null); assert.deepEqual(run.checks, []);
  }
});

test('cancelling an unanswered assessment cannot publish', async t => {
  const { live, engine, project } = await fixture(t, async options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    await assess(options); return completed;
  }, policy('ask'));
  const run = await live.create({ projectId: project.id, input: 'Change value' });
  await until(() => live.interactions.pending.has(run.id)); await engine.cancel(run.id); await settle(engine, run);
  assert.equal(run.status, 'cancelled'); assert.equal(run.handoff, null); assert.equal(run.riskAssessments[0].status, 'cancelled');
});

test('repairs cannot evade a previously failed check by selecting fewer checks', async t => {
  const { live, engine, project } = await fixture(t, async (options, turn) => {
    writeFileSync(join(options.workspace, 'value.txt'), turn === 1 ? 'bad' : 'changed');
    await assess(options, { checks: turn === 1 ? ['unit'] : [] }); return completed;
  });
  const run = await live.create({ projectId: project.id, input: 'Change value' }); await settle(engine, run);
  assert.equal(run.status, 'ready'); assert.equal(run.attempt, 2);
  assert.ok(run.checks.some(check => check.name === 'unit' && check.attempt === 2 && check.status === 'passed'));
});

test('follow-ups require a new assessment even on an identical tree', async t => {
  const { live, engine, project } = await fixture(t, async (options, turn) => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    if (turn === 1) await assess(options); return completed;
  });
  const run = await live.create({ projectId: project.id, input: 'Change value' }); await settle(engine, run);
  const next = await live.followup(run.id, { input: 'Check again' }); await settle(engine, next);
  assert.equal(next.status, 'ready'); assert.equal(next.riskSelection.status, 'fallback');
  assert.ok(next.checks.some(check => check.name === 'unit' && check.status === 'passed'));
});

test('rejection survives edits during approval and a replacement plan still asks', async t => {
  let returned = 0;
  const { live, engine, project } = await fixture(t, async options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    const first = await assess(options, { confidence: 'uncertain' });
    assert.equal(first.status, 'rejected'); returned++;
    await assess(options); return completed;
  });
  const run = await live.create({ projectId: project.id, input: 'Change value' });
  await until(() => live.interactions.pending.has(run.id));
  writeFileSync(join(run.workspace, 'extra.txt'), 'edited while deciding');
  live.interactions.answer(run.id, { requestId: run.interactions.at(-1).id, answers: { risk: 'Revise the plan' } });
  await until(() => returned === 1 && live.interactions.pending.has(run.id));
  assert.equal(run.riskAssessments.at(-1).status, 'proposed');
  live.interactions.answer(run.id, { requestId: run.interactions.at(-1).id, answers: { risk: 'Run all configured checks' } });
  await settle(engine, run); assert.equal(run.status, 'ready'); assert.equal(run.riskAssessments[0].status, 'rejected');
  assert.ok(run.checks.every(check => check.status === 'passed'));
});

test('approval with attached evidence uses the exact saved answer', async t => {
  const { live, engine, project } = await fixture(t, async options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed'); await assess(options); return completed;
  }, policy('ask'));
  const original = live.interactions.request.bind(live.interactions);
  live.interactions.request = async (...args) => {
    const answer = await original(...args); answer.answers.risk.answers[0] += '\nATTACHED FILE: review.png'; return answer;
  };
  const run = await live.create({ projectId: project.id, input: 'Change value' });
  await until(() => live.interactions.pending.has(run.id));
  const request = run.interactions.at(-1);
  live.interactions.answer(run.id, { requestId: request.id, answers: { risk: request.questions[0].options[0].label } });
  await settle(engine, run); assert.equal(run.status, 'ready'); assert.equal(run.riskAssessments[0].status, 'operator');
});

test('always-ask also requires approval for a missing assessment fallback', async t => {
  for (const allow of [true, false]) {
    const { live, engine, project } = await fixture(t, options => {
      writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return completed;
    }, policy('ask'));
    const run = await live.create({ projectId: project.id, input: 'Change value' });
    await until(() => live.interactions.pending.has(run.id));
    assert.deepEqual(run.checks, []);
    const request = run.interactions.at(-1);
    live.interactions.answer(run.id, { requestId: request.id, answers: { risk: allow ? request.questions[0].options[0].label : 'Revise the plan' } });
    await settle(engine, run); assert.equal(run.status, allow ? 'ready' : 'blocked');
    assert.equal(run.riskSelection.approval, allow ? 'operator' : 'rejected');
    assert.equal(live.brainCatalog({}).riskDecisions[0].used, allow);
  }
});

test('a landing runs the repository landing checks without asking, even in always-ask mode', async t => {
  const { live, engine, project, repo } = await fixture(t, async options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'changed'); await assess(options); return completed;
  });
  const task = await live.create({ projectId: project.id, input: 'Change value' }); await settle(engine, task);
  assert.equal(task.status, 'ready');
  Object.assign(project.risk, { mode: 'ask', landingChecks: ['unit'] });
  const landing = await live.landings.create({ runIds: [task.id] });
  await settle(engine, landing);
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.map(event => event.message)));
  assert.equal(live.interactions.pending.has(landing.id), false); assert.deepEqual(landing.interactions ?? [], []);
  assert.deepEqual(landing.checks.map(check => [check.name, check.status]), [['lint', 'skipped'], ['unit', 'passed']]);
  assert.equal(await git(repo, ['rev-parse', 'main']), landing.headSha);
  assert.ok(landing.events.some(event => event.message === 'Skipped by landing checks: lint.'), JSON.stringify(landing.events.map(event => event.message)));
});
