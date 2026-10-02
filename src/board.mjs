import { randomUUID } from 'node:crypto';
import { InputError } from './engine.mjs';
import { terminal } from './catalog.mjs';
import { activeStatuses, conversationKey, folderDepth, taskState } from './board-state.mjs';
import { latestRun, rootOf } from './conversations.mjs';

const maxFolders = 200, maxDepth = 5;
const resumeInput = 'Continue where you left off.';

function folderName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60) throw new InputError('Name the folder (1–60 characters).');
  return value.trim();
}

// Board state is operator metadata keyed by conversation; run records stay untouched evidence.
export class Board {
  constructor(live) { this.live = live; this.engine = live.engine; }
  get state() { return this.engine.store.state.board; }
  get folders() { return this.state.folders; }

  save() {
    if (this.engine.stopping) throw new InputError('Server is stopping', 503);
    this.engine.store.save();
  }

  resolve(key) {
    const runs = this.engine.runs.filter(run => run.mode === 'live'), byId = new Map(runs.map(run => [run.id, run]));
    const task = this.engine.store.state.tasks.find(record => record.id === key);
    const found = byId.get(key) ?? runs.find(run => run.taskId === key);
    if (!found && !task) throw new InputError('Task not found', 404);
    if (!found) return { key: task.id, task, latest: null };
    const root = rootOf(found, byId);
    return { key: conversationKey(root), task, latest: latestRun(runs, root) };
  }

  item(key) { return this.state.items[key] ??= {}; }

  folder(id) {
    const folder = this.folders.find(candidate => candidate.id === id);
    if (!folder) throw new InputError('Folder not found', 404);
    return folder;
  }

  createFolder({ name, parentId = null }) {
    if (this.folders.length >= maxFolders) throw new InputError(`Folder limit reached (${maxFolders}).`, 409);
    if (parentId !== null) this.folder(parentId);
    if (parentId !== null && folderDepth(this.folders, parentId) >= maxDepth) throw new InputError(`Folders nest at most ${maxDepth} deep.`, 409);
    const folder = { id: randomUUID(), name: folderName(name), parentId, createdAt: new Date().toISOString() };
    this.folders.push(folder); this.save(); return folder;
  }

  renameFolder(id, { name }) {
    const folder = this.folder(id);
    folder.name = folderName(name); this.save(); return folder;
  }

  deleteFolder(id) {
    const folder = this.folder(id);
    for (const child of this.folders) if (child.parentId === id) child.parentId = folder.parentId;
    for (const item of Object.values(this.state.items)) if (item.folderId === id) item.folderId = folder.parentId;
    this.folders.splice(this.folders.indexOf(folder), 1); this.save(); return { id };
  }

  update(key, input) {
    const target = this.resolve(key), item = { ...this.state.items[target.key] };
    if (input.folderId !== undefined) {
      if (input.folderId !== null) this.folder(input.folderId);
      item.folderId = input.folderId;
    }
    if (input.archived !== undefined) this.setArchived(target, item, input.archived);
    if (input.done !== undefined) this.setDone(target, item, input.done);
    this.state.items[target.key] = item;
    this.save(); return { key: target.key, item };
  }

  setArchived({ latest }, item, archived) {
    if (typeof archived !== 'boolean') throw new InputError('Choose archive or unarchive.');
    if (archived && latest && activeStatuses.has(latest.status)) throw new InputError('Stop or pause the task before archiving it.', 409);
    if (archived) item.archivedAt = new Date().toISOString(); else delete item.archivedAt;
  }

  setDone({ latest }, item, done) {
    if (typeof done !== 'boolean') throw new InputError('Choose done or not done.');
    if (!done) { delete item.done; return; }
    if (!latest || !terminal.has(latest.status)) throw new InputError('Only a stopped task can be marked done.', 409);
    item.done = { runId: latest.id, at: new Date().toISOString() };
  }

  async pause(key) {
    const target = this.resolve(key), { latest } = target, item = this.item(target.key);
    if (!latest) throw new InputError('Start the task before pausing it.', 409);
    if (item.pause?.runId === latest.id) return { key: target.key, item };
    const running = activeStatuses.has(latest.status);
    if (running && latest.status === 'publishing') throw new InputError('The task is publishing. Pause it after it finishes.', 409);
    if (running && !latest.sessionId) throw new InputError('The agent session has not started yet. Try again in a moment.', 409);
    item.pause = { runId: latest.id, at: new Date().toISOString(), stoppedTurn: running };
    delete item.done;
    this.save();
    if (running) {
      this.engine.cancel(latest.id, 'Paused by operator. No publication; existing evidence retained.');
      await this.engine.active.get(latest.id)?.promise;
    }
    return { key: target.key, item };
  }

  async resume(key) {
    const target = this.resolve(key), { latest } = target, item = this.item(target.key);
    if (!latest || taskState({ latest, item }) !== 'paused') throw new InputError('This task is not paused.', 409);
    const run = item.pause.stoppedTurn ? await this.live.followup(latest.id, { input: resumeInput }) : latest;
    delete item.pause; this.save();
    return { key: target.key, item, runId: run.id };
  }
}
