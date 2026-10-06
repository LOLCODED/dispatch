import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installLayout, launchdPlist, systemdUnit } from '../bin/install.mjs';
import { migrateData, rewritePaths, serviceEnv } from '../bin/migrate-data.mjs';
import { git } from '../src/local-tools.mjs';
import { temporaryRepository } from './live-double.mjs';

test('the service files give back the data folder, port and PATH they were written with', () => {
  const layout = { ...installLayout({ dir: '/home/me/odd "dir"%', port: 4400 }) }, path = '/home/me/bin:/usr/bin';
  for (const text of [systemdUnit({ layout, node: '/usr/bin/node', path }), launchdPlist({ layout, node: '/usr/bin/node', path })]) {
    assert.deepEqual(serviceEnv(text), { PORT: '4400', DISPATCH_DATA_DIR: '/home/me/odd "dir"%/data', PATH: path });
  }
});

test('only whole path prefixes are rewritten', () => {
  assert.deepEqual(rewritePaths({ a: '/old/data', b: ['/old/data/x', '/old/database', 'see /old/data'], c: 3, d: null }, '/old/data', '/new'), { a: '/new', b: ['/new/x', '/old/database', 'see /old/data'], c: 3, d: null });
});

test('moving the data folder rewrites stored paths and re-links worktrees of outside and inside repositories', async t => {
  const { dir, repo } = await temporaryRepository(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const from = join(dir, 'old'), to = join(dir, 'new'), workspaces = join(from, 'live-workspaces'), home = join(from, 'home');
  mkdirSync(workspaces, { recursive: true });
  const source = await temporaryRepository(); t.after(() => rmSync(source.dir, { recursive: true, force: true }));
  await git(dir, ['clone', '--quiet', source.repo, home]);
  await git(repo, ['worktree', 'add', '--quiet', '-b', 'run-a', join(workspaces, 'a')]);
  await git(home, ['worktree', 'add', '--quiet', '-b', 'run-b', join(workspaces, 'b')]);
  writeFileSync(join(from, 'state.json'), JSON.stringify({ version: 2, runs: [{ workspace: join(workspaces, 'a') }], projects: [{ repositoryPath: repo }, { repositoryPath: home }] }));
  writeFileSync(join(from, 'server.lock'), '1');
  assert.throws(() => migrateData(from, to), /stop it/); rmSync(join(from, 'server.lock'));
  const { failed } = migrateData(from, to);
  assert.deepEqual(failed, []); assert.equal(existsSync(from), false);
  const state = JSON.parse(readFileSync(join(to, 'state.json'), 'utf8'));
  assert.deepEqual([state.runs[0].workspace, ...state.projects.map(project => project.repositoryPath)], [join(to, 'live-workspaces', 'a'), repo, join(to, 'home')]);
  for (const name of ['a', 'b']) assert.match(await git(join(to, 'live-workspaces', name), ['status', '--short', '--branch']), new RegExp(`run-${name}`));
  assert.match(await git(repo, ['worktree', 'list']), new RegExp(join(to, 'live-workspaces', 'a')));
  assert.throws(() => migrateData(to, to), /already exists/);
});
