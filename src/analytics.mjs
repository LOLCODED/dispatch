import { terminal } from './catalog.mjs';
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const time = value => { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; };
export const phaseKeys = ['capabilitiesMs', 'worktreeMs', 'setupMs', 'lockWaitMs', 'publishMs', 'deliveryMs'];
const phases = run => Object.fromEntries(phaseKeys.map(key => [key, number(run.timings?.[key])]));
const average = values => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
export function runInsights(run, now = Date.now()) {
  const created = time(run.createdAt), started = time(run.startedAt), finished = time(run.finishedAt);
  const end = finished ?? (terminal.has(run.status) ? null : now);
  const duration = (from, to) => from === null || to === null ? null : Math.max(0, to - from);
  const input = number(run.usage?.input), cachedInput = number(run.usage?.cachedInput), output = number(run.usage?.output);
  return {
    elapsedMs: duration(created, end), executionMs: duration(started, end), queueMs: duration(created, started ?? end),
    checkMs: run.checks?.length ? run.checks.reduce((sum, c) => sum + (number(c.durationMs) ?? 0), 0) : 0,
    workerMs: Array.isArray(run.workerTurns) && run.workerTurns.every(turn => number(turn.durationMs) !== null) ? run.workerTurns.reduce((sum, turn) => sum + turn.durationMs, 0) : null,
    promptCharacters: Array.isArray(run.workerTurns) ? run.workerTurns.reduce((sum, turn) => sum + (number(turn.promptCharacters) ?? 0), 0) : null,
    repairs: Math.max(0, (run.attempt ?? 0) - 1), phases: phases(run),
    tokens: { input, cachedInput, uncachedInput: input !== null && cachedInput !== null && cachedInput <= input ? input - cachedInput : null, output, total: input !== null && output !== null ? input + output : null },
    startedAt: run.startedAt ?? null, finishedAt: run.finishedAt ?? null,
  };
}
function providerTokens(runs, records) {
  const totals = {};
  runs.forEach((run, index) => {
    const tokens = records[index].tokens, entry = totals[run.execution?.provider ?? run.provider ?? 'codex'] ??= { runs: 0, reportedRuns: 0, input: 0, cachedInput: 0, output: 0 };
    entry.runs++;
    if (tokens.total === null) return;
    entry.reportedRuns++; entry.input += tokens.input; entry.cachedInput += tokens.cachedInput ?? 0; entry.output += tokens.output;
  });
  return totals;
}
export function analytics(runs, now = Date.now()) {
  const live = runs.filter(run => run.mode === 'live');
  const records = live.map(run => ({ id: run.id, title: run.title, project: run.project?.name ?? 'Unknown repository', status: run.status, createdAt: run.createdAt, ...runInsights(run, now) }));
  const completed = records.filter(r => r.status === 'ready');
  const finished = records.filter(r => terminal.has(r.status));
  const known = records.filter(r => r.tokens.total !== null);
  return { generatedAt: new Date(now).toISOString(), totalRuns: records.length, activeRuns: records.length - finished.length, completedRuns: completed.length,
    successRate: finished.length ? completed.length / finished.length : null,
    averageCompletionMs: average(completed.map(r => r.executionMs).filter(n => n !== null)),
    averagePhasesMs: Object.fromEntries(phaseKeys.map(key => [key, average(completed.map(r => r.phases[key]).filter(n => n !== null))])),
    tokens: { reportedTotal: known.reduce((sum, r) => sum + r.tokens.total, 0), knownRuns: known.length, unknownRuns: records.length - known.length }, providers: providerTokens(live, records), records };
}
