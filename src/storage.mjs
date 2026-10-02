import { existsSync } from 'node:fs';
import { lstat, readdir, rm, statfs } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { InputError } from './engine.mjs';
import { terminal } from './catalog.mjs';
import { conversationTree } from './conversations.mjs';
import { conversationKey } from './board-state.mjs';
import { alive } from './live.mjs';
import { purgeAges, purgeScopes, purgeTargets } from './storage-plan.mjs';

const areas = { 'live-workspaces': 'worktrees', 'live-artifacts': 'evidence', 'live-logs': 'logs', 'live-steps': 'logs', 'browser-profiles': 'browser', shadow: 'snapshots', memory: 'records', 'state.json': 'records', 'server.lock': 'records' };
const areaLabels = { worktrees: 'Worktrees', evidence: 'Images and evidence', logs: 'Logs', browser: 'Browser profiles', snapshots: 'Folder snapshots', records: 'Task records and memory', other: 'Other' };
const perRun = new Set(['live-workspaces', 'live-artifacts', 'live-logs', 'live-steps']);
const runIdLength = 36;

async function diskBytes(path) {
  let info; try { info = await lstat(path); } catch { return 0; }
  const own = info.blocks === undefined ? info.size : info.blocks * 512;
  if (!info.isDirectory()) return own;
  let entries; try { entries = await readdir(path); } catch { return own; }
  const sizes = await Promise.all(entries.map(entry => diskBytes(join(path, entry))));
  return sizes.reduce((sum, size) => sum + size, own);
}
async function entrySizes(directory) {
  let entries; try { entries = await readdir(directory); } catch { return []; }
  return Promise.all(entries.map(async name => ({ name, bytes: await diskBytes(join(directory, name)) })));
}
function removeWhere(list, predicate) {
  for (let index = list.length - 1; index >= 0; index--) if (predicate(list[index])) list.splice(index, 1);
}

// Measures and frees dispatch's data directory. Repository memory and saved repositories are never removed here.
export class Storage {
  constructor(live) { this.live = live; this.engine = live.engine; this.dataDir = resolve(this.engine.dataDir); this.scanning = null; }
  usage() {
    this.scanning ??= this.measure().finally(() => { this.scanning = null; });
    return this.scanning;
  }
  async measure() {
    const totals = new Map(), sizes = new Map();
    const count = (area, bytes) => totals.set(area, (totals.get(area) ?? 0) + bytes);
    for (const name of await readdir(this.dataDir).catch(() => [])) {
      const area = areas[name] ?? 'other';
      if (!perRun.has(name)) { count(area, await diskBytes(join(this.dataDir, name))); continue; }
      for (const entry of await entrySizes(join(this.dataDir, name))) {
        const id = entry.name.slice(0, runIdLength), run = sizes.get(id) ?? { bytes: 0, worktreeBytes: 0 };
        run.bytes += entry.bytes; if (area === 'worktrees') run.worktreeBytes += entry.bytes;
        sizes.set(id, run); count(area, entry.bytes);
      }
    }
    const disk = await statfs(this.dataDir).catch(() => null);
    const categories = Object.keys(areaLabels).filter(id => totals.has(id)).map(id => ({ id, label: areaLabels[id], bytes: totals.get(id) }));
    const tasks = this.conversations().map(chain => this.summary(chain, sizes)).sort((a, b) => b.bytes - a.bytes);
    return { dataDir: this.dataDir, totalBytes: categories.reduce((sum, item) => sum + item.bytes, 0), freeBytes: disk ? disk.bavail * disk.bsize : null, categories, tasks };
  }
  conversations() { return conversationTree(this.engine.runs.filter(run => run.mode === 'live')); }
  finished(chain) { return chain.every(run => terminal.has(run.status) && !this.engine.active.has(run.id) && !alive(run.workerPid)); }
  hasWorktree(run) { return run.kind !== 'answer' && Boolean(run.workspace?.startsWith(this.live.workspaceRoot + sep)) && existsSync(run.workspace); }
  summary(chain, sizes = new Map()) {
    const latest = chain.at(-1), measured = chain.map(run => sizes.get(run.id) ?? { bytes: 0, worktreeBytes: 0 });
    const lastActivityAt = chain.map(run => run.finishedAt ?? run.createdAt).filter(Boolean).sort().at(-1) ?? null;
    return { id: chain[0].id, latestId: latest.id, title: latest.title, status: latest.status, kind: chain[0].kind ?? 'change', project: chain[0].project?.name ?? null, finished: this.finished(chain), worktree: this.hasWorktree(chain[0]), lastActivityAt, bytes: measured.reduce((sum, item) => sum + item.bytes, 0), worktreeBytes: measured.reduce((sum, item) => sum + item.worktreeBytes, 0) };
  }
  chainOf(id) {
    const chain = this.conversations().find(runs => runs.some(run => run.id === id));
    if (!chain) throw new InputError('Task not found', 404);
    return chain;
  }
  async release(chain) {
    for (const run of chain) { await this.live.stopDevServer(run); await this.live.closeBrowser(run); this.live.browserEvidence.forget(run); }
  }
  async removeWorktree(root) {
    if (!this.hasWorktree(root)) return;
    try { await this.live.removeWorktree(root.id); } catch (error) {
      if (error instanceof InputError || existsSync(root.project.repositoryPath)) throw error;
      await rm(root.workspace, { recursive: true, force: true });
    }
  }
  async removeRunFiles(chain) {
    const ids = new Set(chain.map(run => run.id)), logs = await readdir(this.live.logRoot).catch(() => []);
    await Promise.all([
      ...chain.flatMap(run => [rm(this.live.browserEvidence.directory(run), { recursive: true, force: true }), rm(this.live.steps.path(run.id), { force: true })]),
      ...logs.filter(name => ids.has(name.slice(0, runIdLength))).map(name => rm(join(this.live.logRoot, name), { force: true })),
    ]);
  }
  forget(chain) {
    const ids = new Set(chain.map(run => run.id)), taskIds = new Set(chain.map(run => run.taskId).filter(Boolean)), state = this.engine.store.state;
    removeWhere(state.runs, run => ids.has(run.id));
    removeWhere(state.tasks, task => taskIds.has(task.id));
    delete state.board.items[conversationKey(chain[0])];
  }
  async deleteChain(chain) {
    if (!this.finished(chain)) throw new InputError('Stop this task before deleting it.', 409);
    await this.release(chain);
    await this.removeWorktree(chain[0]);
    await this.removeRunFiles(chain);
    this.forget(chain);
  }
  async deleteTask(id) {
    if (this.engine.stopping) throw new InputError('Server is stopping', 503);
    await this.deleteChain(this.chainOf(id));
    this.engine.store.save();
    return { deleted: 1 };
  }
  async purge({ scope, olderThanDays = 0 } = {}) {
    if (this.engine.stopping) throw new InputError('Server is stopping', 503);
    if (!purgeScopes.includes(scope)) throw new InputError(`Purge scope must be one of ${purgeScopes.join(', ')}.`);
    if (!purgeAges.includes(olderThanDays)) throw new InputError(`Age must be one of ${purgeAges.join(', ')} days.`);
    const chains = new Map(this.conversations().map(chain => [chain[0].id, chain]));
    const targets = purgeTargets([...chains.values()].map(chain => this.summary(chain)), { scope, olderThanDays });
    const failed = [];
    for (const target of targets) {
      const chain = chains.get(target.id);
      try { if (scope === 'tasks') await this.deleteChain(chain); else { await this.release(chain); await this.removeWorktree(chain[0]); } } catch (error) { failed.push({ id: target.id, title: target.title, message: error.message }); }
    }
    this.engine.store.save();
    return { removed: targets.length - failed.length, failed };
  }
  async clearBrowserProfiles() {
    if (this.live.browsers.size) throw new InputError('Close the dispatch browsers in use before clearing their profiles.', 409);
    const entries = await readdir(this.live.profileRoot).catch(() => []);
    await Promise.all(entries.map(name => rm(join(this.live.profileRoot, name), { recursive: true, force: true })));
    return { cleared: entries.length };
  }
}
