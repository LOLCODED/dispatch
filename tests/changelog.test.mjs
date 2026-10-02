import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../src/local-tools.mjs';
import { changelog, compareVersions, groupCommits } from '../src/changelog.mjs';
import { commitMessage, commitSubject, parseSubject, withoutCommitLine } from '../src/conventional-commit.mjs';
import { liveFixture, settle, temporaryRepository } from './live-double.mjs';

test('parseSubject reads Conventional Commits subjects and drops the legacy ticket prefix', () => {
  assert.deepEqual(parseSubject('feat(landing)!: land tasks on any branch'), { type: 'feat', scope: 'landing', breaking: true, description: 'land tasks on any branch' });
  assert.deepEqual(parseSubject('fix: keep the chat active'), { type: 'fix', scope: null, breaking: false, description: 'keep the chat active' });
  assert.deepEqual(parseSubject('TASK-0fe06b18: replace the archive button'), { type: null, scope: null, breaking: false, description: 'replace the archive button' });
  assert.equal(parseSubject('wip: something').type, null);
  assert.equal(parseSubject('Landing: name a commit').type, null);
});

test('commitSubject takes the last valid DISPATCH_COMMIT line and the summary hides it', () => {
  const summary = 'Changed things.\n\nDISPATCH_COMMIT: fix: old\n`DISPATCH_COMMIT: feat(ui): show release notes after an update`\n\nNotes for next time:\n- none';
  assert.equal(commitSubject(summary), 'feat(ui): show release notes after an update');
  assert.equal(withoutCommitLine(summary), 'Changed things.\n\nNotes for next time:\n- none');
  assert.equal(commitSubject('DISPATCH_COMMIT: made some changes'), null);
  assert.equal(commitSubject(`DISPATCH_COMMIT: feat: ${'x'.repeat(130)}`), null);
  assert.equal(commitSubject(null), null);
});

test('commitMessage falls back to the title and references tracker tickets in a footer', () => {
  assert.equal(commitMessage({ title: 'Add A\nmore', ticketId: 'TASK-1234abcd', ticket: {} }), 'Add A');
  assert.equal(commitMessage({ title: 'Add A', commitSubject: 'feat: add A', ticketId: 'EXAMPLE-42', ticket: { id: 42 } }), 'feat: add A\n\nRefs: EXAMPLE-42');
});

test('groupCommits orders groups by type, skips version bumps and puts untyped commits in Miscellaneous', () => {
  const groups = groupCommits([{ sha: 'a'.repeat(40), subject: '1.4.6' }, { sha: 'b'.repeat(40), subject: 'Docs: record things' }, { sha: 'c'.repeat(40), subject: 'fix(board): keep order' }, { sha: 'd'.repeat(40), subject: 'feat: release notes' }]);
  assert.deepEqual(groups.map(group => group.label), ['Features', 'Fixes', 'Miscellaneous']);
  assert.deepEqual(groups[1].entries, [{ sha: 'c'.repeat(12), scope: 'board', breaking: false, description: 'keep order' }]);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0 && compareVersions('v1.4.6', '1.4.6') === 0);
});

test('changelog lists each release after the seen version from the app\'s tags', async t => {
  const { dir, repo } = await temporaryRepository();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const commit = async (subject, tag) => { writeFileSync(join(repo, 'value.txt'), subject); await git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', subject]); if (tag) await git(repo, ['tag', tag]); };
  await commit('1.0.0', 'v1.0.0'); await commit('feat: first'); await commit('1.1.0', 'v1.1.0'); await commit('fix: second'); await commit('1.2.0', 'v1.2.0');
  const { releases } = await changelog(repo, { version: '1.2.0', since: '1.0.0' });
  assert.deepEqual(releases.map(release => [release.version, release.groups.map(group => group.entries[0].description)]), [['1.2.0', ['second']], ['1.1.0', ['first']]]);
  assert.deepEqual((await changelog(repo, { version: '1.2.0' })).releases.map(release => release.version), ['1.2.0']);
  assert.deepEqual((await changelog(join(repo, 'missing'), { version: '1.2.0' })).releases, []);
});

test('changelog lists every release up to the running version when asked for all', async t => {
  const { dir, repo } = await temporaryRepository();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (let minor = 0; minor <= 11; minor++) { writeFileSync(join(repo, 'value.txt'), String(minor)); await git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', `feat: change ${minor}`]); await git(repo, ['tag', `v1.${minor}.0`]); }
  const versions = (await changelog(repo, { version: '1.10.0', all: true })).releases.map(release => release.version);
  assert.deepEqual(versions, Array.from({ length: 11 }, (_, index) => `1.${10 - index}.0`));
});

test('a run commits with the worker\'s DISPATCH_COMMIT subject and keeps it out of the summary', async t => {
  const behavior = options => { writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Done.\nDISPATCH_COMMIT: feat(value): change the value' }; };
  const { live, engine, project } = await liveFixture(t, { behavior });
  const run = await settle(engine, await live.create({ projectId: project.id, input: 'Change the value' }));
  assert.equal(run.status, 'ready', JSON.stringify(run.events.at(-1)));
  assert.equal(await git(run.workspace, ['log', '-1', '--format=%s']), 'feat(value): change the value');
  assert.equal(run.summary, 'Done.');
});
