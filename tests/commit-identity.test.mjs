import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coAuthored, commitIdentity, dispatchCoAuthor } from '../src/commit-identity.mjs';
import { git } from '../src/local-tools.mjs';

async function isolatedRepository(t) {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-identity-')), previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = root; process.env.XDG_CONFIG_HOME = join(root, '.config');
  t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; rmSync(root, { recursive: true, force: true }); });
  const repo = join(root, 'repo');
  await git(root, ['init', '-b', 'main', repo]);
  return repo;
}

const trailer = 'Co-Authored-By: dispatch <dispatch@lolcoded.dev>';

async function commitAs(repo, message = 'change') {
  writeFileSync(join(repo, 'value.txt'), String(Math.random())); await git(repo, ['add', '.']);
  await git(repo, [...await commitIdentity(repo), 'commit', '-m', message]);
  return git(repo, ['log', '-1', '--format=%an <%ae>|%cn <%ce>']);
}

test('commits keep the Git identity as author and committer', async t => {
  const repo = await isolatedRepository(t), user = 'LOLCODED <lol@example.com>';
  await git(repo, ['config', 'user.name', 'LOLCODED']); await git(repo, ['config', 'user.email', 'lol@example.com']);
  assert.equal(await commitAs(repo), `${user}|${user}`);
});

test('without a Git identity dispatch authors and commits', async t => {
  const repo = await isolatedRepository(t);
  assert.equal(await commitAs(repo), 'dispatch <dispatch@lolcoded.dev>|dispatch <dispatch@lolcoded.dev>');
});

test('dispatch is credited as co-author unless the repository turns it off', () => {
  assert.equal(dispatchCoAuthor({}), true);
  assert.equal(dispatchCoAuthor({ dispatchCoAuthor: false }), false);
  assert.equal(coAuthored('feat: x', {}), `feat: x\n\n${trailer}`);
  assert.equal(coAuthored('feat: x', { dispatchCoAuthor: false }), 'feat: x');
});

test('the co-author trailer joins an existing trailer block once', async t => {
  assert.equal(coAuthored('feat: x\n\nRefs: EXAMPLE-1', {}), `feat: x\n\nRefs: EXAMPLE-1\n${trailer}`);
  assert.equal(coAuthored('feat: x\n\nWhy it changed.', {}), `feat: x\n\nWhy it changed.\n\n${trailer}`);
  assert.equal(coAuthored(coAuthored('feat: x', {}), {}), `feat: x\n\n${trailer}`);
  const repo = await isolatedRepository(t);
  await commitAs(repo, coAuthored('feat: x\n\nRefs: EXAMPLE-1', {}));
  assert.equal(await git(repo, ['log', '-1', '--format=%(trailers:key=Co-Authored-By,valueonly)']), 'dispatch <dispatch@lolcoded.dev>');
});
