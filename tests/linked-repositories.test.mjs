import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { git } from '../src/local-tools.mjs';
import { landable } from '../src/landing.mjs';
import { publishable } from '../src/pull-requests.mjs';
import { forgeDouble, publishWrites } from './forge-double.mjs';
import { gated, liveFixture, settle, temporaryRepository, unitCheck, until, workerDouble } from './live-double.mjs';

const memberPath = prompt => prompt.match(/^- api: (\S+)/m)?.[1];
const memberPaths = prompt => new Map([...(prompt.split('LINKED REPOSITORIES')[1] ?? '').split('\n\n')[0].matchAll(/^- (.+?): (\S+)/gm)].map(([, name, path]) => [name, path]));
const completed = { outcome: 'completed', sessionId: 'session-1', summary: 'Updated' };

async function linkedFixture(t, behavior, { writableRoots = true, services = {}, project = {}, extra = [], setup = [] } = {}) {
  const adapter = { ...workerDouble(behavior), contract: { writableRoots } };
  const fixture = await liveFixture(t, { adapter, services });
  const repos = {}, saved = {};
  for (const name of ['api', ...extra]) {
    const repo = await temporaryRepository(`dispatch-linked-${name}-`);
    t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
    saved[name] = await fixture.live.saveProject({ repositoryPath: repo.repo, name, baseBranch: 'main', confirmed: true, validation: [unitCheck], setup });
    repos[name] = repo.repo;
  }
  await fixture.live.saveProject({ repositoryPath: fixture.repo, baseBranch: 'main', confirmed: true, validation: [unitCheck], linked: [saved.api.id], ...project }, fixture.project.id);
  return { ...fixture, api: repos.api, linked: saved.api, repos, saved };
}

test('linked repositories must be other saved repositories', async t => {
  const { live, repo, project } = await liveFixture(t);
  await assert.rejects(live.saveProject({ repositoryPath: repo, baseBranch: 'main', confirmed: true, validation: [unitCheck], linked: [project.id] }, project.id), /other saved repositories/);
  await assert.rejects(live.saveProject({ repositoryPath: repo, baseBranch: 'main', confirmed: true, validation: [unitCheck], linked: ['missing'] }, project.id), /other saved repositories/);
});

test('one agent changes a linked repository that gets its own worktree, checks, commit and diff', async t => {
  const both = options => { writeFileSync(join(options.workspace, 'value.txt'), 'changed'); writeFileSync(join(memberPath(options.prompt), 'value.txt'), 'changed'); return completed; };
  const { live, engine, project, repo, api, adapter } = await linkedFixture(t, both);
  const run = await live.create({ projectId: project.id, input: 'Change both repositories' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  const [member] = run.linked;
  assert.ok(adapter.calls[0].writableRoots.includes(member.workspace));
  assert.deepEqual(run.checks.map(check => [check.name, check.status, check.linked ?? null]), [['unit', 'passed', null], ['api: unit', 'passed', member.projectId]]);
  assert.equal(await git(member.workspace, ['rev-parse', 'HEAD']), member.headSha); assert.notEqual(member.headSha, member.baseSha);
  assert.equal(await git(member.workspace, ['rev-parse', 'HEAD^{tree}']), member.revision);
  assert.equal(readFileSync(join(api, 'value.txt'), 'utf8'), 'original'); assert.equal(readFileSync(join(repo, 'value.txt'), 'utf8'), 'original');
  assert.match((await live.diff(run.id)).diff, /\+\+\+ b\/api\/value\.txt/);
  assert.equal(run.handoff.linked[0].headSha, member.headSha);
  assert.equal(landable(run), true);
  await live.removeWorktree(run.id);
  assert.equal(existsSync(member.workspace), false);
  assert.match(run.events.at(-1).message, /Linked branches kept because they hold unpushed commits: api /);
});

test('a failing linked check is repaired in the same session and names the repository', async t => {
  let member;
  const behavior = (options, turn) => {
    member ??= memberPath(options.prompt);
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    writeFileSync(join(member, 'value.txt'), turn === 1 ? 'wrong' : 'changed');
    return completed;
  };
  const { live, engine, project, adapter } = await linkedFixture(t, behavior);
  const run = await live.create({ projectId: project.id, input: 'Change both repositories' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  assert.match(adapter.calls[1].prompt, /failing mandatory check in linked repository api/);
  assert.equal(adapter.calls[1].sessionId, 'session-1');
  assert.deepEqual(run.checks.filter(check => check.linked).map(check => check.status), ['failed', 'passed']);
});

test('opening pull requests opens one per changed repository and links them', async t => {
  const forge = forgeDouble();
  const both = options => { writeFileSync(join(options.workspace, 'value.txt'), 'changed'); writeFileSync(join(memberPath(options.prompt), 'value.txt'), 'changed'); return completed; };
  const fixture = await linkedFixture(t, both, { services: { connectors: [forge.connector] } }), { linked } = fixture;
  publishWrites(fixture.live);
  const run = await fixture.live.create({ projectId: fixture.project.id, input: 'Change both repositories' }); await settle(fixture.engine, run);
  await fixture.live.pullRequests.open({ runIds: [run.id], bases: { [linked.id]: 'develop' } });
  assert.equal(run.delivery.pr.url, 'https://forge.example/repo/pull/7'); assert.equal(run.linked[0].delivery.pr.url, 'https://forge.example/repo/pull/8');
  assert.deepEqual(forge.of('openPullRequest').map(call => call.base), ['main', 'develop']);
  assert.deepEqual(forge.of('describe').map(call => call.url), ['https://forge.example/repo/pull/7', 'https://forge.example/repo/pull/8']);
  assert.equal(publishable(run), false);
});

test('a change only in a linked repository skips the unchanged primary checks', async t => {
  const memberOnly = options => { writeFileSync(join(memberPath(options.prompt), 'value.txt'), 'changed'); return completed; };
  const { live, engine, project } = await linkedFixture(t, memberOnly);
  const run = await live.create({ projectId: project.id, input: 'Change the API only' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  assert.equal(run.headSha, run.baseSha);
  assert.deepEqual(run.checks.map(check => check.name), ['api: unit']);
  assert.notEqual(run.linked[0].headSha, run.linked[0].baseSha);
});

const both = options => { writeFileSync(join(options.workspace, 'value.txt'), 'changed'); writeFileSync(join(memberPath(options.prompt), 'value.txt'), 'changed'); return completed; };

test('a provider without extra writable roots is refused before any worktree is made', async t => {
  const { live, engine, project, turns } = await linkedFixture(t, () => completed, { writableRoots: false });
  const run = await live.create({ projectId: project.id, input: 'Change both repositories' }); await settle(engine, run);
  assert.equal(run.status, 'blocked'); assert.match(run.events.at(-1).message, /linked repositories' worktrees/);
  assert.equal(turns(), 0); assert.equal(run.linked[0].baseSha, null);
});

test('the reviewer reads the linked changes and the stale check covers them', async t => {
  const behavior = options => {
    if (options.readOnly) {
      assert.equal(options.readableRoots.length, 1); assert.match(options.prompt, /linked repositories[\s\S]*- api: \S+ against base [0-9a-f]{40}\n {2}- value\.txt/);
      return { outcome: 'completed', summary: '{"approved":true,"findings":[]}' };
    }
    return both(options);
  };
  const { live, engine, project } = await linkedFixture(t, behavior, { project: { review: true } });
  const run = await live.create({ projectId: project.id, input: 'Change both repositories' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  assert.equal(run.reviews.at(-1).status, 'passed');
});

test('app: URLs name linked apps and URL variables are validated', async t => {
  const { live, linked, project, repo } = await linkedFixture(t, () => completed);
  const run = { linked: [{ name: 'api', projectId: linked.id }] };
  assert.deepEqual(live.linked.appTarget(run, 'app:/login'), { member: null, path: '/login' });
  assert.deepEqual(live.linked.appTarget(run, 'app:'), { member: null, path: '/' });
  assert.equal(live.linked.appTarget(run, 'app:api/users').path, '/users'); assert.equal(live.linked.appTarget(run, 'app:API').member, run.linked[0]);
  assert.throws(() => live.linked.appTarget(run, 'app:web/'), /app:api\//);
  const input = linkedEnv => ({ repositoryPath: repo, baseBranch: 'main', confirmed: true, validation: [unitCheck], linked: [linked.id], linkedEnv });
  await assert.rejects(live.saveProject(input({ [linked.id]: 'PATH' }), project.id), /URL variable/);
  const saved = await live.saveProject(input({ [linked.id]: 'VITE_API_URL', other: 'X' }), project.id);
  assert.deepEqual(saved.linkedEnv, { [linked.id]: 'VITE_API_URL' });
  assert.equal(live.linked.snapshot(saved, 'r1')[0].urlEnv, 'VITE_API_URL');
});

test('the app starts after the linked apps it reads, and not at all when one fails', async t => {
  const { live } = await linkedFixture(t, () => completed);
  const run = { linked: [{ name: 'api', projectId: 'a', urlEnv: 'VITE_API_URL' }, { name: 'docs', projectId: 'b', urlEnv: null }] }, started = [];
  live.devServerFor = async (_run, _signal, member) => { started.push(member.name); return { url: 'http://127.0.0.1:5001/' }; };
  assert.deepEqual(await live.linked.appEnv(run), { VITE_API_URL: 'http://127.0.0.1:5001' }); assert.deepEqual(started, ['api']);
  live.devServerFor = async () => { throw new Error('Linked app api did not start: no dev script'); };
  await assert.rejects(live.linked.appEnv(run), /no dev script\nThis app reads VITE_API_URL for api, so it was not started without it\. .*tell the operator why/);
});

test('landing moves every repository only after all combined checks pass', async t => {
  const { live, engine, project, repo, api } = await linkedFixture(t, both);
  const task = await live.create({ projectId: project.id, input: 'Change both repositories' }); await settle(engine, task);
  const member = task.linked[0], landing = await live.landings.create({ runIds: [task.id] }); await settle(engine, landing);
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.map(event => event.message)));
  assert.match(landing.events.at(-1).message, /and api on main at [0-9a-f]{12}/);
  assert.deepEqual(landing.checks.map(check => [check.name, check.status]), [['unit', 'passed'], ['api: unit', 'passed']]);
  assert.equal(await git(repo, ['show', 'main:value.txt']), 'changed'); assert.equal(await git(api, ['show', 'main:value.txt']), 'changed');
  assert.equal(task.landed.linked[0].name, 'api');
  assert.equal(existsSync(member.workspace), false); await assert.rejects(git(api, ['rev-parse', '--verify', `refs/heads/${member.branch}`]));
});

test('a failing linked check on the combined result moves no branch', async t => {
  const { live, engine, project, repo, api, linked } = await linkedFixture(t, both);
  const task = await live.create({ projectId: project.id, input: 'Change both repositories' }); await settle(engine, task);
  await live.saveProject({ repositoryPath: api, name: 'api', baseBranch: 'main', confirmed: true, validation: [{ id: 'fails', command: process.execPath, args: ['-e', 'process.exit(1)'] }] }, linked.id);
  const apiMain = await git(api, ['rev-parse', 'main']), repoMain = await git(repo, ['rev-parse', 'main']);
  const landing = await live.landings.create({ runIds: [task.id] }); await settle(engine, landing);
  assert.equal(landing.status, 'failed'); assert.match(landing.events.at(-1).message, /Check api: fails failed on the combined result, so no branch moved\./);
  assert.equal(await git(api, ['rev-parse', 'main']), apiMain); assert.equal(await git(repo, ['rev-parse', 'main']), repoMain);
});

test('a linked landing conflict goes back to the task session and merges in the linked worktree', async t => {
  const behavior = options => {
    const conflict = options.prompt.match(/In the linked repository api \(worktree (\S+)\)/);
    if (conflict) { writeFileSync(join(conflict[1], 'shared.txt'), 'one\ntwo'); return completed; }
    const name = /Task two/.test(options.prompt) ? 'two' : 'one', member = memberPath(options.prompt);
    writeFileSync(join(options.workspace, 'value.txt'), 'changed'); writeFileSync(join(options.workspace, `${name}.txt`), name);
    writeFileSync(join(member, 'value.txt'), 'changed'); writeFileSync(join(member, 'shared.txt'), name);
    return completed;
  };
  const { live, engine, project, api } = await linkedFixture(t, behavior);
  const one = await live.create({ projectId: project.id, input: 'Task one' }); await settle(engine, one);
  const two = await live.create({ projectId: project.id, input: 'Task two' }); await settle(engine, two);
  const landing = await live.landings.create({ runIds: [one.id, two.id] }); await settle(engine, landing);
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.map(event => event.message)));
  assert.equal(engine.get(landing.landing.items[1].resolutionRunId).mergeInto, two.linked[0].projectId);
  assert.equal(await git(api, ['show', 'main:shared.txt']), 'one\ntwo');
});

test('an explicit repository list gives the task exactly those worktrees, named after the repositories', async t => {
  const behavior = options => {
    const paths = memberPaths(options.prompt); assert.deepEqual([...paths.keys()], ['service']);
    writeFileSync(join(options.workspace, 'value.txt'), 'changed'); writeFileSync(join(paths.get('service'), 'value.txt'), 'changed'); return completed;
  };
  const { live, engine, project, saved } = await linkedFixture(t, behavior, { extra: ['service'] });
  const run = await live.create({ projectIds: [project.id, saved.service.id], input: 'Change the service too' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  assert.deepEqual(run.linked.map(member => [member.projectId, member.setup]), [[saved.service.id, 'before']]);
  assert.match(run.linked[0].workspace, /-service$/);
  assert.deepEqual(run.repositorySelection, { mode: 'manual', reason: 'Using repo, as you answered.', projectIds: [project.id, saved.service.id] });
  assert.deepEqual(run.checks.map(check => check.name), ['unit', 'service: unit']);
  assert.deepEqual(live.memory.readTasks(saved.service.id).map(task => [task.checks, task.filesChanged]), [[[{ name: 'service: unit', status: 'passed' }], 1]]);
  assert.deepEqual(live.memory.readTasks(project.id).map(task => task.checks), [[{ name: 'unit', status: 'passed' }]]);
  await assert.rejects(live.create({ projectIds: [project.id, 'missing'], input: 'x' }), /saved repositories/);
});

test('when the agent decides, every saved repository is in reach and only a changed one is set up and committed', async t => {
  const { release, behavior: held } = gated();
  const log = join(tmpdir(), `dispatch-setup-${process.pid}-${Date.now()}.log`), setup = [{ id: 'install', command: process.execPath, args: ['-e', 'require("fs").appendFileSync(process.argv[1], process.cwd() + "\\n")', log] }];
  t.after(() => rmSync(log, { force: true }));
  const behavior = (options, turn) => {
    if (turn === 1) { assert.equal(existsSync(log), false); assert.match(options.prompt, /may belong to any of these repositories/); assert.match(options.prompt, /installed after your turn/); }
    writeFileSync(join(memberPaths(options.prompt).get('service'), 'value.txt'), 'changed'); return completed;
  };
  const { live, engine, project, saved } = await linkedFixture(t, behavior, { extra: ['service'], setup });
  const run = await live.create({ projectIds: 'all', input: 'Fix the thing' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  assert.equal(run.projectId, project.id); assert.equal(run.repositorySelection.mode, 'agent'); assert.match(run.repositorySelection.reason, /first saved repository/);
  assert.deepEqual(run.linked.map(member => [member.name, member.setup]), [['api', 'deferred'], ['service', 'deferred']]);
  const service = run.linked[1];
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [service.workspace]);
  assert.equal(run.headSha, run.baseSha); assert.equal(run.linked[0].headSha, undefined); assert.notEqual(service.headSha, service.baseSha);
  assert.deepEqual(run.checks.map(check => check.name), ['service: unit']);
  const next = await live.followup(run.id, { input: 'Again' }); await settle(engine, next);
  assert.equal(next.status, 'ready'); assert.equal(next.linked[1].setupComplete, true); assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
  void held; release();
});

test('the agent starts in the repository the ticket mentions first', async t => {
  const { live, engine, saved } = await linkedFixture(t, options => { writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return completed; }, { extra: ['service'] });
  const run = await live.create({ projectIds: 'all', input: 'service: pass api changes through' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  assert.equal(run.projectId, saved.service.id); assert.match(run.repositorySelection.reason, /service, mentioned first/);
  assert.deepEqual(run.checks.map(check => check.name), ['unit']);
});

test('an active ticket blocks the same ticket in any repository it works in', async t => {
  const { release, behavior } = gated();
  const { live, engine, project, saved } = await linkedFixture(t, behavior, { extra: ['service'] });
  const run = await live.create({ projectIds: [project.id, saved.api.id], input: 'Shared ticket' });
  await until(() => run.status === 'implementing');
  await assert.rejects(live.create({ projectIds: [saved.api.id], input: 'Shared ticket' }), /already has an active run/);
  const other = await live.create({ projectIds: [saved.service.id], input: 'Shared ticket' });
  release(); await settle(engine, run); await settle(engine, other);
  assert.equal(run.status, 'ready'); assert.equal(other.status, 'ready');
});

test('a landing lands each repository on the target chosen for it', async t => {
  const { live, engine, project, repos, saved } = await linkedFixture(t, both);
  await git(repos.api, ['branch', 'staging', 'main']);
  const task = await live.create({ projectId: project.id, input: 'Change both repositories' }); await settle(engine, task);
  await assert.rejects(live.landings.create({ runIds: [task.id], targets: { [saved.api.id]: 'bad branch' } }), /valid target branch/);
  const apiMain = await git(repos.api, ['rev-parse', 'main']);
  const landing = await live.landings.create({ runIds: [task.id], targets: { [saved.api.id]: 'staging' } }); await settle(engine, landing);
  assert.equal(landing.status, 'ready', JSON.stringify(landing.events.map(event => event.message)));
  assert.equal(await git(repos.api, ['show', 'staging:value.txt']), 'changed'); assert.equal(await git(repos.api, ['rev-parse', 'main']), apiMain);
  assert.deepEqual(task.landed.linked.map(lane => [lane.name, lane.target]), [['api', 'staging']]);
});
