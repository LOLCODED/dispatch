import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { freePort, resolveStart, runBrowserSmoke, smokeVerdict, waitForUrl } from '../src/browser-smoke.mjs';
import { runProcess } from '../src/process.mjs';

const step = { id: 'browser-smoke', kind: 'browser-smoke', url: 'http://127.0.0.1:{port}/', timeoutSeconds: 20, readyTimeoutSeconds: 10 };
const serveScript = "import { createServer } from 'node:http'; createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<title>Fixture</title>'); }).listen(Number(process.env.PORT), '127.0.0.1'); setInterval(() => {}, 1000);";
function workspace(t, scripts, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-smoke-'));
  if (scripts) writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const fakeCapture = (dir, report) => { const path = join(dir, 'capture.mjs'); writeFileSync(path, `import { writeFileSync } from 'node:fs'; const at = process.argv.indexOf('--screenshot'); const report = ${JSON.stringify(report)}; if (report.screenshot) writeFileSync(process.argv[at + 1], Buffer.from([137, 80, 78, 71])); console.log(JSON.stringify({ ...report, url: process.argv[process.argv.indexOf('--url') + 1] })); process.exit(report.error ? 1 : 0);`); return path; };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('start resolution prefers dev, then preview, start and serve, pins Vite to the port, and honours an explicit start', t => {
  const port = 4321;
  assert.equal(resolveStart(step, workspace(t, { build: 'vite build' }), port), null);
  assert.equal(resolveStart(step, workspace(t, null), port), null);
  assert.deepEqual(resolveStart(step, workspace(t, { start: 'node server.mjs', preview: 'vite preview' }), port), { command: 'npm', args: ['run', 'preview', '--', '--port', '4321', '--strictPort', '--host', '127.0.0.1'], script: 'preview' });
  assert.deepEqual(resolveStart(step, workspace(t, { serve: 'node serve.mjs', dev: 'node dev.mjs' }), port), { command: 'npm', args: ['run', 'dev'], script: 'dev' });
  assert.deepEqual(resolveStart({ ...step, start: { command: 'python3', args: ['-m', 'http.server'] } }, workspace(t, null), port), { command: 'python3', args: ['-m', 'http.server'], script: null });
});

test('verdicts fail on capture errors, error statuses, page errors and console errors, but ignore a missing favicon', () => {
  assert.equal(smokeVerdict({ status: 200, pageErrors: [], consoleErrors: [{ text: 'Failed to load resource: 404', url: 'http://127.0.0.1:1/favicon.ico' }] }).passed, true);
  assert.match(smokeVerdict(null, { output: "browserType.launch: Executable doesn't exist" }).reasons[0], /npx playwright install chromium/);
  assert.match(smokeVerdict({ status: 500, pageErrors: [], consoleErrors: [] }).reasons[0], /HTTP 500/);
  assert.match(smokeVerdict({ status: null, pageErrors: [], consoleErrors: [] }).reasons[0], /did not respond/);
  assert.match(smokeVerdict({ status: 200, pageErrors: ['boom'], consoleErrors: [] }).reasons[0], /Page error: boom/);
  assert.match(smokeVerdict({ status: 200, pageErrors: [], consoleErrors: [{ text: 'Uncaught TypeError', url: 'http://127.0.0.1:1/app.js' }] }).reasons[0], /Console error: Uncaught TypeError/);
  assert.match(smokeVerdict({ status: 200, pageErrors: [], consoleErrors: [], error: 'page.goto: net::ERR_CONNECTION_REFUSED' }).reasons[0], /Browser capture failed/);
});

test('waitForUrl resolves once the app answers and rejects when it never does', async () => {
  const port = await freePort(), controller = new AbortController();
  const server = runProcess(process.execPath, ['-e', serveScript.replace("Number(process.env.PORT)", String(port))], { signal: controller.signal, inheritEnv: false, env: { PATH: process.env.PATH } });
  assert.equal(await waitForUrl(`http://127.0.0.1:${port}/`, 5000), 200);
  controller.abort(); await server;
  await assert.rejects(waitForUrl(`http://127.0.0.1:${await freePort()}/`, 600), /did not answer/);
});

test('a smoke run starts the app, captures a screenshot, reports the verdict and stops the process group', async t => {
  const dir = workspace(t, { dev: 'node serve.mjs' }, { 'serve.mjs': serveScript }), shots = join(dir, 'shots');
  const pids = [];
  const result = await runBrowserSmoke({ step, workspace: dir, screenshotDir: shots, onSpawn: pid => pids.push(pid), captureScript: fakeCapture(dir, { status: 200, title: 'Fixture', pageErrors: [], consoleErrors: [], screenshot: true }) });
  assert.equal(result.exitCode, 0, result.output); assert.match(result.output, /Started npm run dev on http:\/\/127\.0\.0\.1:\d+\/ .*\nGET \/ → 200 "Fixture"\. 0 page errors, 0 console errors\.\nScreenshot saved\./);
  assert.equal(result.artifacts.length, 1); assert.equal(result.artifacts[0].name, 'browser-smoke.png'); assert.ok(existsSync(result.artifacts[0].path));
  assert.equal(pids.length, 1); for (let i = 0; i < 50 && alive(pids[0]); i++) await sleep(20); assert.equal(alive(pids[0]), false);
  const failed = await runBrowserSmoke({ step, workspace: dir, screenshotDir: shots, captureScript: fakeCapture(dir, { status: 200, title: 'Fixture', pageErrors: ['boom'], consoleErrors: [], screenshot: true }) });
  assert.equal(failed.exitCode, 1); assert.match(failed.output, /Page error: boom/); assert.equal(failed.artifacts.length, 1);
});

test('a smoke run fails closed without a start script, when the app exits early, and when cancelled', async t => {
  const none = await runBrowserSmoke({ step, workspace: workspace(t, { build: 'x' }), screenshotDir: join(tmpdir(), 'unused') });
  assert.equal(none.exitCode, 1); assert.match(none.output, /no start script \(dev, preview, start, serve\)/); assert.deepEqual(none.artifacts, []);
  const exits = await runBrowserSmoke({ step, workspace: workspace(t, { dev: 'node -e "process.exit(3)"' }), screenshotDir: join(tmpdir(), 'unused') });
  assert.equal(exits.exitCode, 1); assert.match(exits.output, /exited \(code 3\) before answering/);
  const controller = new AbortController(); setTimeout(() => controller.abort(), 200);
  const cancelled = await runBrowserSmoke({ step: { ...step, readyTimeoutSeconds: 5 }, workspace: workspace(t, { dev: 'node -e "setInterval(()=>{},1000)"' }), signal: controller.signal, screenshotDir: join(tmpdir(), 'unused') });
  assert.equal(cancelled.exitCode, 1); assert.equal(cancelled.cancelled, true);
});
