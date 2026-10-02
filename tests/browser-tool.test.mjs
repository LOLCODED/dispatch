import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserCall, validateBrowserArgs } from '../src/browser-tool.mjs';
import { BrowserEvidence } from '../src/browser-evidence.mjs';
import { StepLog } from '../src/steps.mjs';

const jpeg = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(64, 1)]).toString('base64');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-browser-tool-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [], run = { id: 'run-1', attempt: 1, artifacts: [], kind: 'change' };
  const session = { call: async (op, args) => { calls.push([op, args]); if (op === 'click' && args.ref === 'e99') throw Object.assign(new Error('Ref e99 is not on the current page'), { observed: { url: 'http://x/', title: 'X', screenshot: jpeg, consoleErrors: [] } }); return { url: 'http://x/', title: 'X', snapshot: '- button "Save" [ref=e1]', consoleErrors: [{ type: 'error', text: 'boom' }], target: { x: 1, y: 2, width: 3, height: 4 }, screenshot: jpeg, ...(op === 'screenshot' ? { image: jpeg } : {}) }; } };
  const logs = [];
  return { dir, run, calls, session, evidence: new BrowserEvidence(dir), steps: new StepLog(dir), logs, log: (kind, message) => logs.push([kind, message]), resolveUrl: async url => `http://127.0.0.1:4444${url.replace(/^app:\/?/, '/')}` };
}

test('browser arguments are validated before anything reaches the browser', () => {
  assert.deepEqual(validateBrowserArgs('dispatch_browser_navigate', { url: ' app:/login ' }), { op: 'navigate', args: { url: 'app:/login' } });
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x', '']) assert.throws(() => validateBrowserArgs('dispatch_browser_navigate', { url: bad }), /http/);
  assert.throws(() => validateBrowserArgs('dispatch_browser_click', { ref: '12' }), /e12/);
  assert.throws(() => validateBrowserArgs('dispatch_browser_type', { ref: 'e1', text: 'x'.repeat(4001) }), /4,000/);
  assert.throws(() => validateBrowserArgs('dispatch_browser_press', { key: 'Enter; rm' }), /letters/);
  assert.throws(() => validateBrowserArgs('dispatch_browser_wait', { ms: 99999 }), /30,000/);
  assert.equal(validateBrowserArgs('dispatch_browser_snapshot', {}).op, 'snapshot');
});

test('each call becomes a step with its screenshot, the app: URL resolves through the dev server, and errors keep the step', async t => {
  const { run, calls, session, evidence, steps, log, resolveUrl, logs } = fixture(t);
  const navigated = await browserCall({ run, name: 'dispatch_browser_navigate', args: { url: 'app:/login' }, session, resolveUrl, evidence, steps, log });
  assert.deepEqual(calls[0], ['navigate', { url: 'http://127.0.0.1:4444/login' }]);
  assert.match(navigated.content[0].text, /^http:\/\/x\/ — X\nConsole errors: boom\n- button "Save" \[ref=e1\]$/);
  const { steps: recorded } = await steps.read(run.id);
  assert.equal(recorded[0].kind, 'browser.step'); assert.equal(recorded[0].tool, 'dispatch_browser_navigate'); assert.deepEqual(recorded[0].target, { x: 1, y: 2, width: 3, height: 4 });
  assert.equal(run.artifacts[0].source, 'browser'); assert.equal(run.artifacts[0].stepId, recorded[0].id); assert.equal(recorded[0].screenshotAfter, run.artifacts[0].id); assert.equal(run.artifacts[0].mimeType, 'image/jpeg');
  const shot = await browserCall({ run, name: 'dispatch_browser_screenshot', args: {}, session, resolveUrl, evidence, steps, log });
  assert.equal(shot.content[0].type, 'image'); assert.equal(shot.artifactIds.length, 1); assert.equal(run.artifacts.length, 3);
  await assert.rejects(browserCall({ run, name: 'dispatch_browser_click', args: { ref: 'e99' }, session, resolveUrl, evidence, steps, log }), /not on the current page/);
  const after = await steps.read(run.id);
  assert.equal(after.steps.at(-1).error, 'Ref e99 is not on the current page'); assert.ok(after.steps.at(-1).screenshotAfter);
  assert.equal(logs.length, 0);
});
