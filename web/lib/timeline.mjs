import { terminal } from '../../src/catalog.mjs';

export const stepIcons = {'turn.start': 'play', 'turn.end': 'flag', message: 'message', 'tool.call': 'wrench', 'tool.result': 'wrench', 'browser.step': 'globe', files: 'files', 'check.start': 'flask', 'check.end': 'flask', 'check.accepted': 'flask', question: 'help', answer: 'reply', delivery: 'send', status: 'circle', 'dev-server': 'server', patch: 'diff', overflow: 'alert' };
const hidden = new Set(['tool.result', 'check.start']);

export function groupByTurn(steps) {
  const groups = [];
  for (const step of steps) {
    if (hidden.has(step.kind)) continue;
    const attempt = step.turn?.attempt ?? 0, role = step.turn?.role ?? 'worker', key = `${step.runId}:${attempt}:${role}`;
    let group = groups.at(-1);
    if (!group || group.key !== key) { group = { key, runIndex: step.runIndex, attempt, role, steps: [] }; groups.push(group); }
    group.steps.push(step);
  }
  return groups;
}
// Tags each step with its run, since sequence numbers restart in every run of a ticket.
export const ownSteps = (steps, run, runIndex) => steps.map(step => ({ ...step, runId: run.id, runIndex, key: `${run.id}:${step.seq}` }));
export const visibleSteps = steps => steps.filter(step => !hidden.has(step.kind));
export function filterSteps(steps, { browserOnly = false, checksOnly = false } = {}) {
  const visible = visibleSteps(steps);
  if (browserOnly) return visible.filter(step => step.kind === 'browser.step');
  return checksOnly ? visible.filter(step => step.kind === 'check.end' || step.kind === 'check.accepted') : visible;
}

const folded = new Set(['status', 'turn.start', 'turn.end', 'patch']);
const isEnd = step => step?.kind === 'status' && terminal.has(step.status);
const outcomeTones = { 'checks failed': 'failed', failed: 'failed', cancelled: 'failed', 'checks passed': 'passed', 'checks accepted': 'passed', completed: 'passed', blocked: 'blocked' };
const endTones = { ready: 'passed', planned: 'passed', failed: 'failed', cancelled: 'failed' };

export function phaseTitle({ attempt, role, runIndex }, multiRun = false) {
  const name = role === 'reviewer' ? 'Review' : attempt === 0 ? 'Prepare' : attempt === 1 ? 'Attempt 1' : `Repair ${attempt - 1}`;
  return multiRun ? `Run ${runIndex + 1} · ${name}` : name;
}
function phaseOutcome(steps) {
  const checks = steps.filter(step => step.kind === 'check.end'), accepted = new Set(steps.filter(step => step.kind === 'check.accepted').map(step => step.name));
  if (checks.length) return checks.some(check => check.status === 'failed' && !accepted.has(check.name)) ? 'checks failed' : accepted.size ? 'checks accepted' : 'checks passed';
  return steps.findLast(step => step.kind === 'turn.end')?.outcome ?? '';
}
const spanMs = steps => { const first = Date.parse(steps[0]?.at), last = Date.parse(steps.at(-1)?.at); return Number.isFinite(first) && Number.isFinite(last) ? last - first : null; };

// Bookkeeping steps (status changes, turn boundaries, saved patches) become each phase's outcome instead of rows; a run's final status closes it as an end marker.
export function timelinePhases(steps, filter = {}) {
  const filtering = Boolean(filter.browserOnly || filter.checksOnly), items = [];
  for (const group of groupByTurn(steps)) {
    const end = isEnd(group.steps.at(-1)) ? group.steps.at(-1) : null, own = end ? group.steps.slice(0, -1) : group.steps;
    const rows = filterSteps(own, filter).filter(step => !folded.has(step.kind)), outcome = phaseOutcome(own);
    if (own.length && (rows.length || !filtering)) items.push({ type: 'phase', key: group.key, runIndex: group.runIndex, attempt: group.attempt, role: group.role, outcome, tone: outcomeTones[outcome] ?? '', startedAt: own[0].at, durationMs: spanMs(own), note: rows.length ? '' : own.findLast(step => step.kind === 'status')?.message ?? '', rows });
    if (end && !filtering) items.push({ type: 'end', key: end.key, status: end.status, message: end.message ?? '', at: end.at, tone: endTones[end.status] ?? 'blocked' });
  }
  return items;
}
export const phaseRows = items => items.flatMap(item => item.rows ?? []);
export const playableSteps = steps => steps.filter(step => step.kind === 'browser.step' && step.screenshotAfter);
export function neighbour(steps, current, delta) {
  const index = steps.findIndex(step => step.key === current?.key);
  const next = index < 0 ? (delta > 0 ? 0 : steps.length - 1) : index + delta;
  return steps[Math.min(steps.length - 1, Math.max(0, next))] ?? null;
}
const short = (text, max = 60) => { const clean = String(text ?? '').replace(/\s+/g, ' ').trim(); return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean; };
const browserTitle = step => {
  const action = step.tool?.replace(/^dispatch_browser_/, '') ?? 'browser', args = step.args && !step.args.truncated ? step.args : {};
  if (action === 'navigate') return `navigate ${short(args.url, 50)}`;
  if (['click', 'hover', 'select'].includes(action)) return `${action} ${args.ref ?? ''}`.trim();
  if (action === 'resize') return `resize ${args.width} × ${args.height}`;
  if (action === 'type') return `type ${args.ref ?? ''} “${short(args.text, 24)}”`;
  if (action === 'press') return `press ${args.key ?? ''}`;
  if (action === 'wait') return `wait ${args.text ? `for “${short(args.text, 24)}”` : args.ref ?? `${args.ms ?? ''} ms`}`;
  return action;
};
const browserVerbs = { navigate: 'Open', snapshot: 'Read', click: 'Click', hover: 'Hover', resize: 'Resize', type: 'Type', press: 'Press', select: 'Select', scroll: 'Scroll', wait: 'Wait', back: 'Back', screenshot: 'Capture', console: 'Read console' };
function browserObject(action, step, args) {
  const element = step.target?.label ?? args.ref ?? '';
  switch (action) {
    case 'navigate': return short(String(args.url ?? '').replace(/^https?:\/\//, ''), 60);
    case 'snapshot': case 'screenshot': return short(step.title, 60) || 'page';
    case 'type': return `${element} “${short(args.text, 30)}”`;
    case 'select': return `${element} ${(args.values ?? []).join(', ')}`;
    case 'press': return args.key ?? '';
    case 'scroll': return args.direction ?? 'down';
    case 'wait': return args.text ? `for “${short(args.text, 30)}”` : args.ref ? element : `${args.ms ?? ''} ms`;
    case 'click': case 'hover': return element;
    case 'resize': return `${args.width} × ${args.height}`;
    default: return '';
  }
}
export const browserAction = step => step.tool?.replace(/^dispatch_browser_/, '') ?? 'browser';
export function browserCaption(step) {
  const action = browserAction(step), args = step.args && !step.args.truncated ? step.args : {};
  return { verb: browserVerbs[action] ?? action, object: browserObject(action, step, args).trim() };
}
// The agent's latest message before each browser step explains why it took that step.
export function browserNarration(steps) {
  const said = new Map();
  let latest = '';
  for (const step of steps) {
    if (step.kind === 'message' && step.text?.trim()) latest = short(step.text, 140);
    else if (step.kind === 'browser.step') said.set(step.seq, latest);
  }
  return said;
}
export function stepTitle(step) {
  switch (step.kind) {
    case 'turn.start': return `${step.turn?.role === 'reviewer' ? 'Reviewer' : 'Agent'} turn ${step.turn?.attempt ?? ''} started`;
    case 'turn.end': return `Turn ended · ${step.outcome ?? ''}`;
    case 'message': return short(step.text, 70);
    case 'tool.call': return `${step.name}${step.input?.command ? ` ${short(step.input.command, 40)}` : ''}`;
    case 'browser.step': return browserTitle(step);
    case 'files': return `${step.paths?.length ?? 0} file${step.paths?.length === 1 ? '' : 's'} changed`;
    case 'check.end': return `Check ${step.name} · ${step.status}`;
    case 'check.accepted': return `Check ${step.name} · accepted, fails on the base commit too`;
    case 'risk': return `Testing plan · ${step.level} risk · ${step.status}`;
    case 'question': return 'Question for you';
    case 'answer': return 'Your answer';
    case 'delivery': return short(step.message, 70);
    case 'status': return `Status · ${step.status}`;
    case 'dev-server': return `Dev server ${step.phase}`;
    case 'patch': return 'Patch saved';
    case 'model': return `Model · ${step.from} → ${step.to}`;
    default: return step.kind;
  }
}
export function stepArtifacts(step, run) {
  const ids = step.kind === 'browser.step' ? [step.screenshotAfter].filter(Boolean) : step.kind === 'question' ? step.screenshotIds ?? [step.screenshotId].filter(Boolean) : step.kind === 'check.end' ? step.artifactIds ?? [] : step.kind === 'patch' ? [step.artifactId].filter(Boolean) : step.kind === 'tool.result' ? step.imageArtifactIds ?? [] : step.kind === 'tool.call' ? step.result?.imageArtifactIds ?? [] : [];
  return ids.map(id => (run.artifacts ?? []).find(artifact => artifact.id === id)).filter(Boolean);
}
// Non-capturing actions can reuse only an earlier frame, never a later one.
export function browserFrame(steps, selectedSeq = null) {
  const index = selectedSeq === null ? steps.length - 1 : steps.findIndex(step => step.seq === selectedSeq);
  const selected = steps[index];
  return { selected, captured: selected && steps.slice(0, index + 1).findLast(step => step.screenshotAfter && step.turn?.attempt === selected.turn?.attempt) };
}
export const stepHash = (step, currentRunId) => step.runId === currentRunId ? `#step=${step.seq}` : `#step=${step.runId}.${step.seq}`;
export function hashStep(hash, currentRunId) {
  const [, runId, seq] = String(hash ?? '').match(/step=(?:([a-f0-9-]+)\.)?(\d+)/) ?? [];
  return seq ? `${runId ?? currentRunId}:${seq}` : null;
}
