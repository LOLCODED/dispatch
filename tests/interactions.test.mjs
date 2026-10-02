import test from 'node:test';
import assert from 'node:assert/strict';
import { Interactions, latestScreenshot } from '../src/interactions.mjs';

const shot = (id, capturedAt, extra = {}) => ({ id, source: 'browser', mimeType: 'image/jpeg', attempt: 1, capturedAt, ...extra });

test('latest screenshot is the newest browser image of this attempt since the last question', () => {
  const run = { attempt: 1, interactions: [{ createdAt: '2026-09-30T10:00:00.000Z' }], artifacts: [
    shot('before-question', '2026-09-30T09:59:00.000Z'),
    shot('agent', '2026-09-30T10:01:00.000Z', { source: 'agent' }),
    shot('latest', '2026-09-30T10:02:00.000Z'),
    shot('patch', '2026-09-30T10:03:00.000Z', { mimeType: 'text/x-patch' }),
    shot('check', '2026-09-30T10:04:00.000Z', { source: undefined }),
  ] };
  assert.equal(latestScreenshot(run).id, 'latest');
  assert.equal(latestScreenshot({ ...run, attempt: 2 }), null);
  assert.equal(latestScreenshot({ attempt: 1, interactions: [{ createdAt: '2026-09-30T11:00:00.000Z' }], artifacts: run.artifacts }), null);
});

test('a question carries the latest browser screenshot to the operator', async () => {
  const steps = [], run = { id: 'run', status: 'running', attempt: 1, artifacts: [shot('preview', '2026-09-30T10:00:00.000Z')] };
  const live = { engine: { event() {}, store: { saveSoon() {} } }, steps: { append: (_, step) => steps.push(step) } };
  const interactions = new Interactions(live), controller = new AbortController();
  const pending = interactions.request(run, { kind: 'question', questions: [{ id: 'q1', question: 'Looks right?' }] }, controller.signal);
  assert.equal(run.interactions[0].screenshotId, 'preview');
  assert.equal(steps[0].screenshotId, 'preview');
  controller.abort();
  await assert.rejects(pending);
});
