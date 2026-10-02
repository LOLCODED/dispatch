import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const coalesceMs = 100;

// Single-process store. The server holds an exclusive data-directory lock.
export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, 'state.json');
    this.state = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : { version: 1, runs: [] };
    if (![1, 2].includes(this.state.version) || !Array.isArray(this.state.runs)) throw new Error('Unsupported or invalid state file. Preserve it and inspect before restarting.');
    this.state.version = 2;
    this.state.projects ??= [];
    this.state.tasks ??= [];
    if (!Array.isArray(this.state.tasks)) throw new Error('Invalid task list. Preserve the state file before restarting.');
    this.state.board ??= { folders: [], items: {} };
    const { folders, items } = this.state.board;
    if (!Array.isArray(folders) || !items || typeof items !== 'object' || Array.isArray(items)) throw new Error('Invalid board. Preserve the state file before restarting.');
    this.state.brain ??= [];
    if (!Array.isArray(this.state.brain)) throw new Error('Invalid memory list. Preserve the state file before restarting.');
    this.writes = 0; this.timer = null;
  }
  save() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temporary, this.path);
    this.writes++;
  }
  saveSoon() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.save(); }, coalesceMs);
  }
  flush() { if (this.timer) this.save(); }
}
