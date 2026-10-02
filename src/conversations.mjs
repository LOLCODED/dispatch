const createdAt = run => Date.parse(run.createdAt) || 0;

export function rootOf(run, byId) {
  const seen = new Set([run.id]);
  let current = run;
  while (current.previousRunId && byId.has(current.previousRunId) && !seen.has(current.previousRunId)) {
    current = byId.get(current.previousRunId);
    seen.add(current.id);
  }
  return current;
}

export function latestRun(runs, run) {
  const seen = new Set();
  let current = run;
  while (current?.supersededBy && !seen.has(current.id)) {
    seen.add(current.id);
    const next = runs.find(candidate => candidate.id === current.supersededBy);
    if (!next || seen.has(next.id)) break;
    current = next;
  }
  return current;
}

// Groups follow-ups under the run that started the conversation, newest conversation first.
export function conversationTree(runs) {
  const byId = new Map(runs.map(run => [run.id, run])), chains = new Map();
  for (const run of runs) {
    const root = rootOf(run, byId);
    if (!chains.has(root.id)) chains.set(root.id, []);
    chains.get(root.id).push(run);
  }
  const latest = chain => Math.max(...chain.map(createdAt));
  return [...chains.values()].map(chain => chain.sort((a, b) => createdAt(a) - createdAt(b))).sort((a, b) => latest(b) - latest(a));
}
