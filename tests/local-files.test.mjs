import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { git } from '../src/local-tools.mjs';
import { copyLocalFiles, localFileSettings } from '../src/local-files.mjs';

test('local files are relative paths inside the repository', () => {
  assert.deepEqual(localFileSettings(undefined), []);
  assert.deepEqual(localFileSettings([' .env.test ', 'config/./local.json', '.env.test']), ['.env.test', 'config/local.json']);
  for (const value of [['../secret'], ['/etc/hosts'], ['.git/config'], [''], ['.'], [3], 'x', Array.from({ length: 21 }, (_, index) => `f${index}`)]) assert.throws(() => localFileSettings(value), /local files|inside the repository/i, JSON.stringify(value));
});

test('only regular files Git ignores are copied into a worktree', async t => {
  const source = mkdtempSync(join(tmpdir(), 'dispatch-local-source-')), workspace = mkdtempSync(join(tmpdir(), 'dispatch-local-work-'));
  t.after(() => { rmSync(source, { recursive: true, force: true }); rmSync(workspace, { recursive: true, force: true }); });
  await git(workspace, ['init', '-q']); writeFileSync(join(workspace, '.gitignore'), '.env*\nconfig/\n');
  writeFileSync(join(source, '.env.test'), 'A=1'); writeFileSync(join(source, 'notes.txt'), 'n'); symlinkSync(join(source, '.env.test'), join(source, '.env.link'));
  const { copied, skipped } = await copyLocalFiles(source, workspace, ['.env.test', 'notes.txt', '.env.link', '.env.missing']);
  assert.deepEqual(copied, ['.env.test']); assert.equal(readFileSync(join(workspace, '.env.test'), 'utf8'), 'A=1');
  assert.deepEqual(skipped, ['notes.txt (Git does not ignore it, so it would be committed)', '.env.link (not a regular file)', '.env.missing (not in your checkout)']);
  assert.equal(existsSync(join(workspace, 'notes.txt')), false);
});
