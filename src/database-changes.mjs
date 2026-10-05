import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { perTask } from './task-databases.mjs';
import { normalizeChanges } from './table-changes.mjs';

const maxSnapshot = 16_000_000;

// Shows what a run changed in its task's own database: the provider takes a snapshot, then compares the database with it.
// Shared and hosted databases are never snapshotted. A snapshot can hold row data, so it stays in a private file beside the task database's.
export class DatabaseChanges {
  constructor(live) { this.live = live; }

  get tasks() { return this.live.taskDatabases; }
  root() { return join(this.tasks.root, 'snapshots'); }
  file(id) { return join(this.root(), `${id}.json`); }
  folder(id) { return join(this.root(), id); }

  supported(project) {
    const settings = perTask(project);
    if (!settings) return false;
    return settings.provider === 'commands' ? Boolean(settings.snapshot) : this.live.connectors.allows(project, settings.provider, 'database.snapshot');
  }

  usable(run) {
    const saved = this.tasks.saved(run);
    if (!saved) throw new Error('This task has no database of its own yet; call dispatch_database reset to create it.');
    if (!this.supported(run.project)) throw new Error('This repository’s task database cannot show changes; the operator can turn them on under Extras › Databases.');
    return saved;
  }

  async snapshot(run, since, signal) {
    const saved = this.usable(run), settings = perTask(run.project);
    let snapshot = null;
    if (settings.provider === 'commands') {
      const folder = this.folder(saved.task.id);
      rmSync(folder, { recursive: true, force: true }); mkdirSync(folder, { recursive: true, mode: 0o700 });
      await this.tasks.command(run, settings.snapshot, this.values(saved), saved.env, signal);
    } else snapshot = (await this.live.connectors.invoke(run.project, settings.provider, 'database.snapshot', [this.input(run, saved)], { signal }))?.snapshot ?? null;
    const text = JSON.stringify({ since, at: new Date().toISOString(), snapshot });
    if (text.length > maxSnapshot) throw new Error(`The snapshot of the task database is over ${maxSnapshot / 1_000_000} MB, too large to keep.`);
    mkdirSync(this.root(), { recursive: true, mode: 0o700 });
    writeFileSync(this.file(saved.task.id), text, { mode: 0o600 });
  }

  // A failed snapshot never stops the work it accompanies; the run's log says why changes will be missing.
  async baseline(run, since, signal) {
    if (!this.tasks.saved(run) || !this.supported(run.project)) return false;
    try { await this.snapshot(run, since, signal); return true; }
    catch (error) { this.live.log(run, 'database', `Could not take a snapshot of the task database: ${error.message}`); return false; }
  }

  async changes(run, signal) {
    const saved = this.usable(run), settings = perTask(run.project);
    let stored; try { stored = JSON.parse(readFileSync(this.file(saved.task.id), 'utf8')); } catch { throw new Error('There is no snapshot of the task database yet; call dispatch_database snapshot first.'); }
    const answer = settings.provider === 'commands'
      ? parsed(await this.tasks.command(run, settings.changes, this.values(saved), saved.env, signal))
      : await this.live.connectors.invoke(run.project, settings.provider, 'database.changes', [{ ...this.input(run, saved), snapshot: stored.snapshot }], { signal });
    return { since: stored.since, at: stored.at, tables: normalizeChanges(answer) };
  }

  input(run, saved) { return { task: saved.task, env: saved.env, workspace: run.workspace }; }
  values(saved) { return { task: saved.task.name, port: saved.port, snapshot: this.folder(saved.task.id) }; }

  forget(id) {
    rmSync(this.file(id), { force: true });
    rmSync(this.folder(id), { recursive: true, force: true });
  }
}

function parsed(output) {
  try { return JSON.parse(output); } catch { throw new Error(`The changes command printed no JSON: ${output.trim().slice(0, 300) || '(nothing)'}`); }
}
