const time = value => { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; };

export function runElapsed(run, done, now) {
  const started = time(run.startedAt);
  return !done && started !== null ? Math.max(0, now - started) : run.insights?.executionMs ?? null;
}

export function conversationElapsed(run, history, done, now) {
  const first = [...history].reverse().find(earlier => time(earlier.startedAt) !== null);
  const started = time(first?.startedAt), end = done ? time(run.finishedAt) : now;
  return started === null || end === null ? runElapsed(run, done, now) : Math.max(0, end - started);
}

export function runDurations(run, history, done, now) {
  return [...history].reverse().concat(run).map((item, index) => ({ id: item.id, label: `Run ${index + 1}`, ms: item === run ? runElapsed(run, done, now) : item.insights?.executionMs ?? null }));
}
