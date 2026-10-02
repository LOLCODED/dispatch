import test from 'node:test';
import assert from 'node:assert/strict';
import { browserReview } from '../src/browser-review.mjs';
import { validateBrowserArgs } from '../src/browser-tool.mjs';
import { DispatchToolCalls } from '../src/tool-calls.mjs';
import { Interactions } from '../src/interactions.mjs';
import { browserFrame, stepArtifacts } from '../web/lib/timeline.mjs';

const makeRun = () => ({ id: 'review', kind: 'change', status: 'implementing', attempt: 2, project: { memory: false, browser: { enabled: true } }, devServer: { url: 'http://127.0.0.1:4327/' }, artifacts: [
  { id: 'desktop', source: 'browser', mimeType: 'image/jpeg', attempt: 2 },
  { id: 'mobile', source: 'browser', mimeType: 'image/jpeg', attempt: 2 },
  { id: 'old', source: 'browser', mimeType: 'image/jpeg', attempt: 1 },
  { id: 'context', source: 'context', mimeType: 'image/jpeg', attempt: 2 },
] });
const input = () => ({ assessment: 'Matches the existing spacing; keyboard focus and hover work.', steps: 'Try the menu and send any changes.', screenshots: [{ id: 'desktop', caption: 'Desktop' }, { id: 'mobile', caption: 'Narrow viewport' }], appPath: '/settings?tab=appearance#theme' });

test('review preserves selected images, captions and local live-preview path', () => {
  const details = browserReview(makeRun(), input());
  assert.deepEqual(details.review.screenshots, input().screenshots);
  assert.equal(details.review.appUrl, 'http://127.0.0.1:4327/settings?tab=appearance#theme');
  assert.equal(details.source, 'browser-review');
  assert.equal(details.questions.length, 1);
});

test('review rejects missing, duplicate, foreign and old evidence and external preview URLs', () => {
  for (const screenshots of [[], Array(5).fill(input().screenshots[0]), [{ id: 'missing', caption: 'x' }], [{ id: 'old', caption: 'x' }], [{ id: 'context', caption: 'x' }], [{ id: 'desktop', caption: '' }], [input().screenshots[0], input().screenshots[0]]]) {
    assert.throws(() => browserReview(makeRun(), { ...input(), screenshots }), /screenshot|image/i);
  }
  for (const appPath of ['https://example.com', '//example.com', '/\\example.com', '/\n/evil', '']) assert.throws(() => browserReview(makeRun(), { ...input(), appPath }), /path/);
  assert.throws(() => browserReview({ ...makeRun(), devServer: null }, input()), /Open app/);
  assert.throws(() => browserReview({ ...makeRun(), devServer: { url: 'http://127.0.0.1:4327', stoppedAt: 'now' } }, input()), /Open app/);
  assert.throws(() => browserReview(makeRun(), { ...input(), assessment: ' ' }), /assessment/);
  assert.throws(() => browserReview(makeRun(), { ...input(), steps: 'x'.repeat(1001) }), /steps/);
  assert.equal(browserReview(makeRun(), { ...input(), appPath: undefined }).review.appUrl, undefined);
});

test('review offers the agent’s alternatives as choices instead of a yes/no verdict', () => {
  assert.deepEqual(browserReview(makeRun(), input()).questions[0].options.map(option => option.label), ['Looks good (Recommended)', 'Needs changes']);
  const options = [{ label: 'Design A (Recommended)', description: 'Inline hand-off panel.' }, { label: 'Design B' }, { label: 'Design C', description: 'Compact buttons.' }];
  const question = browserReview(makeRun(), { ...input(), options }).questions[0];
  assert.deepEqual(question.options, [options[0], { label: 'Design B', description: '' }, options[2]]);
  assert.match(question.question, /Which version/);
  for (const bad of [[], [options[0]], Array(5).fill(0).map((_, i) => ({ label: `D${i}` })), [options[0], options[0]], [options[0], { label: ' ' }], [options[0], { label: 'x'.repeat(81) }], 'Design A']) {
    assert.throws(() => browserReview(makeRun(), { ...input(), options: bad }), /option/i);
  }
});

function fixture() {
  const run = makeRun(), steps = [], controller = new AbortController();
  const live = { engine: { get: () => run, event() {}, store: { saveSoon() {} } }, steps: { append: (_, step) => { steps.push(step); return { id: String(steps.length) }; } }, browserCall() {}, browserEvidence: { attach: () => [] } };
  live.interactions = new Interactions(live);
  const calls = new DispatchToolCalls(live), tools = calls.tools(run, { questions: 'native' });
  return { run, steps, controller, live, calls, tools };
}

test('UI review pauses until feedback, keeps question evidence and resumes with the exact answer', async () => {
  const { run, steps, controller, live, calls, tools } = fixture();
  let finished = false;
  const result = calls.call(run, 'dispatch_browser_review', input(), { tools, signal: controller.signal }).then(value => { finished = true; return value; });
  await Promise.resolve();
  assert.equal(finished, false);
  const request = run.interactions[0];
  assert.equal(request.status, 'pending');
  const question = steps.find(step => step.kind === 'question');
  assert.deepEqual(stepArtifacts(question, run).map(item => item.id), ['desktop', 'mobile']);
  assert.deepEqual(question.review, request.review);
  assert.throws(() => live.interactions.answer(run.id, { requestId: 'stale', answers: {} }), /no longer pending/);
  live.interactions.answer(run.id, { requestId: request.id, answers: { 'browser-feedback': 'Make the menu keyboard accessible.' } });
  assert.equal(JSON.parse((await result).content[0].text).feedback, 'Make the menu keyboard accessible.');
  assert.equal(request.status, 'answered');
  assert.equal(live.interactions.pending.size, 0);
});

test('UI review cancellation and terminal runs cannot leave a pending request', async () => {
  const { run, controller, live, calls, tools } = fixture();
  const result = calls.call(run, 'dispatch_browser_review', input(), { tools, signal: controller.signal });
  controller.abort();
  assert.equal((await result).isError, true);
  assert.equal(run.interactions[0].status, 'cancelled');
  assert.equal(live.interactions.pending.size, 0);
  run.status = 'cancelled';
  assert.equal((await calls.call(run, 'dispatch_browser_review', input(), { tools, signal: new AbortController().signal })).isError, true);
  assert.equal(run.interactions.length, 1);
});

test('review attaches only to browser-enabled owners and is denied in read-only calls', async () => {
  const { run, calls, tools, controller } = fixture(), containsReview = list => list.some(tool => tool.name === 'dispatch_browser_review');
  assert.equal(containsReview(tools), true);
  assert.equal(containsReview(calls.tools(run, { questions: 'tool', readOnlyTools: true }, { readOnly: true })), false);
  assert.equal(containsReview(calls.tools({ ...run, kind: 'answer' }, { questions: 'native' })), false);
  assert.equal(containsReview(calls.tools({ ...run, project: { browser: { enabled: false } } }, { questions: 'tool' })), false);
  assert.equal((await calls.call(run, 'dispatch_browser_review', input(), { tools, signal: controller.signal, readOnly: true })).isError, true);
});

test('hover and viewport dimensions are validated before browser execution', () => {
  assert.deepEqual(validateBrowserArgs('dispatch_browser_hover', { ref: 'e42' }), { op: 'hover', args: { ref: 'e42' } });
  assert.throws(() => validateBrowserArgs('dispatch_browser_hover', { ref: 'button' }), /ref/);
  for (const [width, height] of [[319, 800], [2561, 800], [1280, 239], [1280, 1601], [NaN, 800], ['1280', 800], [375.5, 800]]) assert.throws(() => validateBrowserArgs('dispatch_browser_resize', { width, height }), /Viewport/);
  assert.equal(validateBrowserArgs('dispatch_browser_resize', { width: 375, height: 812 }).op, 'resize');
  for (const op of ['click', 'hover', 'type', 'select', 'wait', 'scroll']) assert.equal(validateBrowserArgs(`dispatch_browser_${op}`, { ref: 'f2e38', text: 'hello', values: [] }).args.ref, 'f2e38');
  assert.throws(() => validateBrowserArgs('dispatch_browser_wait', { ref: 'f2e38 >> button' }), /ref/);
});

test('history frames track selection, stay pinned as new steps arrive and never borrow future pixels', () => {
  const steps = [
    { seq: 1, screenshotAfter: 'home', turn: { attempt: 1 } },
    { seq: 2, turn: { attempt: 1 } },
    { seq: 3, screenshotAfter: 'settings', turn: { attempt: 1 } },
  ];
  assert.equal(browserFrame(steps).captured.screenshotAfter, 'settings');
  assert.equal(browserFrame(steps, 1).captured.screenshotAfter, 'home');
  assert.equal(browserFrame(steps, 2).selected.seq, 2);
  assert.equal(browserFrame(steps, 2).captured.screenshotAfter, 'home');
  assert.equal(browserFrame([...steps, { seq: 4, screenshotAfter: 'new', turn: { attempt: 1 } }], 1).captured.screenshotAfter, 'home');
  assert.equal(browserFrame([...steps, { seq: 4, turn: { attempt: 2 } }]).captured, undefined);
  assert.equal(browserFrame(steps, 99).captured, undefined);
  assert.equal(browserFrame([]).captured, undefined);
});
