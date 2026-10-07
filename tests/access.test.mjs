import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxAccess, worktreeReads } from '../src/access.mjs';
import { sandboxedShell } from '../src/sensitive-writes.mjs';
import { liveFixture, settle } from './live-double.mjs';

function fakeHome(t) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dispatch-home-'))), previous = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = previous; rmSync(home, { recursive: true, force: true }); });
  return home;
}

test('home access keeps the sandbox and makes the home folder writable; full access drops the sandbox', t => {
  const home = fakeHome(t);
  assert.deepEqual(sandboxAccess('home'), { fullAccess: false, writableRoots: [home] });
  assert.deepEqual(sandboxAccess(undefined), { fullAccess: false, writableRoots: [home] });
  assert.deepEqual(sandboxAccess('full'), { fullAccess: true, writableRoots: [] });
});

test('runs snapshot the access setting when queued and pass it to the owner turn', async t => {
  const home = fakeHome(t);
  const { live, engine, project, adapter } = await liveFixture(t);
  assert.equal(live.accessMode, 'home');
  assert.throws(() => live.setAccess({ mode: 'everything' }), /worktrees, home or full/);
  const first = await live.create({ projectId: project.id, input: 'Build a todo app in ~/code' });
  await settle(engine, first);
  assert.deepEqual(live.setAccess({ mode: 'full' }), { accessMode: 'full' });
  assert.equal(engine.store.state.accessMode, 'full'); assert.equal(first.access, 'home');
  const second = await live.followup(first.id, { input: 'Now add tests' });
  await settle(engine, second);
  assert.equal(second.access, 'full');
  assert.deepEqual(adapter.calls.map(call => [call.fullAccess, call.writableRoots]), [[false, [home]], [true, []]]);
  assert.equal(adapter.calls[0].onAccess, undefined); assert.doesNotMatch(adapter.calls[0].prompt, /dispatch_request_access/);
});

test('worktrees access closes the home folder to the sandbox and reopens only the task worktrees, their Git metadata and Node', async t => {
  const home = fakeHome(t);
  assert.deepEqual(sandboxAccess('worktrees'), { fullAccess: false, writableRoots: [realpathSync(tmpdir())] });
  const { reads, gitDirs } = worktreeReads([join(home, 'w1'), join(home, 'w2')], [join(home, 'code', 'app')], '/opt/node/bin/node');
  assert.deepEqual(reads.denyRead, [home]);
  assert.deepEqual(reads.allowRead, [join(home, 'w1'), join(home, 'w2'), join(home, 'code', 'app', '.git'), '/opt/node', join(home, '.gitconfig'), join(home, '.config', 'git')]);
  assert.deepEqual(gitDirs, [join(home, 'code', 'app', '.git')]);
  assert.equal(sandboxedShell({ access: 'worktrees' }, { tool_name: 'Bash', input: { command: 'ls' } }).behavior, 'allow');
  const { live, engine, project, adapter } = await liveFixture(t);
  await live.saveProject({ ...project, confirmed: true, access: 'worktrees' }, project.id);
  const run = await live.create({ projectId: project.id, input: 'Change it' }); await settle(engine, run);
  assert.equal(run.access, 'worktrees');
  const call = adapter.calls[0];
  assert.deepEqual(call.reads.denyRead, [home]); assert.ok(call.reads.allowRead.includes(run.workspace));
  assert.ok(call.writableRoots.includes(run.workspace) && call.writableRoots.includes(join(project.repositoryPath, '.git')));
  assert.match(call.prompt, /Only this task's worktrees are readable/);
  assert.throws(() => live.setAccess({ mode: 'everything' }), /worktrees, home or full/);
});
