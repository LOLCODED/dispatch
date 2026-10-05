import { runProcess } from './process.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { localEnvironment } from './local-tools.mjs';
import { freePort, resolveStart, startScripts, waitForUrl } from './browser-smoke.mjs';
import { logBuffer } from './services.mjs';

export async function prepareAppDependencies({ workspace, start, signal, execute = runProcess, onSpawn, timeoutMs = 300_000 }) {
  // Git worktrees do not include ignored dependencies. Install from the saved
  // npm lockfile before starting the app, including development tools like Vite.
  if (start.command === 'npm' && !existsSync(join(workspace, 'node_modules')) &&
      ['package-lock.json', 'npm-shrinkwrap.json'].some(name => existsSync(join(workspace, name)))) {
    const installed = await execute('npm', ['ci', '--include=dev'], {
      cwd: workspace, signal, timeoutMs: Math.min(timeoutMs, 300_000),
      inheritEnv: false, env: localEnvironment({ CI: '1', CODEX_HOME: '' }), maxOutput: 20000, onSpawn,
    });
    if (installed.exitCode !== 0 || installed.timedOut || installed.cancelled || signal?.aborted) {
      throw new Error(`Browser dependency setup (npm ci --include=dev) failed${installed.cancelled || signal?.aborted ? ': cancelled' : installed.timedOut ? ': timed out' : ` (code ${installed.exitCode})`}.\n${installed.output.slice(-2000)}`);
    }
  }
}

// Starts the repository's own dev script on a free port for the dispatch browser; stopped before checks run.
export async function startApp({ workspace, step = {}, env: extra = {}, signal, execute = runProcess, onSpawn, readyTimeoutMs = 60_000, timeoutMs = 3_600_000 }) {
  const port = await freePort(), start = resolveStart(step, workspace, port);
  if (!start) throw new Error(`No dev script (${startScripts.join(', ')}) in package.json; navigate to an absolute URL instead.`);
  await prepareAppDependencies({ workspace, start, signal, execute, onSpawn, timeoutMs });
  const url = `http://127.0.0.1:${port}/`, stop = new AbortController(), abort = () => stop.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const env = localEnvironment({ ...extra, PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none', CI: '1', CODEX_HOME: '' });
  const logs = logBuffer();
  const exited = execute(start.command, start.args, { cwd: workspace, signal: stop.signal, timeoutMs, inheritEnv: false, env, maxOutput: 20000, onSpawn, onStdout: logs.add, onStderr: logs.add });
  const command = [start.command, ...start.args].join(' ');
  const ready = await Promise.race([waitForUrl(url, readyTimeoutMs, stop.signal).then(status => ({ status })), exited.then(result => ({ exited: result }))]);
  if (ready.exited) { signal?.removeEventListener('abort', abort); throw new Error(`${command} exited (code ${ready.exited.exitCode}) before answering at ${url}.\n${ready.exited.output.slice(-2000)}`); }
  return { url, port, command, exited, logs: logs.read, stop: async () => { stop.abort(); signal?.removeEventListener('abort', abort); await exited; } };
}
