import { appendFileSync, existsSync, mkdirSync, openSync, readSync, closeSync, statSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const stepKinds = ['turn.start', 'turn.end', 'message', 'tool.call', 'tool.result', 'browser.step', 'files', 'check.start', 'check.end', 'question', 'answer', 'delivery', 'status', 'dev-server', 'patch', 'model', 'risk', 'overflow'];
export const limits = { line: 32_000, file: 64_000_000, page: 500, text: 16_000, output: 64_000, paths: 500 };
const redact = text => String(text).replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{20,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[REDACTED]');
const clip = (value, max) => typeof value === 'string' ? redact(value).slice(0, max) : value;

function bound(step) {
  const copy = { ...step };
  if (copy.text !== undefined) copy.text = clip(copy.text, limits.text);
  if (copy.output !== undefined) copy.output = clip(copy.output, limits.output);
  if (copy.message !== undefined) copy.message = clip(copy.message, limits.text);
  if (copy.input !== undefined) { const text = JSON.stringify(copy.input); copy.input = text.length > limits.text ? { truncated: true, text: clip(text, limits.text) } : JSON.parse(redact(text)); }
  if (copy.args !== undefined) { const text = JSON.stringify(copy.args); copy.args = text.length > 2000 ? { truncated: true, text: clip(text, 2000) } : JSON.parse(redact(text)); }
  if (Array.isArray(copy.paths)) copy.paths = copy.paths.slice(0, limits.paths);
  return copy;
}
const summarise = (summary = {}, step) => ({ total: (summary.total ?? 0) + 1, browser: (summary.browser ?? 0) + (step.kind === 'browser.step' ? 1 : 0), tools: (summary.tools ?? 0) + (step.kind === 'tool.call' ? 1 : 0), backend: (summary.backend ?? 0) + (step.kind === 'tool.result' && step.view ? 1 : 0), turns: (summary.turns ?? 0) + (step.kind === 'turn.start' ? 1 : 0), bytes: (summary.bytes ?? 0) + (step.bytes ?? 0) });

// Append-only per-run record of what happened, in order, with enough detail to replay it later.
export class StepLog {
  constructor(dataDir, { store } = {}) { this.root = join(resolve(dataDir), 'live-steps'); this.store = store; this.overflowed = new Set(); mkdirSync(this.root, { recursive: true }); }
  path(runId) { return join(this.root, `${runId}.jsonl`); }
  append(run, step) {
    if (!stepKinds.includes(step.kind)) throw new Error(`Unknown step kind ${step.kind}.`);
    const record = { id: randomUUID(), seq: (run.stepCount ?? 0) + 1, at: new Date().toISOString(), turn: { attempt: run.attempt ?? 0, role: step.role ?? 'worker' }, ...bound(step) };
    delete record.role;
    let line = JSON.stringify(record);
    if (line.length > limits.line) { record.truncated = true; if (record.output) record.output = record.output.slice(0, limits.line / 2); if (record.text) record.text = record.text.slice(0, limits.line / 2); line = JSON.stringify(record).slice(0, limits.line); }
    const path = this.path(run.id);
    if (existsSync(path) && statSync(path).size >= limits.file) { if (!this.overflowed.has(run.id)) { this.overflowed.add(run.id); appendFileSync(path, JSON.stringify({ ...record, kind: 'overflow', message: 'Step log reached its size cap; later steps were not recorded.' }) + '\n', { mode: 0o600 }); } return record; }
    appendFileSync(path, line + '\n', { mode: 0o600 });
    run.stepCount = record.seq; run.stepSummary = summarise(run.stepSummary, record);
    this.store?.saveSoon();
    return record;
  }
  async read(runId, { after = 0, limit = 200 } = {}) {
    const path = this.path(runId), max = Math.min(Math.max(1, limit), limits.page), steps = [];
    if (!existsSync(path)) return { steps, next: null, total: 0 };
    let total = 0;
    for await (const line of createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      total++;
      if (total <= after || steps.length >= max) continue;
      try { steps.push(JSON.parse(line)); } catch { steps.push({ seq: total, kind: 'overflow', message: 'Unreadable step.' }); }
    }
    return { steps, next: steps.length === max && total > after + max ? after + max : null, total };
  }
  lastKind(runId) {
    const path = this.path(runId);
    if (!existsSync(path)) return null;
    const size = statSync(path).size, length = Math.min(size, 4096), buffer = Buffer.alloc(length), fd = openSync(path, 'r');
    try { readSync(fd, buffer, 0, length, size - length); } finally { closeSync(fd); }
    const line = buffer.toString('utf8').trimEnd().split('\n').at(-1);
    try { return JSON.parse(line).kind; } catch { return null; }
  }
  recover(runs) {
    for (const run of runs) if (run.status === 'interrupted' && run.stepCount && this.lastKind(run.id) !== 'status') this.append(run, { kind: 'status', status: 'interrupted', message: 'Server restarted; the run was not resumed.' });
  }
}
