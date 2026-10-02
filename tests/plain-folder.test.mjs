import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../src/local-tools.mjs';
import { landable } from '../src/landing.mjs';
import { publishable } from '../src/pull-requests.mjs';
import { completesWithFiles, gated, liveFixture, settle, temporaryFolder, temporaryRepository, unitCheck, until, workerDouble } from './live-double.mjs';
import { forgeDouble } from './forge-double.mjs';

const treeId = /^[0-9a-f]{40}$/;
const fixture = (t, behavior = completesWithFiles, options = {}) => liveFixture(t, { behavior, folder: true, services: { connectors: [forgeDouble().connector] }, ...options });
const memberPath = (prompt, name) => prompt.match(new RegExp(`^- ${name}: (\\S+)`, 'm'))?.[1];

test('inspect recognises a plain folder, keeps refusing subfolders of a repository, and saveProject drops the Git-only settings', async t => {
  const { live, repo, project, dir } = await fixture(t);
  const info = await live.inspect(repo);
  assert.equal(info.git, false); assert.equal(info.baseBranch, null); assert.deepEqual(info.branches, []); assert.equal(info.repositoryPath, repo); assert.equal(info.suggestBrowser, false);
  assert.equal(project.git, false); assert.equal(project.baseBranch, null); assert.equal(project.trackRemote, false); assert.equal(project.dispatchCoAuthor, false); assert.equal(project.connectors.forge?.enabled ?? false, false);
  for (const input of [{ trackRemote: true }, { baseBranch: 'main' }, { connectors: { forge: { enabled: true } } }]) await assert.rejects(live.saveProject({ ...project, confirmed: true, ...input }, project.id), /plain folder has no Git/);
  assert.throws(() => live.setConnector(project.id, { forge: { enabled: true } }), /plain folder has no Git/); assert.equal(live.projects[0].connectors.forge?.enabled ?? false, false);
  assert.deepEqual(await live.landings.branches(project.id), { base: null, branches: [] });
  const { dir: repoDir, repo: gitRepo } = await temporaryRepository(); t.after(() => rmSync(repoDir, { recursive: true, force: true }));
  mkdirSync(join(gitRepo, 'sub')); await assert.rejects(live.inspect(join(gitRepo, 'sub')), /repository root directory/);
  await assert.rejects(live.inspect(join(dir, 'missing')), /does not exist/);
});

test('a plain folder run works in place: tree ids bind the checks, nothing is committed and the folder gets no Git files', async t => {
  const prompts = [];
  const { live, engine, project, repo, dir } = await fixture(t, options => { prompts.push(options.prompt); return completesWithFiles(options); });
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  assert.equal(run.workspace, repo); assert.equal(run.branch, null); assert.equal(run.shadow, join(dir, 'data', 'shadow', project.id));
  assert.match(run.baseSha, treeId); assert.match(run.revision, treeId); assert.notEqual(run.baseSha, run.revision); assert.equal(run.baseSource, 'folder');
  assert.deepEqual(run.changedPaths, ['new.txt', 'value.txt']); assert.deepEqual(run.checks.map(check => [check.name, check.status, check.revision]), [['unit', 'passed', run.revision]]);
  assert.equal(run.headSha, null); assert.deepEqual([run.handoff.head, run.handoff.base, run.handoff.folder, run.handoff.revision], [null, null, repo, run.revision]);
  assert.match(run.events.at(-1).message, /Tested changes are in .*; nothing committed/); assert.equal(run.events.some(event => event.kind === 'publishing'), false);
  assert.match(prompts[0], /directly in the folder .*not a Git repository: do not run git init/); assert.doesNotMatch(prompts[0], /isolated worktree/);
  assert.deepEqual(readdirSync(repo).sort(), ['new.txt', 'value.txt']); assert.equal(readFileSync(join(repo, 'value.txt'), 'utf8'), 'changed');
  assert.ok(existsSync(join(run.shadow, 'HEAD'))); assert.match(readFileSync(join(run.shadow, 'info', 'exclude'), 'utf8'), /node_modules/);
  const diff = await live.diff(run.id); assert.match(diff.diff, /new\.txt/); assert.equal(diff.stale, false); assert.equal(diff.revision, run.revision);
  assert.deepEqual(run.artifacts.filter(item => item.check === 'patch').map(item => item.name), ['turn-1.patch']);
  assert.equal(run.worktreeRemovedAt, undefined); live.reconcileWorktrees(); assert.equal(run.worktreeRemovedAt, undefined);
  await assert.rejects(live.removeWorktree(run.id), /no dispatch worktree/);
  assert.equal(landable(run), false); assert.equal(publishable(run), false);
  const next = await live.followup(run.id, { input: 'Check it again' }); await settle(engine, next);
  assert.equal(next.status, 'ready', JSON.stringify(next.events.map(event => event.message))); assert.equal(next.shadow, run.shadow); assert.equal(next.baseSha, run.baseSha);
  assert.deepEqual(next.checks.map(check => [check.status, check.reusedFrom?.runId]), [['passed', run.id]]);
  assert.equal(await git(repo, ['rev-parse', '--show-toplevel']).catch(error => error.message), await git(dir, ['rev-parse', '--show-toplevel']).catch(error => error.message));
});

test('a turn that changes nothing in the folder ends blocked, and the stopped run keeps showing its own patch once the folder moves on', async t => {
  const { live, engine, project, repo } = await fixture(t, async (options, turn) => { if (turn === 2) writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Done' }; });
  const run = await live.create({ projectId: project.id, input: 'Build something' }); await settle(engine, run);
  assert.equal(run.status, 'blocked'); assert.match(run.events.at(-1).message, /No changes in the folder/); assert.deepEqual(run.checks, []);
  const next = await live.followup(run.id, { input: 'Put it in this folder' }); await settle(engine, next);
  assert.equal(next.status, 'ready', JSON.stringify(next.events.map(event => event.message)));
  writeFileSync(join(repo, 'value.txt'), 'edited by hand later');
  const diff = await live.diff(next.id); assert.equal(diff.stale, true); assert.equal(diff.source, 'patch'); assert.match(diff.diff, /\+changed/); assert.doesNotMatch(diff.diff, /edited by hand/);
});

test('one conversation at a time per plain folder: a second task is refused while the first works, and accepted once it stops', async t => {
  const { release, behavior } = gated();
  const { live, engine, project, repo } = await fixture(t, behavior);
  const first = await live.create({ projectId: project.id, input: 'First task' });
  await until(() => first.status === 'implementing');
  await assert.rejects(live.create({ projectId: project.id, input: 'Second task' }), /"First task" is still working in .*Wait for it to finish/);
  release(); await settle(engine, first); assert.equal(first.status, 'ready');
  writeFileSync(join(repo, 'value.txt'), 'original');
  const second = await live.create({ projectId: project.id, input: 'Second task' }); await settle(engine, second);
  assert.equal(second.status, 'ready', JSON.stringify(second.events.map(event => event.message)));
});

test('a folder that became a Git repository or disappeared blocks the run before any turn', async t => {
  const { live, engine, project, repo } = await fixture(t);
  await git(repo, ['init', '-b', 'main']);
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'blocked'); assert.match(run.events.at(-1).message, /is now a Git repository. Remove it from Repositories/); assert.equal(live.adapter.calls.length, 0);
  rmSync(repo, { recursive: true, force: true });
  const gone = await live.create({ projectId: project.id, input: 'Change the value again' }); await settle(engine, gone);
  assert.equal(gone.status, 'blocked'); assert.match(gone.events.at(-1).message, /no longer exists/);
});

test('files the app writes during a browser smoke check are removed from the folder, and nothing else is', async t => {
  const smoke = async ({ workspace }) => { writeFileSync(join(workspace, 'data.db'), 'sqlite'); return { exitCode: 0, output: 'GET / → 200', timedOut: false, cancelled: false, durationMs: 5, artifacts: [] }; };
  const { live, engine, project, repo } = await fixture(t, completesWithFiles, { services: { browserSmoke: smoke }, project: { validation: [{ id: 'browser-smoke', kind: 'browser-smoke' }] } });
  writeFileSync(join(repo, 'keep.txt'), 'mine');
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  assert.deepEqual(readdirSync(repo).sort(), ['keep.txt', 'new.txt', 'value.txt']); assert.ok(run.events.some(event => /removed 1 file\(s\) the app wrote while it ran: data.db/.test(event.message)));
});

test('a plain folder can be a member of a Git task: edited in place, checked against its tree, never committed or landed', async t => {
  const { dir: folderDir, repo: folder } = await temporaryFolder(); t.after(() => rmSync(folderDir, { recursive: true, force: true }));
  const both = options => { writeFileSync(join(options.workspace, 'value.txt'), 'changed'); writeFileSync(join(memberPath(options.prompt, 'notes'), 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Updated\nDISPATCH_COMMIT: feat(core): change both' }; };
  const prompts = [];
  const adapter = { ...workerDouble(options => { prompts.push(options.prompt); return both(options); }), contract: { writableRoots: true } };
  const { live, engine, project, repo, dir: dataRoot } = await liveFixture(t, { adapter });
  const notes = await live.saveProject({ repositoryPath: folder, name: 'notes', baseBranch: null, confirmed: true, validation: [unitCheck] });
  const run = await live.create({ projectIds: [project.id, notes.id], input: 'Change both' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  const member = run.linked[0];
  assert.equal(member.workspace, folder); assert.equal(member.shadow, join(dataRoot, 'data', 'shadow', notes.id)); assert.equal(member.branch, null); assert.equal(member.baseBranch, null); assert.match(member.baseSha, treeId);
  assert.deepEqual(member.changedPaths, ['value.txt']); assert.equal(member.headSha, undefined); assert.equal(member.baseSource, 'folder');
  assert.deepEqual(run.checks.map(check => [check.name, check.status, check.revision]), [['unit', 'passed', run.revision], ['notes: unit', 'passed', member.revision]]);
  assert.match(run.headSha, treeId); assert.equal(await git(repo, ['rev-parse', `refs/heads/${run.branch}`]), run.headSha);
  assert.deepEqual(run.handoff.linked, [{ name: 'notes', head: null, base: null, baseSha: member.baseSha, headSha: null, revision: member.revision, folder }]);
  assert.match(prompts[0], /- notes: .* \(plain folder, edited in place; no Git\)/); assert.match(prompts[0], /plain folders in place/);
  assert.deepEqual(readdirSync(folder).sort(), ['value.txt']); assert.match((await live.diff(run.id)).diff, /b\/notes\/value\.txt/);
  assert.equal(landable(run), true);
});

test('while a Git task edits a plain member, no other task may enter that folder', async t => {
  const { dir: folderDir, repo: folder } = await temporaryFolder(); t.after(() => rmSync(folderDir, { recursive: true, force: true }));
  const { release, behavior } = gated();
  const adapter = { ...workerDouble(behavior), contract: { writableRoots: true } };
  const { live, engine, project } = await liveFixture(t, { adapter });
  const notes = await live.saveProject({ repositoryPath: folder, name: 'notes', baseBranch: null, confirmed: true, validation: [] });
  const run = await live.create({ projectIds: [project.id, notes.id], input: 'Change both' });
  await until(() => run.status === 'implementing');
  await assert.rejects(live.create({ projectId: notes.id, input: 'Edit the notes alone' }), /"Change both" is still working in /);
  release(); await settle(engine, run);
});

test('dispatch creates an empty plain folder on request and registers it without git init', async t => {
  const { live, dir, repo } = await fixture(t); live.createRoot = dir;
  const project = await live.createRepository({ repositoryPath: join(dir, 'fresh-app'), confirmed: true, git: false });
  assert.equal(project.git, false); assert.equal(project.baseBranch, null); assert.equal(project.name, 'fresh-app'); assert.deepEqual(project.validation.map(step => step.kind), ['browser-smoke']);
  assert.deepEqual(readdirSync(project.repositoryPath), []);
  await assert.rejects(live.createRepository({ repositoryPath: join(dir, 'fresh-app'), confirmed: true, git: false }), /already registered/);
  const { dir: repoDir, repo: gitRepo } = await temporaryRepository(); t.after(() => rmSync(repoDir, { recursive: true, force: true })); live.createRoot = repoDir;
  await assert.rejects(live.createRepository({ repositoryPath: join(gitRepo, 'nested'), confirmed: true, git: false }), /inside an existing Git repository/);
  assert.equal(existsSync(join(repo, '.git')), false);
});

test('the first turn in an empty plain folder sets the protected script baseline', async t => {
  const { live, engine, dir } = await liveFixture(t, { folder: true, behavior: async options => { writeFileSync(join(options.workspace, 'package.json'), JSON.stringify({ scripts: { dev: 'node serve.mjs' } })); writeFileSync(join(options.workspace, 'index.html'), '<h1>Hi</h1>'); return { outcome: 'completed', sessionId: 'session-1' }; } });
  live.createRoot = dir;
  const created = await live.createRepository({ repositoryPath: join(dir, 'fresh'), confirmed: true, git: false });
  const project = await live.saveProject({ ...created, confirmed: true, validation: [{ id: 'ok', command: process.execPath, args: ['-e', ''] }], risk: { mode: 'off' } }, created.id);
  const run = await live.create({ projectId: project.id, input: 'Scaffold the app' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message))); assert.equal(run.scriptsAtBase, true);
  assert.ok(run.events.some(event => /scripts are now the protected baseline/.test(event.message)));
  assert.deepEqual(readdirSync(project.repositoryPath).sort(), ['index.html', 'package.json']);
});
