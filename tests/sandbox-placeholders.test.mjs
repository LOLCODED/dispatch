import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../src/local-tools.mjs';
import { removeSandboxPlaceholders, sandboxPlaceholders } from '../src/sandbox-placeholders.mjs';
import { completesWithFiles, liveFixture, settle, temporaryRepository } from './live-double.mjs';

const leavesPlaceholders = options => {
  mkdirSync(join(options.workspace, '.claude'), { recursive: true });
  for (const path of ['.bashrc', '.vscode', '.claude/agents', '.claude/settings.json']) writeFileSync(join(options.workspace, path), '');
  return completesWithFiles(options);
};

test('only empty, untracked files at sandbox-protected paths count as placeholders', async t => {
  const { dir, repo } = await temporaryRepository(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(repo, '.gitmodules'), ''); await git(repo, ['add', '.gitmodules']);
  writeFileSync(join(repo, '.bashrc'), ''); writeFileSync(join(repo, '.zshrc'), 'export A=1'); writeFileSync(join(repo, 'empty.txt'), '');
  const run = args => git(repo, args);
  assert.deepEqual(await sandboxPlaceholders(repo, run), ['.bashrc']);
  assert.deepEqual(await removeSandboxPlaceholders(repo, run), ['.bashrc']);
  assert.equal(existsSync(join(repo, '.bashrc')), false);
  for (const kept of ['.gitmodules', '.zshrc', 'empty.txt']) assert.ok(existsSync(join(repo, kept)), kept);
});

test('files the agent sandbox leaves behind stay out of the diff and the commit', async t => {
  const { live, engine, project, repo } = await liveFixture(t, { behavior: leavesPlaceholders });
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  assert.deepEqual(run.changedPaths, ['new.txt', 'value.txt']);
  assert.ok(run.events.some(event => /sandbox left behind: \.bashrc, \.vscode, \.claude\/agents, \.claude\/settings\.json/.test(event.message)));
  for (const path of ['.bashrc', '.vscode', '.claude']) assert.equal(existsSync(join(run.workspace, path)), false, path);
  assert.doesNotMatch((await live.diff(run.id)).diff, /bashrc|\.claude/);
  assert.equal(existsSync(join(repo, '.bashrc')), false);
  writeFileSync(join(run.workspace, '.profile'), '');
  const during = await live.diff(run.id);
  assert.equal(during.revision, run.revision); assert.equal(during.stale, false);
});
