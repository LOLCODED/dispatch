import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runProcess } from './process.mjs';

const checkEveryMs = 6 * 60 * 60 * 1000, firstCheckMs = 30_000, gitTimeoutMs = 30_000, staleMs = 10 * 60 * 1000;
const key = version => version.split('.').map(Number);
const compare = (a, b) => { const [x, y] = [key(a), key(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

export function latestTag(tags) {
  const versions = tags.split('\n').map(tag => tag.trim()).filter(tag => /^v\d+\.\d+\.\d+$/.test(tag));
  return versions.sort((a, b) => compare(b.slice(1), a.slice(1)))[0] ?? null;
}

export const releaseAfter = (current, tags) => { const latest = latestTag(tags)?.slice(1); return latest && compare(latest, current) > 0 ? latest : null; };
const tagNames = output => output.split('\n').map(line => line.split('\t')[1]?.replace(/^refs\/tags\//, '') ?? '').join('\n');
const xml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The service files `dispatch install` writes; a checkout run with npm start or npm run dev has none pointing at it.
export function installedService(root, { platform = process.platform, home = homedir(), read = path => readFileSync(path, 'utf8') } = {}) {
  const [file, line] = platform === 'darwin'
    ? [join(home, 'Library', 'LaunchAgents', 'dev.dispatch.server.plist'), `<key>WorkingDirectory</key><string>${xml(root)}</string>`]
    : [join(home, '.config', 'systemd', 'user', 'dispatch.service'), `WorkingDirectory=${root}`];
  try { return read(file).split('\n').some(text => text.trim() === line); } catch { return false; }
}

// Tells the installed service that a newer release tag exists on the checkout it was installed from; updating stays `dispatch update`.
export class Updates {
  constructor({ root, version, execute = runProcess, installed = installedService(resolve(root)) }) {
    this.root = resolve(root); this.version = version; this.execute = execute; this.installed = installed;
    this.latest = null; this.checkedAt = null; this.error = null;
  }
  status() { return { current: this.version, latest: this.latest, checkedAt: this.checkedAt, error: this.error, installed: this.installed }; }
  // Opening the page reads tags again once the last check is stale, so a release tagged after a check shows without waiting hours.
  async fresh({ now = Date.now() } = {}) {
    const age = this.checkedAt ? now - Date.parse(this.checkedAt) : Infinity;
    return this.installed && age >= staleMs ? this.check() : this.status();
  }
  async check({ signal } = {}) {
    if (!this.installed) return this.status();
    const result = await this.execute('git', ['ls-remote', '--tags', '--refs', 'origin'], { cwd: this.root, signal, timeoutMs: gitTimeoutMs });
    if (result.exitCode !== 0) this.error = `Could not read release tags: ${result.output.trim().slice(-300)}`;
    else { this.latest = releaseAfter(this.version, tagNames(result.output)); this.error = null; }
    this.checkedAt = new Date().toISOString();
    return this.status();
  }
  schedule() {
    if (!this.installed) return () => {};
    const tick = () => this.check().catch(error => { this.error = error.message; });
    const first = setTimeout(tick, firstCheckMs), every = setInterval(tick, checkEveryMs);
    first.unref?.(); every.unref?.();
    return () => { clearTimeout(first); clearInterval(every); };
  }
}
