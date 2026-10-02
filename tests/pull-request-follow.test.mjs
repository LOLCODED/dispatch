import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reviewRepairPrompt } from '../src/delivery.mjs';
import { forgeDouble, publishWrites } from './forge-double.mjs';
import { pullRequestState, taskState } from '../src/board-state.mjs';
import { askOf } from '../web/lib/board.mjs';
import { liveFixture, settle } from './live-double.mjs';

const pushedAt = '2026-10-01T10:00:00.000Z';
const delivered = (pr, extra = {}) => ({ id: 'r1', status: 'ready', resumable: true, delivery: { pushedAt, submittedAt: pushedAt, headSha: 'head1', pr: { number: 4, url: 'https://github.com/example/repo/pull/4', state: 'OPEN', baseRefName: 'main', ...pr }, ci: null, ...extra } });

test('an open pull request waits for merge, a merge completes it and anything blocking it needs a decision', () => {
  assert.equal(taskState({ latest: delivered({}) }), 'awaiting');
  assert.equal(taskState({ latest: { ...delivered({}), delivery: { ...delivered({}).delivery, submittedAt: undefined } } }), 'review');
  assert.equal(taskState({ latest: delivered({ state: 'MERGED' }) }), 'completed');
  assert.equal(taskState({ latest: delivered({ state: 'CLOSED' }) }), 'decision');
  assert.equal(taskState({ latest: delivered({ mergeable: 'CONFLICTING' }) }), 'decision');
  assert.equal(taskState({ latest: delivered({ reviewDecision: 'CHANGES_REQUESTED', changesRequestedAt: '2026-10-01T09:00:00Z' }) }), 'awaiting');
  assert.equal(pullRequestState(delivered({ reviewDecision: 'CHANGES_REQUESTED', changesRequestedAt: '2026-10-01T11:00:00Z' })), 'changes');
  assert.equal(pullRequestState(delivered({}, { ci: { sha: 'head1', state: 'failure', failing: ['unit'] } })), 'ci');
  assert.equal(pullRequestState(delivered({}, { ci: { sha: 'old', state: 'failure' } })), 'open');
  assert.equal(taskState({ latest: delivered({ state: 'MERGED' }), item: { archivedAt: pushedAt } }), 'archived');
});

test('the decision row offers the fix that matches what blocks the pull request', () => {
  const conflicts = askOf(delivered({ mergeable: 'CONFLICTING' }));
  assert.equal(conflicts.text, 'Pull request #4 conflicts with main.'); assert.deepEqual(conflicts.options.map(option => option.reason), ['conflicts']); assert.equal(conflicts.url, 'https://github.com/example/repo/pull/4');
  assert.match(askOf(delivered({}, { ci: { sha: 'head1', state: 'failure', failing: ['unit', 'lint'] } })).text, /CI failed on pull request #4: unit, lint\./);
  assert.equal(askOf(delivered({ reviewDecision: 'CHANGES_REQUESTED', changesRequestedAt: '2026-10-01T11:00:00Z' })).options[0].label, 'Address review');
  const closed = askOf(delivered({ state: 'CLOSED' }));
  assert.deepEqual(closed.options, []); assert.equal(closed.markDone, true);
});

test('review feedback becomes a bounded repair prompt marked as untrusted', () => {
  const prompt = reviewRepairPrompt({ number: 4 }, [{ author: 'ana', body: 'Rename this.' }, { author: 'bo', path: 'src/a.mjs', line: 3, body: 'x'.repeat(20000) }]);
  assert.match(prompt, /pull request #4/); assert.match(prompt, /untrusted/); assert.match(prompt, /### ana\nRename this\./); assert.match(prompt, /### bo on src\/a\.mjs:3/); assert.ok(prompt.length <= 10000);
  assert.match(reviewRepairPrompt({ number: 4 }, []), /no written comments/);
});

const stamps = async options => { options.onSession('session-1'); writeFileSync(join(options.workspace, 'value.txt'), `changed ${Date.now()}`); return { outcome: 'completed', sessionId: 'session-1', summary: 'Updated' }; };

test('a published task waits for merge, takes requested changes back to its session and completes once merged', async t => {
  const forge = forgeDouble({ checks: [] }), adapter = { capabilities: async () => ({ available: true, authenticated: true }), run: stamps };
  forge.next = 4;
  const validation = [{ id: 'unit', command: process.execPath, args: ['-e', 'if(!require("fs").readFileSync("value.txt","utf8").startsWith("changed"))process.exit(1)'] }];
  const { live, engine, project } = await liveFixture(t, { adapter, services: { connectors: [forge.connector] }, project: { validation } });
  publishWrites(live);
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(taskState({ latest: run }), 'review');
  await live.openPullRequest(run.id);
  assert.ok(run.delivery.submittedAt); assert.equal(taskState({ latest: run }), 'awaiting');
  await assert.rejects(live.pullRequests.repair(run.id, 'review'), /no requested changes/);

  const later = new Date(Date.parse(run.delivery.pushedAt) + 1).toISOString();
  Object.assign(forge.pull(run), { mergeable: 'MERGEABLE', reviewDecision: 'CHANGES_REQUESTED', changesRequestedAt: later });
  forge.reviews = [{ author: 'ana', state: 'CHANGES_REQUESTED', body: 'Rename the helper.', at: later }, { author: 'old', state: 'COMMENTED', body: 'Stale.', at: '2020-01-01T00:00:00Z' }, { author: 'ana', path: 'value.txt', line: 1, body: 'Typo here.', at: later }];
  await live.refreshDelivery(run.id);
  assert.equal(taskState({ latest: run }), 'decision'); assert.ok(run.events.some(event => /Changes were requested on pull request #4/.test(event.message)));
  const next = await live.pullRequests.repair(run.id, 'review');
  assert.equal(next.previousRunId, run.id); assert.match(next.input, /Rename the helper\./); assert.match(next.input, /value\.txt:1/); assert.ok(!/Stale\./.test(next.input));
  await settle(engine, next);

  await live.openPullRequest(next.id);
  assert.equal(taskState({ latest: next }), 'awaiting');
  forge.pull(next).state = 'MERGED'; await live.refreshDelivery(next.id);
  assert.equal(taskState({ latest: next }), 'completed'); assert.ok(next.events.some(event => /Pull request #4 was merged\./.test(event.message)));
  assert.equal(live.pullRequests.watched().length, 0);
});
