import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { digest } from './local-tools.mjs';

export const sections = ['Build and checks', 'Gotchas', 'Conventions', 'Recent tasks'];
export const limits = { notesBytes: 8192, notesLines: 120, taskLines: 200, learnings: 3, learningCharacters: 200, sliceCharacters: 2000, recentTasks: 5, summaries: 20, unusedRuns: 40 };
const prunable = ['Recent tasks', 'Gotchas', 'Conventions'];
const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'when', 'then', 'than', 'they', 'them', 'their', 'there', 'which', 'what', 'where', 'will', 'would', 'should', 'could', 'into', 'also', 'about', 'after', 'before', 'been', 'being', 'make', 'made', 'does', 'only', 'more', 'most', 'some', 'such', 'each', 'other', 'over', 'under', 'because', 'while', 'these', 'those', 'need', 'needs', 'using', 'used', 'file', 'files', 'code', 'change', 'changes', 'update', 'task', 'tasks', 'ticket', 'please', 'dispatch', 'ready', 'blocked', 'failed', 'check', 'checks', 'setup', 'notes', 'none']);
const conventionWords = /\b(convention|style|prefer|naming|pattern|format|lint)\b/i;

export const tokens = text => new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 4 && !stopWords.has(word)));
const overlaps = (words, line) => [...tokens(line)].some(word => words.has(word));
const bullet = line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
const normalise = line => bullet(line).toLowerCase();
const noteSections = ['Gotchas', 'Conventions'];
export const noteId = line => digest(normalise(line)).slice(0, 16);

// Two notes about the same thing share most of the shorter one's words; the newer one wins, so a corrected workaround replaces the wrong one.
export function similar(a, b) {
  const left = tokens(bullet(a)), right = tokens(bullet(b)), smaller = Math.min(left.size, right.size);
  if (smaller < 4) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / smaller >= 0.75;
}

export function parseLearnings(summary) {
  const match = /^[ \t#*]*Notes for next time:?[ \t*]*(.*)$/im.exec(String(summary ?? ''));
  if (!match) return [];
  if (match[1].trim()) return /^\s*none\b/i.test(match[1]) ? [] : [match[1].trim().slice(0, limits.learningCharacters)];
  const learnings = [];
  for (const line of summary.slice(match.index + match[0].length).split('\n')) {
    if (!line.trim()) { if (learnings.length) break; continue; }
    if (!/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) break;
    const text = bullet(line);
    if (/^none\b/i.test(text)) break;
    if (text) learnings.push(text.slice(0, limits.learningCharacters));
    if (learnings.length === limits.learnings) break;
  }
  return learnings;
}

export function parseNotes(text) {
  const parsed = new Map(sections.map(name => [name, []]));
  let current = null;
  for (const line of String(text ?? '').split('\n')) {
    const header = /^##\s+(.+?)\s*$/.exec(line);
    if (header) { current = header[1]; if (!parsed.has(current)) parsed.set(current, []); continue; }
    if (current && line.trim()) parsed.get(current).push(line.trimEnd());
  }
  return parsed;
}

export function renderNotes(parsed) {
  return [...parsed].map(([name, lines]) => `## ${name}\n${lines.join('\n')}${lines.length ? '\n' : ''}`).join('\n');
}

function measure(parsed) {
  const text = renderNotes(parsed);
  return { text, bytes: Buffer.byteLength(text), lines: text.split('\n').length };
}

export function pruneNotes(parsed, dropped = []) {
  for (;;) {
    const size = measure(parsed);
    if (size.bytes <= limits.notesBytes && size.lines <= limits.notesLines) return parsed;
    const section = prunable.find(name => parsed.get(name)?.length);
    if (!section) return parsed;
    const line = parsed.get(section).shift();
    if (noteSections.includes(section)) dropped.push(bullet(line));
  }
}

export function recipeSummary(project) {
  const step = item => `${item.command} ${item.args.join(' ')}`.trim();
  return [...(project.setup ?? []).map(item => `- Setup: ${step(item)}`), ...(project.validation ?? []).map(item => `- Check ${item.id}: ${step(item)}`)];
}

export function selectNotes(text, ticketText, { excluded = new Set() } = {}) {
  const parsed = parseNotes(text), words = tokens(ticketText);
  const wanted = line => overlaps(words, line) && !excluded.has(normalise(line));
  const candidates = [['Build and checks', parsed.get('Build and checks')], ['Gotchas', parsed.get('Gotchas').filter(wanted)], ['Conventions', parsed.get('Conventions').filter(wanted)], ['Recent tasks', parsed.get('Recent tasks').slice(-limits.recentTasks).filter(line => overlaps(words, line))]];
  let output = '', sourceLines = 0;
  const used = [];
  for (const [name, lines] of candidates) {
    if (!lines.length && name !== 'Build and checks') continue;
    const header = `${output ? '\n' : ''}## ${name}\n`;
    if (output.length + header.length > limits.sliceCharacters) break;
    output += header;
    for (const line of lines) {
      if (output.length + line.length + 1 > limits.sliceCharacters) break;
      output += `${line}\n`; sourceLines++;
      if (noteSections.includes(name)) used.push(noteId(line));
    }
  }
  return { text: output, sourceLines, used };
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600 }); renameSync(temporary, path);
}

export class Memory {
  constructor(dataDir) { this.root = join(resolve(dataDir), 'memory'); }
  directory(projectId) { return join(this.root, String(projectId)); }
  notesPath(projectId) { return join(this.directory(projectId), 'notes.md'); }
  tasksPath(projectId) { return join(this.directory(projectId), 'tasks.jsonl'); }
  noteIds(projectId) { const parsed = parseNotes(this.readNotes(projectId)); return new Set(noteSections.flatMap(section => parsed.get(section)).map(noteId)); }
  readNotes(projectId) { const path = this.notesPath(projectId); return existsSync(path) ? readFileSync(path, 'utf8') : ''; }
  readTasks(projectId, limit = limits.summaries) {
    const path = this.tasksPath(projectId);
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(-limit).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  }
  read(projectId) { return { path: this.directory(projectId), notes: this.readNotes(projectId), tasks: this.readTasks(projectId) }; }
  select(projectId, ticketText, options = {}) {
    const notes = this.readNotes(projectId);
    if (!notes) return { text: '', injectedCharacters: 0, sourceLines: 0, notesBytes: 0, used: [] };
    const slice = selectNotes(notes, ticketText, options);
    return { text: slice.text, injectedCharacters: slice.text.length, sourceLines: slice.sourceLines, notesBytes: Buffer.byteLength(notes), used: slice.used };
  }
  summary(run) {
    return { runId: run.id, at: run.finishedAt ?? new Date().toISOString(), ticketKey: run.ticket?.key ?? null, title: String(run.title ?? '').slice(0, 200), status: run.status, checks: (run.checks ?? []).filter(check => !check.linked).map(check => ({ name: check.name, status: check.status })), filesChanged: run.changedPaths?.length ?? 0, learnings: [] };
  }
  record(run, summary = this.summary(run), { keep = new Set() } = {}) {
    if (run.status === 'ready') {
      const { added, forgotten } = this.writeNotes(run, summary, keep);
      summary.learnings = added;
      if (forgotten.length) summary.forgotten = forgotten;
    }
    this.appendTask(run.projectId, summary);
    return summary;
  }
  writeNotes(run, summary, keep) {
    const parsed = this.load(run.projectId, run.project), learnings = parseLearnings(run.summary), replaced = [];
    const added = this.addLearnings(parsed, learnings, replaced);
    const expired = this.age(run.projectId, parsed, new Set([...(run.memory?.used ?? []), ...learnings.map(noteId)]), keep);
    parsed.get('Recent tasks').push(`- ${summary.at.slice(0, 10)} ${summary.title} — ${summary.status}, ${summary.filesChanged} files`);
    const forgotten = [...replaced, ...expired];
    writeAtomic(this.notesPath(run.projectId), renderNotes(pruneNotes(parsed, forgotten)));
    return { added: added.filter(line => !forgotten.includes(line)), forgotten };
  }
  usagePath(projectId) { return join(this.directory(projectId), 'usage.json'); }
  readUsage(projectId) {
    try {
      const usage = JSON.parse(readFileSync(this.usagePath(projectId), 'utf8'));
      if (Number.isInteger(usage?.runs) && usage.seen && typeof usage.seen === 'object') return usage;
    } catch { /* No ready run recorded yet. */ }
    return { runs: 0, seen: {} };
  }
  // A note no ready run was given or learned again within its last runs is dropped; notes the operator kept stay.
  age(projectId, parsed, used, keep) {
    const usage = this.readUsage(projectId), runs = usage.runs + 1, seen = {}, expired = [];
    for (const section of noteSections) parsed.set(section, parsed.get(section).filter(line => {
      const id = noteId(line), last = used.has(id) ? runs : usage.seen[id] ?? runs;
      if (keep.has(id) || runs - last < limits.unusedRuns) { seen[id] = last; return true; }
      expired.push(bullet(line)); return false;
    }));
    writeAtomic(this.usagePath(projectId), JSON.stringify({ runs, seen }));
    return expired;
  }
  load(projectId, project) {
    const existing = this.readNotes(projectId);
    if (existing) return parseNotes(existing);
    const parsed = parseNotes('');
    parsed.get('Build and checks').push(...recipeSummary(project ?? {}));
    return parsed;
  }
  known(parsed) { return new Set(noteSections.flatMap(section => parsed.get(section)).map(normalise)); }
  dropSimilar(parsed, line) {
    const dropped = [];
    for (const section of noteSections) {
      const [kept, gone] = [[], []];
      for (const item of parsed.get(section)) (similar(item, line) ? gone : kept).push(item);
      parsed.set(section, kept); dropped.push(...gone.map(bullet));
    }
    return dropped;
  }
  addLine(projectId, section, line, project) {
    if (!noteSections.includes(section)) throw new Error('Notes can be added to Gotchas or Conventions only.');
    const parsed = this.load(projectId, project);
    if (this.known(parsed).has(normalise(line))) return { added: false, forgotten: [] };
    const forgotten = this.dropSimilar(parsed, line);
    parsed.get(section).push(`- ${line.slice(0, limits.learningCharacters)}`);
    writeAtomic(this.notesPath(projectId), renderNotes(pruneNotes(parsed, forgotten))); return { added: true, forgotten };
  }
  removeLine(projectId, line) {
    const existing = this.readNotes(projectId);
    if (!existing) return false;
    const parsed = parseNotes(existing), wanted = normalise(line);
    let removed = false;
    for (const section of prunable) { const lines = parsed.get(section); const kept = lines.filter(item => normalise(item) !== wanted); if (kept.length !== lines.length) { parsed.set(section, kept); removed = true; } }
    if (removed) writeAtomic(this.notesPath(projectId), renderNotes(parsed));
    return removed;
  }
  addLearnings(parsed, learnings, replaced = []) {
    const added = [];
    for (const learning of learnings) {
      if (this.known(parsed).has(learning.toLowerCase())) continue;
      replaced.push(...this.dropSimilar(parsed, learning)); added.push(learning);
      parsed.get(conventionWords.test(learning) ? 'Conventions' : 'Gotchas').push(`- ${learning}`);
    }
    return added;
  }
  appendTask(projectId, summary) {
    const path = this.tasksPath(projectId);
    const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : [];
    lines.push(JSON.stringify(summary));
    writeAtomic(path, `${lines.slice(-limits.taskLines).join('\n')}\n`);
  }
}
