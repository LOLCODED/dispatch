import { randomUUID } from 'node:crypto';
import { InputError } from './engine.mjs';
import { digest } from './local-tools.mjs';
import { noteId, parseNotes, tokens } from './memory.mjs';

export const ladder = { suggest: 2, auto: 4, history: 10 };
export const kinds = ['rule', 'note', 'preference', 'connector'];
export const modes = ['ask', 'suggest', 'auto'];
const sources = ['operator', 'agent', 'observed'];
const vias = ['composer', 'verdict', 'settings', 'tool', 'import', 'reply', 'switch', 'escalation'];
const limits = { text: 200, value: 200, key: 80, entries: 2000 };
const noteSections = ['Gotchas', 'Conventions'];
const scopePattern = /^(?:global|project:[A-Za-z0-9_-]{1,64})$/;
const keyPattern = /^[a-z][a-z0-9.-]{0,79}(?::[A-Za-z0-9 _.-]{1,80}(?::[A-Za-z0-9 _.-]{1,80})?)?$/;
export const normaliseLine = line => String(line).replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
export const noteKey = line => `note:${digest(normaliseLine(line)).slice(0, 16)}`;
export const projectScope = projectId => `project:${projectId}`;
const now = () => new Date().toISOString();

export function streak(answers = []) {
  let count = 0, value;
  for (const answer of [...answers].reverse()) {
    if (answer.undo || answer.value === null || answer.value === undefined) break;
    if (value === undefined) value = answer.value;
    if (answer.value !== value) break;
    count++;
  }
  return { count, value };
}
export function modeFor(entry) {
  if (entry.pinned) return entry.mode ?? 'ask';
  const { count } = streak(entry.answers);
  return count >= ladder.auto ? 'auto' : count >= ladder.suggest ? 'suggest' : 'ask';
}
export function promote(entry, value, { runId = null, undo = false, at = now() } = {}) {
  entry.answers = [...(entry.answers ?? []), { value: undo ? null : value, at, runId, ...(undo ? { undo: true } : {}) }].slice(-ladder.history);
  if (!undo) entry.value = value;
  entry.mode = modeFor(entry); entry.updatedAt = at;
  return entry;
}

const text = (value, name, max) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(`${name} must be text under ${max} characters.`); return value.replace(/\s+/g, ' ').trim(); };
function preferenceFields(input) {
  const fields = {};
  if (input.key !== undefined) { if (typeof input.key !== 'string' || !keyPattern.test(input.key)) throw new InputError('Preference key is invalid.'); fields.key = input.key; }
  if (input.trigger !== undefined) fields.trigger = text(input.trigger, 'Trigger', limits.key);
  if (input.action !== undefined) fields.action = text(input.action, 'Action', limits.key);
  if (!fields.key && !(fields.trigger && fields.action)) throw new InputError('A preference needs a key, or a trigger and an action.');
  if (input.value !== undefined && input.value !== null) fields.value = text(String(input.value), 'Value', limits.value);
  if (input.mode !== undefined) { if (!modes.includes(input.mode)) throw new InputError('Mode must be ask, suggest or auto.'); fields.mode = input.mode; }
  return fields;
}
export function entrySchema(input, { at = now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Expected a memory entry.');
  if (!kinds.includes(input.kind)) throw new InputError('Memory kind must be rule, note, preference or connector.');
  const scope = input.scope ?? 'global';
  if (typeof scope !== 'string' || !scopePattern.test(scope)) throw new InputError('Scope must be global or project:<id>.');
  if (input.source !== undefined && !sources.includes(input.source)) throw new InputError('Source must be operator, agent or observed.');
  const origin = input.origin && typeof input.origin === 'object' ? { runId: typeof input.origin.runId === 'string' ? input.origin.runId.slice(0, 64) : null, via: vias.includes(input.origin.via) ? input.origin.via : 'settings' } : { runId: null, via: 'settings' };
  const entry = { id: randomUUID(), kind: input.kind, scope, enabled: input.enabled !== false, source: input.source ?? 'operator', pinned: input.pinned === true, answers: [], createdAt: at, updatedAt: at, lastUsedAt: null, uses: 0, origin };
  if (input.kind === 'rule' || input.kind === 'note') entry.text = text(input.text, input.kind === 'rule' ? 'Rule' : 'Note', limits.text);
  if (input.kind === 'note') { entry.key = noteKey(entry.text); entry.section = noteSections.includes(input.section) ? input.section : 'Gotchas'; }
  if (input.kind === 'preference') { Object.assign(entry, preferenceFields(input)); entry.mode = entry.pinned ? entry.mode ?? 'ask' : 'ask'; }
  if (input.kind === 'connector') { if (typeof input.key !== 'string' || !/^connector\.[a-z][a-zA-Z0-9]{0,39}$/.test(input.key)) throw new InputError('Connector key must look like connector.<name>.'); entry.key = input.key; }
  return entry;
}

const preferenceLabel = entry => entry.trigger ? `When ${entry.trigger}: ${entry.action}${entry.value ? ` → ${entry.value}` : ' (leave alone)'}` : `${entry.key}${entry.value ? ` = ${entry.value}` : ''}`;
export function entryLabel(entry) {
  if (entry.kind === 'rule' || entry.kind === 'note') return entry.text;
  if (entry.kind === 'preference') return preferenceLabel(entry);
  return `Connector ${entry.key.replace(/^connector\./, '')}`;
}
const matches = (entry, words, raw) => { const label = entryLabel(entry).toLowerCase(); return label.includes(raw) || [...tokens(label)].some(word => words.has(word)); };

export class Brain {
  constructor(store, { memory, connectorIds = () => [] } = {}) { this.store = store; this.memory = memory; this.connectorIds = connectorIds; this.importRules(); this.reconcileNotes(); }
  get entries() { return this.store.state.brain; }
  get projects() { return this.store.state.projects; }
  save() { this.store.save(); }
  find(id) { return this.entries.find(entry => entry.id === id) ?? null; }
  importRules() {
    let imported = false;
    for (const project of this.projects) for (const line of project.instructions ?? []) {
      if (this.rules(project.id).some(entry => entry.text === line)) continue;
      this.entries.push(entrySchema({ kind: 'rule', scope: projectScope(project.id), text: line, origin: { via: 'import' } })); imported = true;
    }
    if (imported) this.save();
  }
  // notes.md is the source of truth; entries for lines pruned from it would list notes no task is ever given.
  reconcileNotes() {
    if (!this.memory) return;
    const present = new Map();
    const kept = entry => {
      const projectId = entry.scope.replace(/^project:/, '');
      if (!present.has(projectId)) present.set(projectId, this.memory.noteIds(projectId));
      return present.get(projectId).has(noteId(entry.text));
    };
    const entries = this.entries.filter(entry => entry.kind !== 'note' || kept(entry));
    if (entries.length !== this.entries.length) { this.store.state.brain = entries; this.save(); }
  }
  rules(projectId) { return this.entries.filter(entry => entry.kind === 'rule' && entry.scope === projectScope(projectId)); }
  syncRules(project) { project.instructions = this.rules(project.id).filter(entry => entry.enabled).map(entry => entry.text).slice(0, 20); }
  addRule(project, line, origin = { via: 'settings' }) {
    const existing = this.rules(project.id).find(entry => entry.text === line);
    if (existing) { existing.enabled = true; existing.updatedAt = now(); }
    else this.entries.push(entrySchema({ kind: 'rule', scope: projectScope(project.id), text: line, origin }));
    this.syncRules(project); this.save(); return project;
  }
  replaceRules(project, lines) {
    const kept = new Set(lines);
    this.store.state.brain = this.entries.filter(entry => !(entry.kind === 'rule' && entry.scope === projectScope(project.id) && !kept.has(entry.text)));
    for (const line of lines) if (!this.rules(project.id).some(entry => entry.text === line)) this.entries.push(entrySchema({ kind: 'rule', scope: projectScope(project.id), text: line, origin: { via: 'settings' } }));
    for (const entry of this.rules(project.id)) entry.enabled = true;
    this.syncRules(project);
  }
  add(input) {
    if (this.entries.length >= limits.entries) throw new InputError('Memory is full; forget some entries first.');
    const entry = entrySchema(input);
    if (entry.kind === 'rule') { const project = this.projects.find(item => entry.scope === projectScope(item.id)); if (!project) throw new InputError('Rules belong to a saved repository.'); return this.addRule(project, entry.text, entry.origin) && this.rules(project.id).find(item => item.text === entry.text); }
    if (entry.kind === 'note') return this.addNote(entry);
    const duplicate = this.entries.find(item => item.kind === entry.kind && item.scope === entry.scope && item.key === entry.key && item.trigger === entry.trigger && item.action === entry.action);
    if (duplicate) { Object.assign(duplicate, { enabled: true, updatedAt: now(), ...(entry.value !== undefined ? { value: entry.value } : {}), ...(entry.pinned ? { pinned: true, mode: entry.mode } : {}) }); this.save(); return duplicate; }
    this.entries.push(entry); this.save(); return entry;
  }
  addNote(entry) {
    const projectId = entry.scope.replace(/^project:/, '');
    const existing = this.entries.find(item => item.kind === 'note' && item.scope === entry.scope && item.key === entry.key);
    if (existing) { existing.enabled = true; existing.updatedAt = now(); this.save(); return existing; }
    const written = this.memory?.addLine(projectId, entry.section, entry.text);
    this.forgetNotes(projectId, written?.forgotten ?? []);
    this.entries.push(entry); this.save(); return entry;
  }
  forgetNotes(projectId, lines) {
    const gone = new Set(lines.map(noteKey));
    if (!gone.size) return;
    this.store.state.brain = this.entries.filter(item => !(item.kind === 'note' && item.scope === projectScope(projectId) && gone.has(item.key)));
    this.save();
  }
  keptNotes(projectId) { return new Set(this.entries.filter(entry => entry.kind === 'note' && entry.scope === projectScope(projectId) && (entry.source === 'operator' || entry.pinned)).map(entry => noteId(entry.text))); }
  recordNotes(run, lines) {
    for (const line of lines) if (!this.entries.some(item => item.kind === 'note' && item.scope === projectScope(run.projectId) && item.key === noteKey(line))) {
      this.entries.push(entrySchema({ kind: 'note', scope: projectScope(run.projectId), text: line, source: 'agent', section: /\b(convention|style|prefer|naming|pattern|format|lint)\b/i.test(line) ? 'Conventions' : 'Gotchas', origin: { runId: run.id, via: 'tool' } }));
    }
    if (lines.length) this.save();
  }
  disabledNotes(projectId) { return new Set(this.entries.filter(entry => entry.kind === 'note' && entry.scope === projectScope(projectId) && !entry.enabled).map(entry => normaliseLine(entry.text))); }
  projectedNotes(project) {
    const known = new Map(this.entries.filter(entry => entry.kind === 'note' && entry.scope === projectScope(project.id)).map(entry => [entry.key, entry]));
    const parsed = parseNotes(this.memory?.readNotes(project.id) ?? ''), projected = [];
    for (const section of noteSections) for (const line of parsed.get(section) ?? []) {
      const clean = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim(), key = noteKey(clean);
      if (known.has(key) || !clean) continue;
      projected.push({ id: `${key}:${project.id}`, kind: 'note', scope: projectScope(project.id), enabled: true, source: 'agent', text: clean, key, section, projected: true, createdAt: null, updatedAt: null, lastUsedAt: null, uses: 0, origin: { runId: null, via: 'tool' } });
    }
    return projected;
  }
  projectedConnectors(project) {
    const flags = Object.fromEntries([...new Set([...this.connectorIds(), ...Object.keys(project.connectors ?? {})])].map(id => [id, project.connectors?.[id]?.enabled === true]));
    return Object.entries(flags).map(([name, enabled]) => ({ id: `connector:${project.id}:${name}`, kind: 'connector', scope: projectScope(project.id), enabled, source: 'operator', key: `connector.${name}`, projected: true, createdAt: null, updatedAt: null, lastUsedAt: null, uses: 0, origin: { runId: null, via: 'settings' } }));
  }
  catalog({ projectId, kind, match } = {}) {
    const projects = projectId ? this.projects.filter(project => project.id === projectId) : this.projects;
    let items = [...this.entries, ...projects.flatMap(project => [...this.projectedNotes(project), ...this.projectedConnectors(project)])];
    if (projectId) items = items.filter(entry => entry.scope === 'global' || entry.scope === projectScope(projectId));
    if (kind) items = items.filter(entry => entry.kind === kind);
    if (match?.trim()) { const raw = match.trim().toLowerCase(), words = tokens(raw); items = items.filter(entry => matches(entry, words, raw)); }
    return items.map(entry => ({ ...entry, label: entryLabel(entry), mode: entry.kind === 'preference' ? modeFor(entry) : undefined }));
  }
  search(text, { projectId } = {}) { return this.catalog({ projectId, match: text }); }
  lookup({ kind = 'preference', key, trigger, action, projectId }) {
    const fits = entry => entry.kind === kind && entry.enabled && (key ? entry.key === key : entry.trigger === trigger && entry.action === action);
    return this.entries.find(entry => projectId && entry.scope === projectScope(projectId) && fits(entry)) ?? this.entries.find(entry => entry.scope === 'global' && fits(entry)) ?? null;
  }
  answer({ key, trigger, action, projectId, scope = 'project', value, runId = null, undo = false, source = 'observed', via = 'verdict' }) {
    const target = scope === 'global' || !projectId ? 'global' : projectScope(projectId);
    let entry = this.entries.find(item => item.kind === 'preference' && item.scope === target && (key ? item.key === key : item.trigger === trigger && item.action === action));
    if (!entry) { entry = entrySchema({ kind: 'preference', scope: target, key, trigger, action, source, origin: { runId, via } }); this.entries.push(entry); }
    promote(entry, value, { runId, undo }); entry.enabled = true; this.save(); return entry;
  }
  touch(id, runId = null) { const entry = this.find(id); if (!entry) return null; entry.uses = (entry.uses ?? 0) + 1; entry.lastUsedAt = now(); if (runId) entry.lastRunId = runId; this.save(); return entry; }
  setMode(id, mode) {
    const entry = this.find(id);
    if (!entry || entry.kind !== 'preference') throw new InputError('Only preferences have a mode.', 404);
    if (!modes.includes(mode)) throw new InputError('Mode must be ask, suggest or auto.');
    entry.mode = mode; entry.pinned = true; entry.updatedAt = now(); this.save(); return entry;
  }
  setEnabled(id, enabled) {
    if (typeof enabled !== 'boolean') throw new InputError('Enabled must be a boolean.');
    const entry = this.find(id) ?? this.materialise(id);
    if (!entry) throw new InputError('Memory entry not found.', 404);
    entry.enabled = enabled; entry.updatedAt = now();
    if (entry.kind === 'rule') { const project = this.projects.find(item => entry.scope === projectScope(item.id)); if (project) this.syncRules(project); }
    this.save(); return entry;
  }
  materialise(id) {
    const projected = this.projects.flatMap(project => this.projectedNotes(project)).find(entry => entry.id === id);
    if (!projected) return null;
    const { projected: _, id: __, ...fields } = projected;
    const entry = { ...fields, id: randomUUID(), createdAt: now(), updatedAt: now() };
    this.entries.push(entry); return entry;
  }
  remove(id) {
    const entry = this.find(id) ?? this.projects.flatMap(project => this.projectedNotes(project)).find(item => item.id === id);
    if (!entry) throw new InputError('Memory entry not found.', 404);
    if (entry.kind === 'note') this.memory?.removeLine(entry.scope.replace(/^project:/, ''), entry.text);
    this.store.state.brain = this.entries.filter(item => item.id !== entry.id);
    if (entry.kind === 'rule') { const project = this.projects.find(item => entry.scope === projectScope(item.id)); if (project) this.syncRules(project); }
    this.save(); return entry;
  }
  connectorDefaults() { return Object.fromEntries(this.entries.filter(entry => entry.kind === 'connector' && entry.scope === 'global' && entry.enabled).map(entry => [entry.key.replace(/^connector\./, ''), true])); }
}
