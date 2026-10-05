import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { Memory } from '../src/memory.mjs';
import { Brain, entrySchema, ladder, modeFor, promote, streak } from '../src/brain.mjs';

function fixture(t, projects = []) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-brain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir); store.state.projects = projects; const memory = new Memory(dir);
  return { dir, store, memory, brain: new Brain(store, { memory, connectorIds: () => ['forge', 'example'] }) };
}
const project = (id, instructions = []) => ({ id, name: `Repo ${id}`, instructions, connectors: { example: { enabled: id === 'p1', actions: {}, settings: {} }, forge: { enabled: false, actions: {}, settings: {} } }, setup: [], validation: [] });

test('the ladder promotes after consistent answers and resets on change or undo', () => {
  const entry = entrySchema({ kind: 'preference', trigger: 'delivery.pr-opened', action: 'tracker.set-state' });
  assert.equal(modeFor(entry), 'ask');
  promote(entry, 'Testing'); assert.equal(entry.mode, 'ask');
  promote(entry, 'Testing'); assert.equal(entry.mode, 'suggest'); assert.equal(entry.value, 'Testing');
  promote(entry, 'Testing'); promote(entry, 'Testing'); assert.equal(entry.mode, 'auto');
  promote(entry, 'Done'); assert.equal(entry.mode, 'ask'); assert.equal(entry.value, 'Done');
  promote(entry, 'Done'); assert.equal(entry.mode, 'suggest');
  promote(entry, null, { undo: true }); assert.equal(entry.mode, 'ask'); assert.deepEqual(streak(entry.answers), { count: 0, value: undefined });
  for (let index = 0; index < 20; index++) promote(entry, 'Done');
  assert.equal(entry.answers.length, ladder.history); assert.equal(entry.mode, 'auto');
  entry.pinned = true; entry.mode = 'ask'; promote(entry, 'Done'); assert.equal(entry.mode, 'ask');
});

test('lookup prefers the project entry, then global, and skips disabled entries', t => {
  const { brain } = fixture(t, [project('p1')]);
  brain.answer({ key: 'branch.template', scope: 'global', value: 'dispatch/{run}' });
  assert.equal(brain.lookup({ key: 'branch.template', projectId: 'p1' }).value, 'dispatch/{run}');
  const local = brain.answer({ key: 'branch.template', projectId: 'p1', value: '{type}/{ticketId}' });
  assert.equal(brain.lookup({ key: 'branch.template', projectId: 'p1' }).value, '{type}/{ticketId}');
  brain.setEnabled(local.id, false);
  assert.equal(brain.lookup({ key: 'branch.template', projectId: 'p1' }).value, 'dispatch/{run}');
  assert.equal(brain.lookup({ key: 'missing', projectId: 'p1' }), null);
});

test('rules import from project instructions once and sync back when toggled, replaced or removed', t => {
  const repo = project('p1', ['Never use Prisma', 'Branch off staging']);
  const { brain, store } = fixture(t, [repo]);
  assert.deepEqual(brain.rules('p1').map(entry => [entry.text, entry.origin.via]), [['Never use Prisma', 'import'], ['Branch off staging', 'import']]);
  new Brain(store, {}); assert.equal(brain.rules('p1').length, 2);
  const rule = brain.rules('p1')[0];
  brain.setEnabled(rule.id, false); assert.deepEqual(repo.instructions, ['Branch off staging']);
  brain.setEnabled(rule.id, true); assert.deepEqual(repo.instructions, ['Never use Prisma', 'Branch off staging']);
  brain.addRule(repo, 'Use the docker database', { via: 'reply' }); assert.equal(repo.instructions.length, 3);
  brain.replaceRules(repo, ['Branch off staging', 'New rule']); assert.deepEqual(repo.instructions, ['Branch off staging', 'New rule']); assert.equal(brain.rules('p1').length, 2);
  brain.remove(brain.rules('p1')[1].id); assert.deepEqual(repo.instructions, ['Branch off staging']);
});

test('notes are projected from notes.md, can be disabled to leave the injected slice, and deleted from the file', t => {
  const repo = project('p1');
  const { brain, memory } = fixture(t, [repo]);
  memory.record({ id: 'run-1', projectId: 'p1', project: repo, status: 'ready', finishedAt: '2026-09-30T00:00:00.000Z', title: 'Task', ticket: { key: 'T' }, checks: [], changedPaths: [], summary: 'Notes for next time:\n- Run docker compose up before tests\n- Prefer the money formatter convention' });
  const notes = brain.catalog({ projectId: 'p1', kind: 'note' });
  assert.deepEqual(notes.map(entry => [entry.text, entry.section, entry.projected]), [['Run docker compose up before tests', 'Gotchas', true], ['Prefer the money formatter convention', 'Conventions', true]]);
  const disabled = brain.setEnabled(notes[0].id, false);
  assert.equal(disabled.projected, undefined); assert.equal(brain.catalog({ projectId: 'p1', kind: 'note' }).filter(entry => entry.enabled).length, 1);
  assert.doesNotMatch(memory.select('p1', 'docker tests', { excluded: brain.disabledNotes('p1') }).text, /docker compose/);
  assert.match(memory.select('p1', 'docker tests').text, /docker compose/);
  brain.remove(brain.catalog({ projectId: 'p1', kind: 'note' })[1].id);
  assert.doesNotMatch(memory.readNotes('p1'), /money formatter/);
  brain.recordNotes({ id: 'run-2', projectId: 'p1' }, ['Run docker compose up before tests', 'Seed the database first']);
  assert.equal(brain.catalog({ projectId: 'p1', kind: 'note' }).find(entry => entry.text === 'Seed the database first').source, 'agent');
});

test('a note that replaces a similar one drops the older entry, and operator notes are kept from ageing out', t => {
  const repo = project('p1');
  const { brain, memory } = fixture(t, [repo]);
  const old = brain.add({ kind: 'note', scope: 'project:p1', text: 'The browser type and click tools reject f1e style refs after navigating, so fields on those snapshots cannot be typed into', source: 'agent' });
  brain.add({ kind: 'note', scope: 'project:p1', text: 'The browser can click f1e style refs after navigating; only typing into fields is refused' });
  assert.equal(brain.find(old.id), null);
  assert.deepEqual(brain.catalog({ projectId: 'p1', kind: 'note' }).map(entry => entry.text), ['The browser can click f1e style refs after navigating; only typing into fields is refused']);
  assert.doesNotMatch(memory.readNotes('p1'), /rejects f1e/);
  assert.equal(brain.keptNotes('p1').size, 1);
});

test('note entries whose line is no longer in notes.md are dropped when the brain loads', t => {
  const repo = project('p1');
  const { store, memory, brain } = fixture(t, [repo]);
  brain.add({ kind: 'note', scope: 'project:p1', text: 'Still in the notes file' });
  store.state.brain.push(entrySchema({ kind: 'note', scope: 'project:p1', text: 'Pruned from the notes file long ago', source: 'agent' }));
  const reloaded = new Brain(store, { memory });
  assert.deepEqual(reloaded.entries.filter(entry => entry.kind === 'note').map(entry => entry.text), ['Still in the notes file']);
});

test('connectors project from project settings and global connector entries become defaults', t => {
  const { brain } = fixture(t, [project('p1'), project('p2')]);
  const connectors = brain.catalog({ projectId: 'p1', kind: 'connector' });
  assert.deepEqual(connectors.map(entry => [entry.key, entry.enabled]), [['connector.forge', false], ['connector.example', true]]);
  assert.deepEqual(brain.connectorDefaults(), {});
  brain.add({ kind: 'connector', scope: 'global', key: 'connector.example' });
  assert.deepEqual(brain.connectorDefaults(), { example: true });
  assert.throws(() => brain.add({ kind: 'connector', scope: 'global', key: 'example' }), /connector\.<name>/);
});

test('search matches labels by word overlap and substring; schema rejects bad input', t => {
  const { brain } = fixture(t, [project('p1', ['Never run migrations; write .sql files'])]);
  brain.answer({ trigger: 'delivery.pr-opened', action: 'tracker.set-state', projectId: 'p1', value: 'Resolved' });
  assert.deepEqual(brain.search('migrations').map(entry => entry.kind), ['rule']);
  assert.deepEqual(brain.search('resolved', { projectId: 'p1' }).map(entry => entry.kind), ['preference']);
  assert.equal(brain.search('nothing here').length, 0);
  assert.throws(() => entrySchema({ kind: 'wish' }), /kind/);
  assert.throws(() => entrySchema({ kind: 'rule', scope: 'team:1', text: 'x' }), /Scope/);
  assert.throws(() => entrySchema({ kind: 'rule', text: 'x'.repeat(201) }), /200/);
  assert.throws(() => entrySchema({ kind: 'preference', value: 'x' }), /key/);
  assert.throws(() => brain.setMode(brain.search('migrations')[0].id, 'auto'), /preferences/);
  const preference = brain.search('resolved')[0];
  assert.equal(brain.setMode(preference.id, 'auto').pinned, true); assert.equal(brain.catalog({ kind: 'preference' })[0].mode, 'auto');
});

test('entries survive a store restart', t => {
  const { brain, store, dir } = fixture(t, [project('p1')]);
  brain.answer({ key: 'tracker.example.organization', projectId: 'p1', value: 'https://tracker.example' });
  store.save();
  const reopened = new Store(dir);
  assert.equal(reopened.state.brain.length, 1); assert.equal(reopened.state.brain[0].value, 'https://tracker.example');
});
