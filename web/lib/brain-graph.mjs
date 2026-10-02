import { scopeName } from './brain.mjs';

const stopwords = new Set('about after again always also because before being between both could does doing during each from have having here into just like make more most must never only other over same should some such than that their them then there these they this those through under until very were what when where which while with without would your yours dispatch'.split(' '));
const termLimits = { minLength: 4, maxShared: 12 };

export function terms(entry) {
  const text = [entry.label, entry.text, entry.key, entry.trigger, entry.action].filter(Boolean).join(' ').toLowerCase();
  return [...new Set(text.match(/[a-z][a-z0-9-]+/g) ?? [])].filter(word => word.length >= termLimits.minLength && !stopwords.has(word));
}

const runOf = entry => entry.origin?.runId ?? entry.lastRunId ?? null;

function scopeNodes(entries, projects) {
  const scopes = new Set(['global', ...projects.map(project => `project:${project.id}`), ...entries.map(entry => entry.scope)]);
  return [...scopes].map(scope => ({ id: `scope:${scope}`, type: 'scope', scope, label: scopeName(scope, projects) }));
}

function sharedBy(entries, keyOf) {
  const groups = new Map();
  for (const entry of entries) for (const key of [keyOf(entry)].flat()) {
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry.id);
  }
  return groups;
}

function runLinks(entries) {
  const nodes = [], links = [];
  for (const [runId, ids] of sharedBy(entries, runOf)) {
    if (ids.length < 2) continue;
    nodes.push({ id: `run:${runId}`, type: 'run', runId, label: 'Run' });
    for (const id of ids) links.push({ source: `run:${runId}`, target: id, kind: 'run' });
  }
  return { nodes, links };
}

// A term shared by many memories says little about any pair, so common terms are skipped and shared ones chain instead of forming cliques.
function termLinks(entries) {
  const links = [], seen = new Set();
  for (const ids of sharedBy(entries, terms).values()) {
    if (ids.length < 2 || ids.length > termLimits.maxShared) continue;
    for (let index = 1; index < ids.length; index++) {
      const [a, b] = [ids[index - 1], ids[index]].sort(), key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key); links.push({ source: a, target: b, kind: 'term' });
    }
  }
  return links;
}

export function buildGraph(entries = [], projects = []) {
  const scopes = scopeNodes(entries, projects), runs = runLinks(entries);
  const memories = entries.map(entry => ({ id: entry.id, type: 'entry', kind: entry.kind, label: entry.label, entry }));
  const links = [
    ...scopes.filter(node => node.scope !== 'global').map(node => ({ source: 'scope:global', target: node.id, kind: 'scope' })),
    ...entries.map(entry => ({ source: `scope:${entry.scope}`, target: entry.id, kind: 'memory' })),
    ...runs.links,
    ...termLinks(entries),
  ];
  const nodes = [...scopes, ...runs.nodes, ...memories], degree = new Map(nodes.map(node => [node.id, 0]));
  for (const link of links) { degree.set(link.source, degree.get(link.source) + 1); degree.set(link.target, degree.get(link.target) + 1); }
  return { nodes: nodes.map(node => ({ ...node, degree: degree.get(node.id) })), links };
}

export function linkedEntries(graph, id) {
  const direct = neighbours(graph, id), linked = new Set();
  for (const other of direct) {
    if (other === id || other.startsWith('scope:')) continue;
    if (other.startsWith('run:')) for (const sibling of neighbours(graph, other)) { if (sibling !== id && sibling !== other) linked.add(sibling); }
    else linked.add(other);
  }
  return linked;
}

export function neighbours(graph, id) {
  const found = new Set([id]);
  for (const link of graph.links) {
    if (link.source === id) found.add(link.target);
    if (link.target === id) found.add(link.source);
  }
  return found;
}
