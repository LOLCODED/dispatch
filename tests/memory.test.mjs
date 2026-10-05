import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Memory, limits, noteId, parseLearnings, parseNotes, renderNotes, pruneNotes, selectNotes, similar } from '../src/memory.mjs';

const project = { id: 'p1', setup: [{ id: 'install', command: 'npm', args: ['ci'] }], validation: [{ id: 'unit', command: 'npm', args: ['run', 'test'] }] };
const readyRun = (overrides = {}) => ({ id: 'run-1', projectId: 'p1', project, status: 'ready', finishedAt: '2026-09-29T10:00:00.000Z', title: 'Fix balance label', ticket: { key: 'T-1' }, checks: [{ name: 'unit', status: 'passed' }], changedPaths: ['a.mjs', 'b.mjs'], summary: 'Changed things.\n\nNotes for next time:\n- Run npm ci before the unit check\n- Prefer the shared money formatter\n', ...overrides });
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-memory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, memory: new Memory(dir) };
}

test('first ready run creates notes with the recipe summary, learnings and a task summary', t => {
  const { dir, memory } = fixture(t);
  const summary = memory.record(readyRun());
  const notes = readFileSync(join(dir, 'memory', 'p1', 'notes.md'), 'utf8');
  assert.match(notes, /^## Build and checks\n- Setup: npm ci\n- Check unit: npm run test\n\n## Gotchas\n- Run npm ci before the unit check\n\n## Conventions\n- Prefer the shared money formatter\n\n## Recent tasks\n- 2026-09-29 Fix balance label — ready, 2 files\n$/);
  assert.deepEqual(summary.learnings, ['Run npm ci before the unit check', 'Prefer the shared money formatter']);
  const tasks = readFileSync(join(dir, 'memory', 'p1', 'tasks.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(tasks, [{ runId: 'run-1', at: '2026-09-29T10:00:00.000Z', ticketKey: 'T-1', title: 'Fix balance label', status: 'ready', checks: [{ name: 'unit', status: 'passed' }], filesChanged: 2, learnings: summary.learnings }]);
});

test('learnings come only from the Notes for next time section with item, length and duplicate limits', t => {
  assert.deepEqual(parseLearnings('- Not a learning\nNotes for next time:\n- one\n* two\n- three\n- four\n\nTrailing text'), ['one', 'two', 'three']);
  assert.deepEqual(parseLearnings('Notes for next time: none'), []);
  assert.deepEqual(parseLearnings('**Notes for next time:**\n- none\n'), []);
  assert.deepEqual(parseLearnings('No section here\n- bullet'), []);
  assert.deepEqual(parseLearnings(`Notes for next time:\n- ${'x'.repeat(300)}`), ['x'.repeat(limits.learningCharacters)]);
  assert.deepEqual(parseLearnings('Notes for next time:\n\n- after blank\nplain line\n- ignored'), ['after blank']);
  const { memory } = fixture(t);
  memory.record(readyRun());
  const second = memory.record(readyRun({ id: 'run-2', summary: 'Notes for next time:\n- run NPM CI before the unit check\n- Cache the fixture\n- Cache the fixture' }));
  assert.deepEqual(second.learnings, ['Cache the fixture']);
  assert.equal((memory.readNotes('p1').match(/Cache the fixture/g) ?? []).length, 1);
});

test('a newer note about the same thing replaces the older one', t => {
  assert.ok(similar('`dispatch_browser_type` and `dispatch_browser_click` reject `f1e…`-style refs that appear after navigating, so you can’t type into fields on those snapshots.', 'The dispatch browser can click `f1e…`-style refs after navigating; only typing into fields may be blocked.'));
  assert.ok(!similar('The shell is fish; bash-style loops in Bash commands get blocked.', '`python3` heredocs and fish `for` loops are blocked by edit approval; use the Edit tool.'));
  const { memory } = fixture(t);
  memory.record(readyRun({ summary: 'Notes for next time:\n- tests/server.test.mjs needs a built dist/ (npx vite build); without it pages fail with 503.' }));
  const second = memory.record(readyRun({ id: 'run-2', summary: 'Notes for next time:\n- `tests/server.test.mjs` needs a built `dist/` (`npx vite build`), or it fails with 503s.' }));
  assert.deepEqual(second.forgotten, ['tests/server.test.mjs needs a built dist/ (npx vite build); without it pages fail with 503.']);
  assert.deepEqual(parseNotes(memory.readNotes('p1')).get('Gotchas'), ['- `tests/server.test.mjs` needs a built `dist/` (`npx vite build`), or it fails with 503s.']);
  assert.deepEqual(memory.addLine('p1', 'Gotchas', 'server.test.mjs needs dist/ from npx vite build first, or 503s.'), { added: true, forgotten: ['`tests/server.test.mjs` needs a built `dist/` (`npx vite build`), or it fails with 503s.'] });
});

test('a note no ready run was given or learned again within the last runs ages out unless the operator kept it', t => {
  const { memory } = fixture(t), kept = 'Seed the ledger fixture before balance tests';
  memory.record(readyRun({ summary: `Notes for next time:\n- Playwright needs chromium installed\n- ${kept}\n- Balance labels use the shared formatter` }));
  const used = [noteId('Balance labels use the shared formatter')];
  for (let index = 2; index <= limits.unusedRuns; index++) memory.record(readyRun({ id: `run-${index}`, summary: '', memory: { used } }), undefined, { keep: new Set([noteId(kept)]) });
  assert.match(memory.readNotes('p1'), /Playwright needs chromium/);
  const last = memory.record(readyRun({ id: 'run-last', summary: '', memory: { used } }), undefined, { keep: new Set([noteId(kept)]) });
  assert.deepEqual(last.forgotten, ['Playwright needs chromium installed']);
  assert.deepEqual(parseNotes(memory.readNotes('p1')).get('Gotchas'), [`- ${kept}`, '- Balance labels use the shared formatter']);
});

test('blocked and failed runs record a task summary line only', t => {
  const { dir, memory } = fixture(t);
  memory.record(readyRun({ status: 'blocked', summary: 'DISPATCH_BLOCKED: which policy?\nNotes for next time:\n- should not be stored' }));
  memory.record(readyRun({ id: 'run-2', status: 'failed', checks: [{ name: 'unit', status: 'failed' }] }));
  assert.equal(existsSync(join(dir, 'memory', 'p1', 'notes.md')), false);
  const tasks = memory.readTasks('p1');
  assert.deepEqual(tasks.map(task => [task.status, task.learnings]), [['blocked', []], ['failed', []]]);
  assert.deepEqual(memory.select('p1', 'anything'), { text: '', injectedCharacters: 0, sourceLines: 0, notesBytes: 0, used: [] });
});

test('notes prune recent tasks then gotchas within the caps and never touch build and checks', t => {
  const { memory } = fixture(t), gotcha = index => `Gotcha number ${index} ${'detail '.repeat(8)}`.trim();
  const keep = new Set(Array.from({ length: 150 }, (_, index) => noteId(gotcha(index))));
  const forgotten = [];
  for (let index = 0; index < 150; index++) forgotten.push(...memory.record(readyRun({ id: `run-${index}`, title: `Task ${index}`, summary: `Notes for next time:\n- ${gotcha(index)}` }), undefined, { keep }).forgotten ?? []);
  assert.equal(forgotten[0], gotcha(0));
  const notes = memory.readNotes('p1'), parsed = parseNotes(notes);
  assert.ok(Buffer.byteLength(notes) <= limits.notesBytes); assert.ok(notes.split('\n').length <= limits.notesLines);
  assert.deepEqual(parsed.get('Build and checks'), ['- Setup: npm ci', '- Check unit: npm run test']);
  assert.equal(parsed.get('Recent tasks').length, 0);
  assert.ok(parsed.get('Gotchas').length > 0); assert.match(parsed.get('Gotchas').at(-1), /Gotcha number 149/); assert.doesNotMatch(notes, /Gotcha number 0 /);
  assert.equal(memory.readTasks('p1', 1000).length, 150);
  for (let index = 150; index < 260; index++) memory.record(readyRun({ id: `run-${index}`, status: 'failed' }));
  const tasks = memory.readTasks('p1', 1000);
  assert.equal(tasks.length, limits.taskLines); assert.equal(tasks[0].runId, 'run-60'); assert.equal(memory.readTasks('p1').length, limits.summaries);
});

test('pruning removes the oldest recent-task lines before any gotcha', () => {
  const parsed = parseNotes(`## Build and checks\n- Setup: npm ci\n## Gotchas\n${Array.from({ length: 60 }, (_, i) => `- Gotcha ${i}`).join('\n')}\n## Conventions\n## Recent tasks\n${Array.from({ length: 80 }, (_, i) => `- Task ${i}`).join('\n')}\n`);
  const pruned = pruneNotes(parsed);
  assert.equal(pruned.get('Gotchas').length, 60); assert.ok(pruned.get('Recent tasks').length < 80); assert.equal(pruned.get('Recent tasks')[0], `- Task ${80 - pruned.get('Recent tasks').length}`);
  assert.ok(renderNotes(pruned).split('\n').length <= limits.notesLines);
});

test('selection keeps build and checks, matches lines by word overlap and respects the character cap', t => {
  const { memory } = fixture(t);
  memory.record(readyRun({ summary: 'Notes for next time:\n- Balance labels use the shared formatter\n- Playwright needs chromium installed\n- Prefer arrow functions in lib' }));
  for (let index = 0; index < 8; index++) memory.record(readyRun({ id: `run-${index}`, title: index === 6 ? 'Older balance ticket' : `Unrelated ${index}` }));
  const slice = memory.select('p1', 'Fix the account balance label wording');
  assert.equal(slice.text, '## Build and checks\n- Setup: npm ci\n- Check unit: npm run test\n\n## Gotchas\n- Balance labels use the shared formatter\n\n## Recent tasks\n- 2026-09-29 Older balance ticket — ready, 2 files\n');
  assert.equal(slice.injectedCharacters, slice.text.length); assert.equal(slice.sourceLines, 4); assert.equal(slice.notesBytes, Buffer.byteLength(memory.readNotes('p1')));
  assert.equal(memory.select('p1', 'the and with').text, '## Build and checks\n- Setup: npm ci\n- Check unit: npm run test\n');
  const long = selectNotes(`## Build and checks\n- Setup: npm ci\n## Gotchas\n${Array.from({ length: 40 }, (_, i) => `- Widget gotcha ${i} ${'padding '.repeat(10)}`).join('\n')}\n## Conventions\n## Recent tasks\n`, 'widget');
  assert.ok(long.text.length <= limits.sliceCharacters); assert.ok(long.sourceLines > 1 && long.sourceLines < 41);
});

test('notes live under the data directory and are plain markdown editable by section', t => {
  const { dir, memory } = fixture(t);
  memory.record(readyRun());
  assert.equal(memory.notesPath('p1'), join(dir, 'memory', 'p1', 'notes.md'));
  assert.deepEqual([...parseNotes('## Gotchas\n- hand edited\n\n## Build and checks\n- Setup: make\n## Extra\n- kept').keys()], ['Build and checks', 'Gotchas', 'Conventions', 'Recent tasks', 'Extra']);
  assert.deepEqual(memory.read('p1').tasks.length, 1); assert.equal(memory.read('p1').path, join(dir, 'memory', 'p1'));
});
