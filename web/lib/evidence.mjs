const sameSource = (a, b) => a.check === b.check && a.attempt === b.attempt;

export function groupEvidence(entries) {
  const result = [];
  for (const entry of entries) {
    const last = result.at(-1);
    if (entry.type !== 'artifact') result.push(entry);
    else if (last?.type === 'evidence' && sameSource(last.artifacts[0], entry.artifact)) last.artifacts.push(entry.artifact);
    else result.push({ id: `evidence-${entry.id}`, at: entry.at, type: 'evidence', artifacts: [entry.artifact] });
  }
  return result;
}

export function stepThrough(items, current, delta) {
  const index = items.findIndex(item => item.id === current.id);
  if (index < 0 || items.length < 2) return current;
  return items[(index + delta + items.length) % items.length];
}
