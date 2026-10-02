import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

// Playwright and similar tools start helpers in their own process groups; a group signal alone leaves them running.
export function descendants(root) {
  if (process.platform !== 'linux') return [];
  const children = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try { const stat = readFileSync(`/proc/${name}/stat`, 'utf8'); const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]); (children.get(ppid) ?? children.set(ppid, []).get(ppid)).push(Number(name)); } catch {}
  }
  const found = [], queue = [root];
  while (queue.length) { const pid = queue.shift(); for (const child of children.get(pid) ?? []) { found.push(child); queue.push(child); } }
  return found;
}

// Commands originate in trusted code, not tickets or HTTP request bodies.
// Keep full logs bounded and terminate the process group, including browser children.
export function runProcess(command, args, { cwd, signal, timeoutMs = 60_000, maxOutput = 100_000, env = {}, inheritEnv = true, input, onStdout, onStderr, onSpawn } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ exitCode: null, output: 'Cancelled before start.', cancelled: true, durationMs: 0 });
    const started = Date.now();
    let output = '', timedOut = false, cancelled = false, killTimer;
    const owned = new Set();
    const childEnv = { ...(inheritEnv ? process.env : {}), FORCE_COLOR: '0', ...env };
    // A parent node:test worker's IPC context must not leak into independent
    // validation processes: it can suppress their normal test discovery.
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(command, args, { cwd, shell: false, detached: process.platform !== 'win32', env: childEnv, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const append = (chunk) => { output = (output + chunk.toString()).slice(-maxOutput); };
    child.stdout.on('data', chunk => { append(chunk); onStdout?.(chunk); });
    child.stderr.on('data', chunk => { append(chunk); onStderr?.(chunk); });
    child.on('spawn', () => onSpawn?.(child.pid));
    if (child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    const kill = (sig) => {
      if (child.pid) for (const pid of descendants(child.pid)) owned.add(pid);
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, sig); else child.kill(sig); } catch (error) { if (error.code !== 'ESRCH') append(String(error)); }
      for (const pid of owned) { try { process.kill(pid, sig); } catch {} }
    };
    const stop = () => { kill('SIGTERM'); killTimer ??= setTimeout(() => kill('SIGKILL'), 1000); killTimer.unref(); };
    const abort = () => { cancelled = true; stop(); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = timeoutMs == null ? undefined : setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.on('error', (error) => append(error.message));
    child.on('close', (code) => {
      // A leader can exit on SIGTERM while a child with ignored stdio keeps
      // running. Finish stopping the owned group before dropping escalation.
      if (cancelled || timedOut) kill('SIGKILL');
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      resolve({ exitCode: code, output, timedOut, cancelled, durationMs: Date.now() - started });
    });
  });
}
