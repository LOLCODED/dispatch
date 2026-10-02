import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, linkedEntries, terms } from '../web/lib/brain-graph.mjs';
import { createSimulation } from '../web/lib/force.mjs';

const projects = [{ id: 'p1', name: 'Shop' }, { id: 'p2', name: 'Docs' }];
const entry = (id, fields) => ({ id, kind: 'rule', scope: 'global', label: id, enabled: true, origin: { runId: null }, ...fields });

test('every memory hangs off its scope and every repository hangs off Everywhere, so the graph is one piece', () => {
  const graph = buildGraph([entry('a', { scope: 'project:p1' }), entry('b')], projects);
  const edges = graph.links.map(link => `${link.source}>${link.target}`);
  assert.ok(edges.includes('scope:global>scope:project:p1'));
  assert.ok(edges.includes('scope:global>scope:project:p2'));
  assert.ok(edges.includes('scope:project:p1>a'));
  assert.ok(edges.includes('scope:global>b'));
});

test('memories from the same run share a run node and count as linked', () => {
  const graph = buildGraph([entry('a', { origin: { runId: 'r1' } }), entry('b', { origin: { runId: 'r1' } }), entry('c', { origin: { runId: 'r2' } })], projects);
  assert.equal(graph.nodes.filter(node => node.type === 'run').length, 1);
  assert.deepEqual([...linkedEntries(graph, 'a')], ['b']);
  assert.equal(linkedEntries(graph, 'c').size, 0);
});

test('shared distinctive words link memories without forming cliques from common words', () => {
  const graph = buildGraph([entry('a', { label: 'Never use Prisma migrations' }), entry('b', { label: 'Prisma client lives in lib' }), entry('c', { label: 'Unrelated styling rule' })], projects);
  assert.ok(graph.links.some(link => link.kind === 'term' && [link.source, link.target].sort().join() === 'a,b'));
  assert.equal(linkedEntries(graph, 'c').size, 0);
  assert.deepEqual(terms({ label: 'Always use the dispatch browser' }), ['browser']);
});

test('the simulation settles to finite positions and keeps earlier positions on rebuild', () => {
  const entries = Array.from({ length: 60 }, (_, index) => entry(`e${index}`, { scope: index % 2 ? 'project:p1' : 'global', origin: { runId: `r${index % 7}` } }));
  const graph = buildGraph(entries, projects), sim = createSimulation(graph);
  sim.settle(400);
  assert.ok(sim.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y) && Math.abs(node.x) < 5000));
  assert.equal(sim.active(), false);
  const again = createSimulation(graph, sim.byId);
  assert.equal(again.byId.get('e3').x, sim.byId.get('e3').x);
});
