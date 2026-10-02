import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { root } from './app-assets.mjs';
import { localEnvironment } from './local-tools.mjs';

const hostScript = join(root, 'scripts', 'browser-host.mjs');
const maxBuffer = 8_000_000, opTimeoutMs = 20_000;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };

function lock(profileDir) {
  const path = join(profileDir, 'dispatch.lock');
  if (existsSync(path)) { const pid = Number(readFileSync(path, 'utf8')); if (Number.isInteger(pid) && pid > 0 && alive(pid)) throw Object.assign(new Error(`The browser profile is in use by PID ${pid}.`), { code: 'EPROFILELOCKED' }); }
  writeFileSync(path, String(process.pid), { mode: 0o600 });
  return () => { try { if (readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path); } catch { /* Lock already gone. */ } };
}

const notCopied = name => /^Singleton|^dispatch\.lock$|cache$/i.test(name);
export async function seedProfile(from, to) {
  await rm(to, { recursive: true, force: true });
  try { await cp(from, to, { recursive: true, filter: source => !notCopied(source.split(/[\\/]/).pop()) }); }
  catch { await rm(to, { recursive: true, force: true }); }
}

const displayVariables = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR'];
export const displayEnvironment = (env = process.env) => Object.fromEntries(displayVariables.filter(name => env[name]).map(name => [name, env[name]]));

// One Chromium per run, owned by dispatch (network on, outside every CLI sandbox), with a persistent profile per repository.
export class BrowserSession {
  constructor({ spawnProcess = spawn, script = hostScript } = {}) { this.spawnProcess = spawnProcess; this.script = script; this.pending = new Map(); this.nextId = 0; this.child = null; this.queue = Promise.resolve(); this.closed = false; this.unlock = null; }
  async open({ profileDir, headless = true, signal }) {
    mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    this.unlock = lock(profileDir);
    const args = [this.script, '--profile', profileDir, ...(headless ? [] : ['--headed'])];
    this.child = this.spawnProcess(process.execPath, args, { cwd: root, env: localEnvironment(headless ? {} : displayEnvironment()), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    this.pid = this.child.pid ?? null;
    this.listen();
    signal?.addEventListener('abort', () => { this.close().catch(() => {}); }, { once: true });
    await this.call('launch', {}, { timeoutMs: 60_000 });
    return this;
  }
  listen() {
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    this.child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      if (buffer.length > maxBuffer) { this.fail(new Error('Browser host output exceeded the buffer limit.')); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message; try { message = JSON.parse(line); } catch { this.fail(new Error('Browser host returned malformed output.')); return; }
        const waiting = this.pending.get(message.id); if (!waiting) continue;
        this.pending.delete(message.id); clearTimeout(waiting.timer);
        if (message.ok) waiting.resolve(message.result ?? {}); else waiting.reject(Object.assign(new Error(message.error ?? 'Browser action failed.'), { observed: message.result ?? {} }));
      }
    });
    this.child.stderr?.on('data', () => {});
    this.child.on('error', error => this.fail(error));
    this.child.on('close', () => this.fail(new Error('The dispatch browser closed.')));
  }
  fail(error) {
    this.closed = true;
    for (const waiting of this.pending.values()) { clearTimeout(waiting.timer); waiting.reject(error); }
    this.pending.clear(); this.unlock?.(); this.unlock = null;
  }
  call(op, args = {}, { timeoutMs = opTimeoutMs } = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (this.closed || !this.child) { reject(new Error('The dispatch browser is not open.')); return; }
      const id = ++this.nextId, timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Browser ${op} timed out.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, op, args }) + '\n', error => { if (error) { this.pending.delete(id); clearTimeout(timer); reject(error); } });
    });
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }
  async close() {
    if (!this.child || this.closed) return;
    try { await this.call('close', {}, { timeoutMs: 5000 }); } catch { /* Host may already be gone. */ }
    this.kill('SIGTERM'); setTimeout(() => this.kill('SIGKILL'), 2000).unref();
    this.fail(new Error('The dispatch browser closed.'));
  }
  kill(signal) { try { if (process.platform !== 'win32' && this.child?.pid) process.kill(-this.child.pid, signal); else this.child?.kill(signal); } catch { /* Process group already gone. */ } }
}
