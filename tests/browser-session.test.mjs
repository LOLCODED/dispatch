import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserSession, displayEnvironment, seedProfile } from '../src/browser-session.mjs';

function host(handle) {
  const seen = [];
  const spawnProcess = (command, args, options) => {
    seen.push(args); seen.env = options.env;
    const child = new EventEmitter(); child.pid = 4242; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = [];
    child.kill = signal => { child.killed.push(signal); queueMicrotask(() => child.emit('close', 0)); };
    const emit = value => child.stdout.write(typeof value === 'string' ? value : JSON.stringify(value) + '\n');
    child.stdin = new Writable({ write(chunk, encoding, callback) { for (const line of chunk.toString().trim().split('\n')) { const request = JSON.parse(line); setTimeout(() => handle(request, emit, child), request.op === 'slow' ? 30 : 1); } callback(); } });
    return child;
  };
  return { spawnProcess, seen };
}
function dir(t) { const path = mkdtempSync(join(tmpdir(), 'dispatch-browser-session-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }

test('calls are serialized in order, errors carry what was observed, and close ends the process group', async t => {
  const order = [];
  const { spawnProcess, seen } = host((request, emit) => {
    order.push(request.op);
    if (request.op === 'launch') return emit({ id: request.id, ok: true, result: {} });
    if (request.op === 'click') return emit({ id: request.id, ok: false, error: 'stale ref', result: { url: 'http://x/' } });
    if (request.op === 'close') return emit({ id: request.id, ok: true, result: {} });
    emit({ id: request.id, ok: true, result: { op: request.op } });
  });
  const session = new BrowserSession({ spawnProcess });
  const profileDir = join(dir(t), 'profile');
  const originalKill = process.kill; const killed = [];
  process.kill = (pid, signal) => { if (pid === -4242) { killed.push(signal); return true; } return originalKill(pid, signal); };
  t.after(() => { process.kill = originalKill; });
  await session.open({ profileDir, headless: false });
  assert.ok(seen[0].includes('--headed') && seen[0].includes(profileDir)); assert.deepEqual(Object.entries(seen.env).filter(([name]) => name in displayEnvironment()), Object.entries(displayEnvironment())); assert.ok(existsSync(join(profileDir, 'dispatch.lock')));
  const results = await Promise.all([session.call('slow'), session.call('snapshot')]);
  assert.deepEqual(results.map(result => result.op), ['slow', 'snapshot']); assert.deepEqual(order, ['launch', 'slow', 'snapshot']);
  await assert.rejects(session.call('click', { ref: 'e1' }), error => error.message === 'stale ref' && error.observed.url === 'http://x/');
  await session.close();
  assert.ok(killed.includes('SIGTERM')); assert.equal(existsSync(join(profileDir, 'dispatch.lock')), false);
  await assert.rejects(session.call('snapshot'), /closed|not open/);
});

test('malformed host output fails every pending call closed and a live profile lock is refused', async t => {
  const { spawnProcess } = host((request, emit) => { if (request.op === 'launch') emit({ id: request.id, ok: true, result: {} }); else emit('not json\n'); });
  const session = new BrowserSession({ spawnProcess });
  const profileDir = join(dir(t), 'profile');
  await session.open({ profileDir });
  await assert.rejects(session.call('snapshot'), /malformed/);
  const other = new BrowserSession({ spawnProcess });
  const locked = join(dir(t), 'locked'); const { mkdirSync } = await import('node:fs'); mkdirSync(locked, { recursive: true }); writeFileSync(join(locked, 'dispatch.lock'), String(process.pid));
  await assert.rejects(other.open({ profileDir: locked }), /in use by PID/);
});

test('the display environment keeps only the variables a headed window needs', t => {
  assert.deepEqual(displayEnvironment({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XAUTHORITY: '/run/user/1000/xauth', XDG_RUNTIME_DIR: '/run/user/1000', SECRET: 'x' }), { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XAUTHORITY: '/run/user/1000/xauth', XDG_RUNTIME_DIR: '/run/user/1000' });
  assert.deepEqual(displayEnvironment({}), {});
});

test('a run profile is seeded from the repository profile without its locks or caches', async t => {
  const from = join(dir(t), 'repository'), to = join(dir(t), 'run');
  mkdirSync(join(from, 'Default', 'Code Cache'), { recursive: true });
  writeFileSync(join(from, 'Default', 'Cookies'), 'session'); writeFileSync(join(from, 'Default', 'Code Cache', 'x'), 'x');
  writeFileSync(join(from, 'dispatch.lock'), String(process.pid)); writeFileSync(join(from, 'SingletonLock'), 'host-1');
  await seedProfile(from, to);
  assert.equal(existsSync(join(to, 'Default', 'Cookies')), true);
  for (const skipped of ['dispatch.lock', 'SingletonLock', join('Default', 'Code Cache')]) assert.equal(existsSync(join(to, skipped)), false, skipped);
  const locked = new BrowserSession({ spawnProcess: host(() => {}).spawnProcess });
  await assert.rejects(locked.open({ profileDir: from }), error => error.code === 'EPROFILELOCKED');
});
