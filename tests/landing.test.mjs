import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../src/local-tools.mjs';
import { taskState } from '../src/board-state.mjs';
import { gated, liveFixture, settle, temporaryFolder, temporaryRepository, unitCheck, until, workerDouble } from './live-double.mjs';
import { landable } from '../src/landing.mjs';
import { publishable } from '../src/pull-requests.mjs';

const writes = files => options => {
  for (const [name, content] of Object.entries(files)) writeFileSync(join(options.workspace, name), content);
  return { outcome: 'completed', sessionId: 'session-1', summary: 'Done' };
};
const byTicket = (tickets, fallback) => async (options, turn) => {
  const entry = Object.entries(tickets).find(([text]) => options.prompt.includes(text));
  return (entry?.[1] ?? fallback)(options, turn);
};
const resolvesNote = writes({ 'note.txt': 'A\nB\n' });
const pairCheck = { id: 'pair', command: process.execPath, args: ['-e', 'const fs=require("fs");process.exit(fs.existsSync("a.txt")&&fs.existsSync("b.txt")?1:0)'] };

async function readyTasks(live, engine, project, inputs) {
  const runs = [];
  for (const input of inputs) { const run = await live.create({ projectId: project.id, input }); await settle(engine, run); assert.equal(run.status, 'ready', JSON.stringify(run.events.at(-1))); runs.push(run); }
  return runs;
}
async function land(live, engine, runs, options = {}) {
  const landing = await live.landings.create({ runIds: runs.map(run => run.id), ...options });
  await settle(engine, landing);
  return landing;
}
const log = (repo, ...args) => git(repo, ['log', '--format=%s', ...args]);

test('squash lands each ready task as one commit on the checked-out base, then removes worktrees and marks them done', async t => {
  const { live, engine, project, repo } = await liveFixture(t, { behavior: byTicket({ 'Add A': writes({ 'value.txt': 'changed', 'a.txt': 'A' }), 'Add B': writes({ 'value.txt': 'changed', 'b.txt': 'B' }) }) });
  const [a, b] = await readyTasks(live, engine, project, ['Add A', 'Add B']);
  const landing = await land(live, engine, [b, a]);
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.at(-1)));
  assert.deepEqual((await log(repo, '-3')).split('\n'), ['Add B', 'Add A', 'Initial']);
  assert.equal(readFileSync(join(repo, 'b.txt'), 'utf8'), 'B');
  assert.equal(await git(repo, ['status', '--porcelain']), '');
  assert.deepEqual(landing.checks.map(check => [check.name, check.status]), [['unit', 'passed']]);
  for (const task of [a, b]) {
    assert.ok(task.worktreeRemovedAt && !existsSync(task.workspace)); assert.equal(task.branchKept, false);
    await assert.rejects(git(repo, ['rev-parse', '--verify', `refs/heads/${task.branch}`]));
    assert.equal(taskState({ latest: task }), 'completed');
  }
  assert.equal(existsSync(landing.workspace), false);
  await assert.rejects(live.landings.create({ runIds: [a.id] }), /no tested commit/);
});

test('a conflict goes back to the task\'s own session, which resolves the merged target before the landing continues', async t => {
  const prompts = [];
  const behavior = byTicket({ 'dispatch is landing': options => { prompts.push(options); return resolvesNote(options); }, 'Add A': writes({ 'value.txt': 'changed', 'note.txt': 'A\n' }), 'Add B': writes({ 'value.txt': 'changed', 'note.txt': 'B\n' }) });
  const { live, engine, project, repo } = await liveFixture(t, { behavior });
  const [a, b] = await readyTasks(live, engine, project, ['Add A', 'Add B']);
  const landing = await land(live, engine, [a, b], { strategy: 'rebase' });
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.map(event => event.message)));
  const resolution = engine.get(landing.landing.items[1].resolutionRunId);
  assert.equal(resolution.previousRunId, b.id); assert.equal(resolution.sessionId, b.sessionId); assert.equal(prompts[0].sessionId, 'session-1');
  assert.match(resolution.input, /These files conflict: note\.txt/); assert.equal(landing.landing.items[1].landedAs, 'squash');
  assert.equal(readFileSync(join(repo, 'note.txt'), 'utf8'), 'A\nB\n');
  assert.equal(await log(repo, '-1'), 'Add B');
  assert.equal(await git(repo, ['rev-list', '--merges', '--count', 'HEAD']), '0');
  assert.equal(taskState({ latest: resolution }), 'completed');
});

test('conflict markers left by the agent send it back for a repair turn', async t => {
  let resolutions = 0;
  const behavior = byTicket({ 'Conflict markers remain': resolvesNote, 'dispatch is landing': options => { resolutions++; return { outcome: 'completed', sessionId: 'session-1' }; }, 'Add A': writes({ 'value.txt': 'changed', 'note.txt': 'A\n' }), 'Add B': writes({ 'value.txt': 'changed', 'note.txt': 'B\n' }) });
  const { live, engine, project, repo } = await liveFixture(t, { behavior });
  const tasks = await readyTasks(live, engine, project, ['Add A', 'Add B']);
  const landing = await land(live, engine, tasks);
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.map(event => event.message)));
  assert.equal(resolutions, 1); assert.equal(engine.get(landing.landing.items[1].resolutionRunId).attempt, 2);
  assert.equal(readFileSync(join(repo, 'note.txt'), 'utf8'), 'A\nB\n');
});

test('merge keeps a merge commit per task and rebase replays the task commits', async t => {
  const { live, engine, project, repo } = await liveFixture(t, { behavior: byTicket({ 'Add A': writes({ 'value.txt': 'changed', 'a.txt': 'A' }), 'Add B': writes({ 'value.txt': 'changed', 'b.txt': 'B' }) }) });
  const [a, b] = await readyTasks(live, engine, project, ['Add A', 'Add B']);
  assert.equal((await land(live, engine, [a], { strategy: 'merge' })).status, 'ready');
  assert.equal(await git(repo, ['rev-list', '--merges', '--count', 'HEAD']), '1'); assert.match(await log(repo, '-1'), /^Add A$/);
  assert.equal((await land(live, engine, [b], { strategy: 'rebase' })).status, 'ready');
  assert.equal(await log(repo, '-1'), 'Add B'); assert.equal(await git(repo, ['rev-list', '--merges', '--count', 'HEAD']), '1');
});

test('a check that fails on the combined result moves nothing and keeps the task worktrees', async t => {
  const { live, engine, project, repo } = await liveFixture(t, { behavior: byTicket({ 'Add A': writes({ 'value.txt': 'changed', 'a.txt': 'A' }), 'Add B': writes({ 'value.txt': 'changed', 'b.txt': 'B' }) }), project: { validation: [unitCheck, pairCheck] } });
  const tasks = await readyTasks(live, engine, project, ['Add A', 'Add B']), before = await git(repo, ['rev-parse', 'main']);
  const landing = await land(live, engine, tasks);
  assert.equal(landing.status, 'failed'); assert.match(landing.events.at(-1).message, /Check pair failed on the combined result, so main did not move/);
  assert.equal(await git(repo, ['rev-parse', 'main']), before);
  for (const task of tasks) { assert.equal(task.status, 'ready'); assert.ok(existsSync(task.workspace)); }
});

test('a single task whose combined result fails a check goes back to its own session, then lands', async t => {
  const prompts = [];
  const repairs = options => { prompts.push(options.prompt); rmSync(join(options.workspace, 'b.txt')); writeFileSync(join(options.workspace, 'c.txt'), 'C'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Done' }; };
  const { live, engine, project, repo } = await liveFixture(t, { behavior: byTicket({ 'check pair failed': repairs, 'Add B': writes({ 'value.txt': 'changed', 'b.txt': 'B' }) }), project: { validation: [unitCheck, pairCheck] } });
  const [task] = await readyTasks(live, engine, project, ['Add B']);
  writeFileSync(join(repo, 'a.txt'), 'A'); await git(repo, ['add', 'a.txt']); await git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'Add A on main']);
  const landing = await land(live, engine, [task]);
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.map(event => event.message)));
  const repair = engine.get(landing.landing.items[0].repairRunId);
  assert.equal(repair.previousRunId, task.id); assert.equal(repair.sessionId, task.sessionId); assert.ok(repair.mergeIn);
  assert.match(prompts[0], /check pair failed on the combined result/); assert.match(prompts[0], /merged main/);
  assert.deepEqual(landing.checks.map(check => [check.name, check.status, check.attempt]), [['unit', 'passed', 1], ['pair', 'failed', 1], ['unit', 'passed', 2], ['pair', 'passed', 2]]);
  assert.equal(readFileSync(join(repo, 'c.txt'), 'utf8'), 'C'); assert.equal(existsSync(join(repo, 'b.txt')), false);
  assert.equal(taskState({ latest: repair }), 'completed');
});

test('uncommitted changes in the target checkout block the landing before anything is applied', async t => {
  const { live, engine, project, repo } = await liveFixture(t, { behavior: writes({ 'value.txt': 'changed' }) });
  const [task] = await readyTasks(live, engine, project, ['Change the value']);
  writeFileSync(join(repo, 'value.txt'), 'my work');
  const landing = await land(live, engine, [task]);
  assert.equal(landing.status, 'blocked'); assert.match(landing.events.at(-1).message, /uncommitted changes/);
  assert.equal(readFileSync(join(repo, 'value.txt'), 'utf8'), 'my work'); assert.ok(existsSync(task.workspace));
});

test('uncommitted changes to files the landing does not touch stay in the target checkout and do not block it', async t => {
  const { live, engine, project, repo } = await liveFixture(t, { behavior: writes({ 'value.txt': 'changed', 'a.txt': 'A' }) });
  writeFileSync(join(repo, 'staged.txt'), 'base'); writeFileSync(join(repo, 'edited.txt'), 'base');
  await git(repo, ['add', 'staged.txt', 'edited.txt']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'More files']);
  const [task] = await readyTasks(live, engine, project, ['Add A']);
  writeFileSync(join(repo, 'staged.txt'), 'my staged work'); await git(repo, ['add', 'staged.txt']);
  writeFileSync(join(repo, 'edited.txt'), 'my work');
  const landing = await land(live, engine, [task]);
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.at(-1)));
  assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'A'); assert.equal(await log(repo, '-1'), 'Add A');
  assert.equal(readFileSync(join(repo, 'staged.txt'), 'utf8'), 'my staged work'); assert.equal(readFileSync(join(repo, 'edited.txt'), 'utf8'), 'my work');
  assert.deepEqual((await git(repo, ['status', '--porcelain'])).split('\n'), [' M edited.txt', 'M  staged.txt']);
});

test('cancelling a landing stops the conflict resolution and leaves the target where it was', async t => {
  const waits = async options => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return { outcome: 'cancelled' }; };
  const { live, engine, project, repo } = await liveFixture(t, { behavior: byTicket({ 'dispatch is landing': waits, 'Add A': writes({ 'value.txt': 'changed', 'note.txt': 'A\n' }), 'Add B': writes({ 'value.txt': 'changed', 'note.txt': 'B\n' }) }) });
  const tasks = await readyTasks(live, engine, project, ['Add A', 'Add B']), before = await git(repo, ['rev-parse', 'main']);
  const landing = await live.landings.create({ runIds: tasks.map(task => task.id) });
  while (!landing.landing.items[1].resolutionRunId || engine.get(landing.landing.items[1].resolutionRunId).status !== 'implementing') await new Promise(resolve => setTimeout(resolve, 10));
  engine.cancel(landing.id); await settle(engine, landing);
  const resolution = engine.get(landing.landing.items[1].resolutionRunId); await settle(engine, resolution);
  assert.equal(landing.status, 'cancelled'); assert.equal(resolution.status, 'cancelled');
  assert.equal(await git(repo, ['rev-parse', 'main']), before);
});

test('a landing starts at once instead of waiting behind the tasks-at-a-time limit, and does not take a task slot', async t => {
  const gate = gated();
  const { live, engine, project, repo } = await liveFixture(t, { concurrency: 1, behavior: byTicket({ 'Busy': gate.behavior, 'Add A': writes({ 'value.txt': 'changed', 'a.txt': 'A' }) }) });
  const [task] = await readyTasks(live, engine, project, ['Add A']);
  const busy = await live.create({ projectId: project.id, input: 'Busy' });
  await until(() => busy.status === 'implementing');
  const landing = await land(live, engine, [task]);
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.at(-1)));
  assert.equal(readFileSync(join(repo, 'a.txt'), 'utf8'), 'A');
  const waiting = await live.create({ projectId: project.id, input: 'Busy later' });
  assert.equal(busy.status, 'implementing'); assert.equal(waiting.status, 'queued');
  gate.release(); await settle(engine, busy); await settle(engine, waiting);
});

test('a task is held by its landing until the landing settles, so it cannot be landed twice', async t => {
  const { live, engine, project } = await liveFixture(t, { behavior: writes({ 'value.txt': 'changed' }) });
  const [task] = await readyTasks(live, engine, project, ['Change the value']);
  const landing = await live.landings.create({ runIds: [task.id] });
  assert.equal(live.landings.landingOf(task), landing);
  await assert.rejects(live.landings.create({ runIds: [task.id] }), /already being landed/);
  await assert.rejects(live.removeWorktree(task.id), /being landed/);
  await assert.rejects(live.followup(task.id, { input: 'One more thing' }), /being landed/);
  await settle(engine, landing);
  assert.equal(live.landings.landingOf(task), null);
});

test('a second landing on the same branch waits for the first, while one on another branch runs at once', async t => {
  let release; const resolving = new Promise(resolve => { release = resolve; });
  const behavior = byTicket({ 'dispatch is landing': async options => { await resolving; return resolvesNote(options); }, 'Add A': writes({ 'value.txt': 'changed', 'note.txt': 'A\n' }), 'Add B': writes({ 'value.txt': 'changed', 'note.txt': 'B\n' }), 'Add C': writes({ 'value.txt': 'changed', 'c.txt': 'C' }), 'Add D': writes({ 'value.txt': 'changed', 'd.txt': 'D' }) });
  const { live, engine, project, repo } = await liveFixture(t, { behavior });
  const [a, b, c, d] = await readyTasks(live, engine, project, ['Add A', 'Add B', 'Add C', 'Add D']);
  await git(repo, ['branch', 'other', 'main']);
  const first = await live.landings.create({ runIds: [a.id, b.id] });
  await until(() => first.landing.items[1].resolutionRunId);
  const second = await live.landings.create({ runIds: [c.id] }), elsewhere = await land(live, engine, [d], { target: 'other' });
  assert.equal(elsewhere.status, 'ready', JSON.stringify(elsewhere.events.at(-1)));
  assert.equal(second.status, 'queued');
  assert.throws(() => engine.startNow(second.id), /same branch/);
  release(); await settle(engine, first); await settle(engine, second);
  assert.deepEqual([first.status, second.status], ['ready', 'ready'], JSON.stringify(second.events.at(-1)));
  assert.deepEqual((await log(repo, 'main', '-4')).split('\n'), ['Add C', 'Add B', 'Add A', 'Initial']);
  assert.deepEqual((await log(repo, 'other', '-2')).split('\n'), ['Add D', 'Initial']);
});

test('landing requests are validated: one repository, ready tasks only, known strategy and branch', async t => {
  const { live, engine, project } = await liveFixture(t, { behavior: writes({ 'value.txt': 'changed' }) });
  const [task] = await readyTasks(live, engine, project, ['Change the value']);
  await assert.rejects(live.landings.create({ runIds: [] }), /Choose 1 to 20/);
  await assert.rejects(live.landings.create({ runIds: [task.id], strategy: 'octopus' }), /squash, rebase, merge/);
  await assert.rejects(live.landings.create({ runIds: [task.id], target: 'nope' }), /does not exist/);
  await assert.rejects(live.landings.create({ runIds: [task.id], target: '--force' }), /valid target branch/);
  assert.deepEqual(await live.landings.branches(project.id), { base: 'main', branches: ['main'] });
  await live.removeWorktree(task.id);
  await assert.rejects(live.landings.create({ runIds: [task.id] }), /no tested commit/);
});

test('a plain folder member is edited in place and skipped by the landing, which moves only the Git repository', async t => {
  const { dir: folderDir, repo: folder } = await temporaryFolder(); t.after(() => rmSync(folderDir, { recursive: true, force: true }));
  const both = options => { writeFileSync(join(options.workspace, 'value.txt'), 'changed'); writeFileSync(join(folder, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Done' }; };
  const adapter = { ...workerDouble(both), contract: { writableRoots: true } };
  const { live, engine, project, repo } = await liveFixture(t, { adapter });
  const notes = await live.saveProject({ repositoryPath: folder, name: 'notes', baseBranch: null, confirmed: true, validation: [unitCheck] });
  const task = await live.create({ projectIds: [project.id, notes.id], input: 'Change both' }); await settle(engine, task);
  assert.equal(task.status, 'ready', JSON.stringify(task.events.at(-1)));
  const landing = await land(live, engine, [task]);
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.at(-1)));
  assert.deepEqual((await log(repo, '-2')).split('\n'), ['Change both', 'Initial']); assert.equal(landing.linked.length, 0);
  assert.equal(task.landed.linked, undefined); assert.equal(readFileSync(join(folder, 'value.txt'), 'utf8'), 'changed'); assert.deepEqual(readdirSync(folder), ['value.txt']);
  assert.equal(taskState({ latest: task }), 'completed');
});

test('a task whose primary is a plain folder lands only its Git member, and the folder is left as the agent left it', async t => {
  const { dir: repoDir, repo: api } = await temporaryRepository(); t.after(() => rmSync(repoDir, { recursive: true, force: true }));
  const both = options => { writeFileSync(join(options.workspace, 'value.txt'), 'changed'); writeFileSync(join(options.prompt.match(/^- api: (\S+)/m)[1], 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Done\nDISPATCH_COMMIT: feat(api): change both' }; };
  const adapter = { ...workerDouble(both), contract: { writableRoots: true } };
  const { live, engine, project, repo: folder } = await liveFixture(t, { adapter, folder: true });
  const member = await live.saveProject({ repositoryPath: api, name: 'api', baseBranch: 'main', confirmed: true, validation: [unitCheck] });
  const task = await live.create({ projectIds: [project.id, member.id], input: 'Change both' }); await settle(engine, task);
  assert.equal(task.status, 'ready', JSON.stringify(task.events.at(-1))); assert.equal(task.headSha, null); assert.ok(task.linked[0].headSha);
  assert.equal(landable(task), true); assert.equal(publishable(task), true);
  const landing = await land(live, engine, [task]);
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.at(-1)));
  assert.equal(landing.landing.target, null); assert.equal(landing.headSha, null); assert.equal(landing.workspace.startsWith(live.workspaceRoot), true); assert.equal(existsSync(landing.workspace), false);
  assert.deepEqual((await log(api, '-2')).split('\n'), ['feat(api): change both', 'Initial']);
  assert.deepEqual(task.landed.linked.map(lane => [lane.name, lane.target]), [['api', 'main']]); assert.equal(task.landed.target, null);
  assert.match(landing.events.at(-1).message, /Landed 1 task on api on main at [0-9a-f]{12} by squash/);
  assert.equal(existsSync(task.linked[0].workspace), false); assert.equal(taskState({ latest: task }), 'completed'); assert.equal(task.worktreeRemovedAt, undefined);
  assert.equal(readFileSync(join(folder, 'value.txt'), 'utf8'), 'changed');
  await assert.rejects(live.landings.create({ runIds: [task.id] }), /no tested commit/);
});

test('a task that changed only its linked repository lands only that repository and leaves its own target untouched', async t => {
  const { dir: apiDir, repo: api } = await temporaryRepository(); t.after(() => rmSync(apiDir, { recursive: true, force: true }));
  const memberOnly = options => { writeFileSync(join(options.prompt.match(/^- api: (\S+)/m)[1], 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Done\nDISPATCH_COMMIT: feat(api): change the member' }; };
  const adapter = { ...workerDouble(memberOnly), contract: { writableRoots: true } };
  const { live, engine, project, repo } = await liveFixture(t, { adapter });
  const member = await live.saveProject({ repositoryPath: api, name: 'api', baseBranch: 'main', confirmed: true, validation: [unitCheck] });
  const task = await live.create({ projectIds: [project.id, member.id], input: 'Change the member' }); await settle(engine, task);
  assert.equal(task.status, 'ready', JSON.stringify(task.events.at(-1))); assert.equal(task.headSha, task.baseSha); assert.ok(task.linked[0].headSha);
  assert.equal(landable(task), true); assert.equal(publishable(task), true);
  const landing = await land(live, engine, [task]);
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.at(-1)));
  assert.equal(landing.landing.target, null);
  assert.deepEqual((await log(repo)).split('\n'), ['Initial']);
  assert.deepEqual((await log(api, '-2')).split('\n'), ['feat(api): change the member', 'Initial']);
  assert.match(landing.events.at(-1).message, /Landed 1 task on api on main at [0-9a-f]{12} by squash/);
});

test('a ready task without a commit in any repository is neither landable nor publishable', () => {
  const run = { mode: 'live', kind: 'change', status: 'ready', headSha: 'abc', baseSha: 'abc', linked: [{ headSha: 'def', baseSha: 'def' }] };
  assert.equal(landable(run), false); assert.equal(publishable(run), false);
});
