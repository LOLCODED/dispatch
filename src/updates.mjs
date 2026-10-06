import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { InputError } from './engine.mjs';
import { runProcess } from './process.mjs';

const checkEveryMs = 6 * 60 * 60 * 1000, firstCheckMs = 30_000, gitTimeoutMs = 30_000;
const working = new Set(['starting', 'waiting', 'building', 'restarting']);
const key = version => version.split('.').map(Number);
const newer = (a, b) => { const [x, y] = [key(a), key(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

export function latestTag(tags) {
  const versions = tags.split('\n').map(tag => tag.trim()).filter(tag => /^v\d+\.\d+\.\d+$/.test(tag));
  return versions.sort((a, b) => newer(b.slice(1), a.slice(1)))[0] ?? null;
}

export const releaseAfter = (current, tags) => { const latest = latestTag(tags)?.slice(1); return latest && newer(latest, current) > 0 ? latest : null; };
const tagNames = output => output.split('\n').map(line => line.split('\t')[1]?.replace(/^refs\/tags\//, '') ?? '').join('\n');

// An updater that died mid-way leaves its last stage behind; the transient unit being gone tells that apart from one still working.
export function progressView(record, { version, running, startedAt = 0 }) {
  if (!record) return null;
  // A failed update never restarts dispatch, so a failure older than this process was already seen by the one before it.
  if (record.stage === 'failed' && Date.parse(record.at) < startedAt) return null;
  if (record.stage === 'restarting' && record.version === `v${version}`) return { stage: 'done', version, at: record.at };
  if (working.has(record.stage) && !running) return { stage: 'failed', message: 'The update stopped before it finished. Run dispatch update in a terminal to see why.', at: record.at };
  return record;
}

// Only the installed service updates itself: it runs from a release checkout that a user service starts, and asks systemd to run the update outside its own process group, which the restart stops.
export class Updates {
  constructor({ root, version, dataDir, env = process.env, platform = process.platform, execute = runProcess, home = homedir() }) {
    this.root = resolve(root); this.version = version; this.statusFile = join(dataDir, 'update.json');
    this.env = env; this.platform = platform; this.execute = execute; this.home = home;
    this.latest = null; this.checkedAt = null; this.error = null; this.startedAt = Date.now();
  }
  get service() {
    const name = this.env.DISPATCH_SERVICE ?? 'dispatch';
    if (this.platform !== 'linux' || !/^[a-z][a-z0-9-]{0,40}$/.test(name)) return null;
    const unit = join(this.home, '.config', 'systemd', 'user', `${name}.service`);
    try { return readFileSync(unit, 'utf8').split('\n').some(line => line.trim() === `WorkingDirectory=${this.root}`) ? name : null; } catch { return null; }
  }
  installRoot() { return dirname(this.root); }
  async check({ signal } = {}) {
    if (!this.service) return this.status();
    const result = await this.execute('git', ['ls-remote', '--tags', '--refs', 'origin'], { cwd: this.root, signal, timeoutMs: gitTimeoutMs });
    if (result.exitCode !== 0) this.error = `Could not read release tags: ${result.output.trim().slice(-300)}`;
    else { this.latest = releaseAfter(this.version, tagNames(result.output)); this.error = null; }
    this.checkedAt = new Date().toISOString();
    return this.status();
  }
  schedule() {
    const tick = () => this.check().catch(error => { this.error = error.message; });
    const first = setTimeout(tick, firstCheckMs), every = setInterval(tick, checkEveryMs);
    first.unref?.(); every.unref?.();
    return () => { clearTimeout(first); clearInterval(every); };
  }
  readProgress() { try { return JSON.parse(readFileSync(this.statusFile, 'utf8')); } catch { return null; } }
  async running() {
    const result = await this.execute('systemctl', ['--user', 'is-active', `${this.service}-update`], { timeoutMs: 10_000 });
    return result.output.trim() === 'active' || result.output.trim() === 'activating';
  }
  async status() {
    const service = this.service, record = this.readProgress();
    const progress = service && record ? progressView(record, { version: this.version, running: await this.running(), startedAt: this.startedAt }) : null;
    return { current: this.version, latest: this.latest, checkedAt: this.checkedAt, error: this.error, installed: Boolean(service), progress };
  }
  async start() {
    const service = this.service;
    if (!service) throw new InputError('Only the installed dispatch service can update itself. Run dispatch update in a terminal.', 409);
    if (await this.running()) throw new InputError('An update is already running.', 409);
    const defaultRoot = join(this.home, '.local', 'share', 'dispatch'), dir = this.installRoot() === defaultRoot ? [] : ['--dir', this.installRoot()];
    const args = ['--user', `--unit=${service}-update`, '--collect', '--quiet', `--setenv=PORT=${this.env.PORT ?? 4317}`, `--setenv=PATH=${this.env.PATH ?? ''}`, process.execPath, join(this.root, 'bin', 'dispatch.mjs'), 'update', '--service', service, '--status', this.statusFile, ...dir];
    writeFileSync(this.statusFile, `${JSON.stringify({ stage: 'starting', at: new Date().toISOString() })}\n`);
    const result = await this.execute('systemd-run', args, { timeoutMs: 30_000 });
    if (result.exitCode !== 0) { const message = `Could not start the update: ${result.output.trim().slice(-300)}`; writeFileSync(this.statusFile, `${JSON.stringify({ stage: 'failed', message, at: new Date().toISOString() })}\n`); throw new InputError(message, 500); }
    return this.status();
  }
}
