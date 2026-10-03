import test from 'node:test';
import assert from 'node:assert/strict';
import { boardView, conversationKey, folderScope, folderTree, resolvesConflicts, runEntry, taskState } from '../src/board-state.mjs';
import { askOf } from '../web/lib/board.mjs';

const run = (id, status, extra = {}) => ({ id, status, title: id, createdAt: extra.createdAt ?? '2026-09-30T10:00:00Z', ...extra });

test('every run status maps to one board state', () => {
  const expected = {
    queued: 'queued', preparing: 'active', implementing: 'active', validating: 'active', reviewing: 'active', repairing: 'active', publishing: 'active', landing: 'active',
    blocked: 'decision', budget_exceeded: 'decision', failed: 'decision', interrupted: 'decision',
    ready: 'review', planned: 'review', cancelled: 'review',
  };
  for (const [status, state] of Object.entries(expected)) assert.equal(taskState({ latest: run('r', status) }), state, status);
  assert.equal(taskState({ latest: null }), 'todo');
  assert.equal(taskState({ latest: null, item: { archivedAt: 'now' } }), 'archived');
});

test('a task being landed or opened as a pull request is reviewing, not ready for review', () => {
  for (const handingOff of ['landing', 'publishing']) assert.equal(taskState({ latest: run('r', 'ready', { handingOff }) }), 'reviewing', handingOff);
  const view = boardView({ runs: [run('r', 'ready', { handingOff: 'landing' })] });
  assert.deepEqual([view.reviewing.length, view.review.length], [1, 0]);
});

test('a pending native question needs a decision even while the run is active', () => {
  assert.equal(taskState({ latest: run('r', 'implementing', { pendingRequest: { id: 'q' } }) }), 'decision');
  assert.equal(taskState({ latest: run('r', 'implementing', { interactions: [{ status: 'pending' }] }) }), 'decision');
});

test('pause and done apply only to the run they were set on', () => {
  const latest = run('r2', 'failed');
  assert.equal(taskState({ latest, item: { pause: { runId: 'r2' } } }), 'paused');
  assert.equal(taskState({ latest, item: { pause: { runId: 'r1' } } }), 'decision');
  assert.equal(taskState({ latest, item: { done: { runId: 'r2' } } }), 'completed');
  assert.equal(taskState({ latest: run('r2', 'ready') }), 'review');
  assert.equal(taskState({ latest: run('r2', 'ready'), item: { done: { runId: 'r2' } } }), 'completed');
  assert.equal(taskState({ latest, item: { done: { runId: 'r1' } } }), 'decision');
  assert.equal(taskState({ latest: run('r2', 'cancelled'), item: { pause: { runId: 'r2' } } }), 'paused');
});

test('running work is never hidden by archive', () => {
  assert.equal(taskState({ latest: run('r', 'implementing'), item: { archivedAt: 'now' } }), 'active');
  assert.equal(taskState({ latest: run('r', 'ready'), item: { archivedAt: 'now' } }), 'archived');
});

test('conversation keys prefer the saved task id', () => {
  assert.equal(conversationKey({ id: 'run', taskId: 'task' }), 'task');
  assert.equal(conversationKey({ id: 'run' }), 'run');
});

test('folder scope includes descendants and survives cycles', () => {
  const folders = [{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }, { id: 'x', parentId: 'y' }, { id: 'y', parentId: 'x' }];
  assert.deepEqual([...folderScope(folders, 'a')].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...folderScope(folders, 'x')].sort(), ['x', 'y']);
  assert.deepEqual(folderTree(folders).map(({ folder, depth }) => `${folder.id}${depth}`), ['a0', 'b1', 'c2']);
});

test('board view groups one entry per conversation and filters by folder', () => {
  const runs = [
    run('b2', 'blocked', { previousRunId: 'b1', createdAt: '2026-09-30T12:00:00Z' }),
    run('b1', 'ready', { supersededBy: 'b2', taskId: 'task-b', createdAt: '2026-09-30T11:00:00Z' }),
    run('a1', 'implementing'),
  ];
  const tasks = [{ id: 'task-c', title: 'Saved' }];
  const board = { folders: [{ id: 'f', parentId: null }, { id: 'g', parentId: 'f' }], items: { 'task-b': { folderId: 'g' } } };
  const view = boardView({ runs, tasks, board });
  assert.deepEqual(view.decision.map(entry => [entry.key, entry.latest.id, entry.turns]), [['task-b', 'b2', 2]]);
  assert.deepEqual(view.active.map(entry => entry.key), ['a1']);
  assert.deepEqual(view.todo.map(entry => entry.key), ['task-c']);
  const scoped = boardView({ runs, tasks, board, folderId: 'f' });
  assert.deepEqual(Object.values(scoped).flat().map(entry => entry.key), ['task-b']);
});

test('a run resolves to its conversation entry, so any run page can act on the ticket', () => {
  const runs = [run('b2', 'blocked', { previousRunId: 'b1', createdAt: '2026-09-30T12:00:00Z' }), run('b1', 'ready', { supersededBy: 'b2', taskId: 'task-b', createdAt: '2026-09-30T11:00:00Z' })];
  const board = { items: { 'task-b': { archivedAt: '2026-09-30T12:00:00Z' } } };
  assert.deepEqual([runEntry({ runs, board }, 'b1').key, runEntry({ runs, board }, 'b1').latest.id, runEntry({ runs, board }, 'b2').key], ['task-b', 'b2', 'task-b']);
  assert.equal(runEntry({ runs, board }, 'missing'), null);
});

test('decision rows ask the agent question, a single native question, or offer retry', () => {
  const blocked = askOf(run('r', 'blocked', { resumable: true, question: 'Which status code?\n1. Return 401 (Recommended)\n2. Redirect' }));
  assert.equal(blocked.kind, 'followup'); assert.equal(blocked.text, 'Which status code?');
  assert.deepEqual(blocked.options.map(option => [option.label, option.recommended]), [['Return 401', true], ['Redirect', false]]);
  const native = askOf(run('r', 'implementing', { pendingRequest: { id: 'req', questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }] } }));
  assert.deepEqual([native.kind, native.requestId, native.questionId, native.options.length], ['request', 'req', 'q', 2]);
  assert.equal(askOf(run('r', 'implementing', { pendingRequest: { id: 'req', questions: [{}, {}] } })).kind, 'open');
  const failed = askOf(run('r', 'failed', { resumable: true, reason: 'Checks failed' }));
  assert.deepEqual([failed.text, failed.options[0].label, failed.markDone], ['Checks failed', 'Retry', true]);
  assert.equal(askOf(run('r', 'failed', { resumable: false })).options.length, 0);
});

test('a landing shows while it runs or needs you and leaves the board once it lands or is cancelled', () => {
  const landing = status => boardView({ runs: [run('l', status, { kind: 'landing' }), run('t', 'ready')] });
  assert.deepEqual(landing('landing').active.map(entry => entry.key), ['l']);
  assert.deepEqual(landing('failed').decision.map(entry => entry.key), ['l']);
  for (const status of ['ready', 'cancelled']) {
    const view = landing(status);
    assert.deepEqual(Object.values(view).flat().map(entry => entry.key), ['t'], status);
  }
});

test('a landing that needs you shows in the folders of the tasks it lands', () => {
  const runs = [run('l', 'failed', { kind: 'landing', landedRunIds: ['t2'] }), run('t1', 'ready', { taskId: 'a' }), run('t2', 'ready', { taskId: 'a', previousRunId: 't1' }), run('u', 'ready')];
  const board = { folders: [{ id: 'f', parentId: null }, { id: 'g', parentId: 'f' }, { id: 'h', parentId: null }], items: { a: { folderId: 'g' } } };
  assert.deepEqual(boardView({ runs, board, folderId: 'f' }).decision.map(entry => entry.key), ['l']);
  assert.deepEqual(boardView({ runs, board, folderId: 'h' }).decision, []);
});

test('a running landing folds into the tasks it lands instead of showing its own row', () => {
  for (const status of ['queued', 'landing', 'validating']) {
    const landing = run('l', status, { kind: 'landing', landedRunIds: ['t2'] });
    const view = boardView({ runs: [landing, run('t1', 'ready', { taskId: 'a', supersededBy: 't2' }), run('t2', 'ready', { taskId: 'a', previousRunId: 't1', handingOff: 'landing' }), run('u', 'ready')] });
    assert.deepEqual(view.reviewing.map(entry => [entry.key, entry.state, entry.landing.id]), [['a', 'reviewing', 'l']], status);
    assert.deepEqual(view.review.map(entry => entry.key), ['u'], status);
    assert.equal(view.active.length + view.queued.length, 0, status);
  }
});

test('a task resolving landing conflicts stays tied to its landing', () => {
  const runs = [run('l', 'landing', { kind: 'landing', landedRunIds: ['t1'] }), run('t1', 'ready', { supersededBy: 't2' }), run('t2', 'implementing', { previousRunId: 't1', resolvesConflicts: true, createdAt: '2026-09-30T11:00:00Z' })];
  const [entry] = boardView({ runs }).active;
  assert.deepEqual([entry.key, entry.state, entry.landing.id, resolvesConflicts(entry.latest)], ['t1', 'active', 'l', true]);
  assert.equal(resolvesConflicts(run('r', 'queued', { resolvesConflicts: true })), false);
  assert.equal(resolvesConflicts(run('r', 'ready', { resolvesConflicts: true })), false);
});

test('a stopped task whose worktree was removed is completed, whatever it ended as', () => {
  for (const status of ['ready', 'failed', 'blocked']) assert.equal(taskState({ latest: run('r', status, { worktreeRemovedAt: 'now' }) }), 'completed', status);
  assert.equal(taskState({ latest: run('r', 'ready', { worktreeRemovedAt: 'now' }), item: { archivedAt: 'now' } }), 'archived');
});

test('a task shows the worker summary once one exists and keeps the typed request for search', () => {
  const runs = [
    run('s2', 'ready', { previousRunId: 's1', summary: 'Show worker summaries as task names', createdAt: '2026-09-30T12:00:00Z' }),
    run('s1', 'ready', { supersededBy: 's2', title: 'typed words', request: 'typed words\nmore detail' }),
    run('q1', 'blocked', { title: 'a question', summary: null }),
  ];
  const tasks = [{ id: 'task-t', title: 'Saved', request: 'Saved\nbody text' }];
  const byKey = Object.fromEntries(Object.values(boardView({ runs, tasks })).flat().map(entry => [entry.key, entry]));
  assert.deepEqual([byKey.s1.title, byKey.s1.request], ['Show worker summaries as task names', 'typed words\nmore detail']);
  assert.equal(byKey.q1.title, 'a question');
  assert.deepEqual([byKey['task-t'].title, byKey['task-t'].request], ['Saved', 'Saved\nbody text']);
});
