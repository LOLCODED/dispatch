import { createServer } from 'node:net';
import { get } from 'node:http';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runProcess } from './process.mjs';
import { localEnvironment } from './local-tools.mjs';
import { root } from './app-assets.mjs';

export const startScripts = ['dev', 'preview', 'start', 'serve'];
export const defaultCaptureScript = join(root, 'scripts', 'browser-smoke.mjs');
const installHint = 'Chromium is missing: run `npx playwright install chromium` in the dispatch checkout.';

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.unref(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

export function resolveStart(step, workspace, port) {
  if (step.start) return { command: step.start.command, args: step.start.args, script: null };
  const file = join(workspace, 'package.json');
  const scripts = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).scripts ?? {} : {};
  const script = startScripts.find(name => typeof scripts[name] === 'string');
  if (!script) return null;
  // Vite ignores PORT; its CLI flags are the only way to pin the port and host.
  const vite = /\bvite\b/.test(scripts[script]);
  return { command: 'npm', args: ['run', script, ...(vite ? ['--', '--port', String(port), '--strictPort', '--host', '127.0.0.1'] : [])], script };
}

export function waitForUrl(url, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      if (signal?.aborted) return reject(new Error('Cancelled while waiting for the app to answer.'));
      if (Date.now() > deadline) return reject(new Error(`The app did not answer at ${url} within ${Math.round(timeoutMs / 1000)} s.`));
      const request = get(url, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', () => setTimeout(attempt, 250)); request.setTimeout(2000, () => request.destroy());
    };
    attempt();
  });
}

const favicon = entry => /\/favicon\.ico(\?|$)/.test(entry.url ?? '') || /favicon\.ico/.test(entry.text ?? '');
export function smokeVerdict(report, capture) {
  const reasons = [];
  if (!report) return { passed: false, reasons: [`Browser capture did not report: ${capture?.output?.trim().slice(-600) || 'no output'}${/executable doesn't exist|browserType\.launch/i.test(capture?.output ?? '') ? ` ${installHint}` : ''}`] };
  if (report.error) reasons.push(`Browser capture failed: ${report.error}${/executable doesn't exist|browserType\.launch/i.test(report.error) ? ` ${installHint}` : ''}`);
  if (report.status === null || report.status === undefined) reasons.push('The page did not respond.');
  else if (report.status >= 400) reasons.push(`The page responded with HTTP ${report.status}.`);
  for (const error of report.pageErrors ?? []) reasons.push(`Page error: ${error}`);
  for (const error of (report.consoleErrors ?? []).filter(entry => !favicon(entry))) reasons.push(`Console error: ${error.text}${error.url ? ` (${error.url})` : ''}`);
  return { passed: reasons.length === 0, reasons };
}

function parseReport(output) {
  const line = output.trim().split('\n').findLast(item => item.startsWith('{'));
  try { return line ? JSON.parse(line) : null; } catch { return null; }
}

const failure = (started, output, cancelled = false) => ({ exitCode: 1, output, timedOut: false, cancelled, durationMs: Date.now() - started, artifacts: [] });

export async function runBrowserSmoke({ step, workspace, signal, screenshotDir, onSpawn, execute = runProcess, captureScript = defaultCaptureScript }) {
  const started = Date.now(), port = await freePort(), start = resolveStart(step, workspace, port);
  if (!start) return failure(started, `browser-smoke: no start script (${startScripts.join(', ')}) in package.json; add one or set "start" on the step.`);
  const url = step.url.replace('{port}', String(port)), stop = new AbortController(), abort = () => stop.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const env = localEnvironment({ PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none', CI: '1', CODEX_HOME: '' });
  const server = execute(start.command, start.args, { cwd: workspace, signal: stop.signal, timeoutMs: step.timeoutSeconds * 1000, inheritEnv: false, env, maxOutput: 20000, onSpawn });
  const command = [start.command, ...start.args].join(' ');
  try {
    const ready = await Promise.race([waitForUrl(url, step.readyTimeoutSeconds * 1000, stop.signal).then(status => ({ status })), server.then(result => ({ exited: result }))]);
    if (ready.exited) return failure(started, `${command} exited (code ${ready.exited.exitCode}) before answering at ${url}.\n${ready.exited.output.slice(-4000)}`, ready.exited.cancelled);
    mkdirSync(screenshotDir, { recursive: true });
    const screenshot = join(screenshotDir, `${randomUUID()}.png`), remaining = Math.max(5000, step.timeoutSeconds * 1000 - (Date.now() - started));
    const capture = await execute(process.execPath, [captureScript, '--url', url, '--screenshot', screenshot, '--timeout', String(Math.min(remaining, 30000))], { cwd: root, signal: stop.signal, timeoutMs: remaining, inheritEnv: false, env: localEnvironment(), maxOutput: 50000 });
    const report = parseReport(capture.output), verdict = smokeVerdict(report, capture);
    const summary = [`Started ${command} on ${url} (ready in ${((Date.now() - started) / 1000).toFixed(1)} s).`, report ? `GET / → ${report.status ?? 'no response'} ${JSON.stringify(report.title ?? '')}. ${report.pageErrors?.length ?? 0} page errors, ${(report.consoleErrors ?? []).filter(entry => !favicon(entry)).length} console errors.` : '', report?.screenshot ? 'Screenshot saved.' : 'No screenshot.', ...verdict.reasons];
    return { exitCode: verdict.passed ? 0 : 1, output: summary.filter(Boolean).join('\n'), timedOut: false, cancelled: Boolean(signal?.aborted), durationMs: Date.now() - started, artifacts: report?.screenshot && existsSync(screenshot) ? [{ path: screenshot, name: `${step.id}.png` }] : [] };
  } catch (error) {
    return failure(started, `browser-smoke: ${error.message}`, Boolean(signal?.aborted));
  } finally {
    stop.abort(); signal?.removeEventListener('abort', abort);
    await server;
  }
}
