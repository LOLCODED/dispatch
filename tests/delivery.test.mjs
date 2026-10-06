import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Delivery, ciRepairPrompt, ciState } from '../src/delivery.mjs';
import { changeFacts, describeChange } from '../src/change-summary.mjs';
import { TicketActions, writebackComment } from '../src/connectors/tickets.mjs';
import { ConnectorRegistry } from '../src/connectors/registry.mjs';
import { ConnectorService } from '../src/connectors/service.mjs';
import { exampleOn, exampleTracker, issueUrl, trackerOrigin } from './tracker-double.mjs';
import { forgeDouble, forgeOn, publishWrites } from './forge-double.mjs';
import { liveFixture, settle } from './live-double.mjs';

const sampleRun = () => ({ id: 'r1', ticketId: 'TASK-r1', title: 'Fix it', status: 'ready', branch: 'dispatch/r1', baseBranch: 'main', baseSha: 'base456', headSha: 'head123', revision: 'tree1', workspace: '/tmp/ws', checks: [{ name: 'unit', command: ['npm', 'run', 'unit'], status: 'passed', attempt: 1, revision: 'tree1' }, { name: 'old', status: 'failed', attempt: 1, revision: 'stale' }], delivery: null, ticket: { tracker: 'example', organization: 'https://tracker.example', project: 'web', id: '9', revision: 3, sourceUrl: 'https://tracker.example/web/issues/9' }, project: { connectors: exampleOn() } });
const failure = (kind, message) => Object.assign(new Error(message), { kind });

function orchestrator(options) {
  const forge = forgeDouble(options), state = {}, connectors = new ConnectorService({ registry: new ConnectorRegistry([forge.connector]), store: { state, save() {} } });
  const project = { connectors: forgeOn(), connectorMemory: {} }, delivery = new Delivery(connectors);
  return { forge, connectors, project, delivery, deliver: (run, extra) => delivery.deliver(run, project, extra) };
}

test('delivery pushes the task branch, opens one pull request with the change description and reads checks for the head SHA', async () => {
  const { forge, project, deliver } = orchestrator(), run = sampleRun();
  const summary = await deliver(run, { pages: ['/settings'] });
  assert.deepEqual(forge.calls.map(call => call.hook), ['push', 'findPullRequest', 'openPullRequest', 'checks']);
  assert.deepEqual(forge.of('push')[0], { hook: 'push', branch: 'dispatch/r1', base: 'main', headSha: 'head123', workspace: '/tmp/ws', remote: 'origin' });
  const opened = forge.of('openPullRequest')[0];
  assert.equal(opened.title, 'Fix it'); assert.equal(opened.draft, true);
  assert.match(opened.body, /TASK-r1 — Fix it/); assert.match(opened.body, /- unit: passed \(attempt 1, revision tree1\)/); assert.ok(!/old: failed/.test(opened.body)); assert.match(opened.body, /`\/settings`/);
  assert.deepEqual(project.connectorMemory.forge, { repository: 'example/repo' });
  assert.equal(run.delivery.error, null); assert.ok(run.delivery.pushedAt); assert.deepEqual([run.delivery.remote, run.delivery.connector, run.delivery.headSha], ['origin', 'forge', 'head123']);
  assert.deepEqual(run.delivery.pr, { number: 7, url: 'https://forge.example/repo/pull/7', state: 'OPEN', headRefOid: 'head123', reused: false, baseRefName: 'main' });
  assert.equal(run.delivery.ci.state, 'success'); assert.equal(run.delivery.ci.sha, 'head123'); assert.match(summary, /new pull request #7/);
});

test('an existing pull request for the branch is reused and a second delivery never opens another', async () => {
  const { forge, deliver } = orchestrator(), run = sampleRun();
  await deliver(run); await deliver(run);
  assert.equal(forge.of('openPullRequest').length, 1); assert.equal(run.delivery.pr.reused, true); assert.equal(run.delivery.pr.number, 7);
});

test('a failing hook stops delivery at its step, keeps what already happened and leaves the local result valid', async () => {
  for (const [hook, step, done] of [['push', 'push', []], ['findPullRequest', 'pr', ['push']], ['checks', 'ci', ['push', 'findPullRequest', 'openPullRequest']]]) {
    const { forge, deliver } = orchestrator(), run = sampleRun();
    forge.fail[hook] = failure('rate-limited', 'The forge refused the request.');
    const summary = await deliver(run);
    assert.deepEqual(forge.calls.map(call => call.hook), [...done, hook]);
    assert.deepEqual([run.delivery.error.step, run.delivery.error.kind, run.delivery.error.message], [step, 'rate-limited', 'The forge refused the request.']);
    assert.equal(Boolean(run.delivery.pushedAt), hook !== 'push'); assert.match(summary, /local commit remains valid/);
  }
  const { forge, deliver } = orchestrator(), plain = sampleRun();
  forge.fail.push = new Error('no kind');
  await deliver(plain); assert.equal(plain.delivery.error.kind, 'failed');
});

test('delivery refuses the base branch and an untested head before any hook runs', async () => {
  for (const change of [{ branch: 'main' }, { branch: '../x' }, { headSha: null }]) {
    const { forge, deliver } = orchestrator(), run = { ...sampleRun(), ...change };
    await deliver(run);
    assert.equal(forge.calls.length, 0); assert.equal(run.delivery.error.kind, 'refused');
  }
});

test('switched-off actions are skipped, and pushing switched off stops delivery', async () => {
  const { forge, project, deliver } = orchestrator(), run = sampleRun();
  project.connectors.forge.actions = { push: true, openPullRequest: false, readChecks: false };
  await deliver(run);
  assert.deepEqual(forge.calls.map(call => call.hook), ['push']); assert.equal(run.delivery.pr, null); assert.equal(run.delivery.ci, null); assert.equal(run.delivery.error, null);
  const off = orchestrator(), stopped = sampleRun();
  off.project.connectors.forge.actions = { push: false };
  await off.deliver(stopped);
  assert.equal(off.forge.calls.length, 0); assert.deepEqual([stopped.delivery.error.step, stopped.delivery.error.kind], ['push', 'off']); assert.match(stopped.delivery.error.message, /Pushing is switched off for Example Forge/);
});

test('CI state derives from check runs on the exact SHA and never changes the run', async () => {
  assert.equal(ciState([]), 'unknown');
  assert.equal(ciState([{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'skipped' }]), 'success');
  assert.equal(ciState([{ status: 'in_progress', conclusion: null }, { status: 'completed', conclusion: 'success' }]), 'pending');
  assert.equal(ciState([{ status: 'in_progress', conclusion: null }, { status: 'completed', conclusion: 'failure' }]), 'failure');
  assert.equal(ciState([{ status: 'completed', conclusion: 'stale' }]), 'unknown');
  const failing = orchestrator({ checks: [{ name: 'lint', status: 'completed', conclusion: 'failure' }] }), run = sampleRun();
  await failing.deliver(run);
  assert.equal(run.delivery.ci.state, 'failure'); assert.equal(run.status, 'ready');
  const broken = orchestrator({ checks: 'not a list' }), other = sampleRun();
  await broken.deliver(other);
  assert.equal(other.delivery.ci, null); assert.equal(other.delivery.error.step, 'ci');
});

test('refresh re-reads the pull request and checks for the recorded head SHA without pushing', async () => {
  const { forge, project, delivery } = orchestrator({ checks: [{ name: 'ci', status: 'queued', conclusion: null }] });
  const run = sampleRun();
  forge.pulls.set(`${run.workspace}:${run.branch}`, { number: 3, url: 'https://forge.example/repo/pull/3', state: 'CLOSED', reused: true });
  run.delivery = { branch: run.branch, remote: 'origin', headSha: 'head123', pushedAt: 'earlier', pr: null, ci: null, error: { step: 'ci', kind: 'rate-limited', message: 'x' }, tracker: { id: 'example', commented: true, rev: 3 } };
  run.headSha = 'different';
  await delivery.refresh(run, project);
  assert.deepEqual(forge.calls.map(call => [call.hook, call.sha]), [['findPullRequest', undefined], ['checks', 'head123']]);
  assert.equal(run.delivery.pr.state, 'CLOSED'); assert.equal(run.delivery.ci.state, 'pending'); assert.equal(run.delivery.error, null); assert.equal(run.delivery.tracker.commented, true);
  await assert.rejects(delivery.refresh(sampleRun(), project), /Nothing has been delivered/);
});

test('connector status is asked only once something uses the connector', async () => {
  let probes = 0;
  const forge = forgeDouble(), connectors = new ConnectorService({ registry: new ConnectorRegistry([forge.connector]), store: { state: {}, save() {} } });
  forge.connector.status = async () => { probes++; return { available: true, authenticated: false, detail: 'Log in first.' }; };
  assert.equal((await connectors.status([])).forge.enabled, false); assert.equal(probes, 0);
  assert.deepEqual(await connectors.status([{ connectors: forgeOn() }]), { forge: { available: true, authenticated: false, detail: 'Log in first.', enabled: true } });
});

test('the change description and tracker comment carry facts only, never ticket text', () => {
  const run = sampleRun(); run.ticket.description = 'SECRET ticket body';
  assert.ok(!/SECRET/.test(describeChange(changeFacts(run)).body)); assert.ok(!/SECRET/.test(writebackComment(run, 3)));
  assert.ok(!('ticket' in changeFacts(run)) && !('input' in changeFacts(run)));
  assert.match(writebackComment(run, 5), /^Ticket changed since dispatch \(rev 3 → 5\)\./); assert.ok(!/Ticket changed/.test(writebackComment(run, 3)));
  run.delivery = { pr: { url: 'https://forge.example/repo/pull/3', state: 'OPEN' } }; assert.match(writebackComment(run, 3), /Pull request: https:\/\/forge.example\/repo\/pull\/3 \(OPEN\)/);
});

function ticketActions(list) {
  const connectors = new ConnectorService({ registry: new ConnectorRegistry(list), store: { state: {}, save() {} } });
  return new TicketActions({ connectors, brain: null, log() {}, engine: null });
}

test('tracker writeback reads the revision first, posts one comment and skips when already commented', async () => {
  const setup = (rev, fail = false) => {
    const tracker = exampleTracker({ rev, ...(fail ? { revision: async () => { throw new Error('Work item could not be read.'); } } : {}) });
    return { tracker, writeback: ticketActions([tracker.connector]) };
  };
  const same = setup(3), run = sampleRun(); run.delivery = { tracker: null };
  assert.match(await same.writeback.comment(run), /Commented on Example Tracker work item 9 \(rev 3\)/);
  assert.deepEqual(same.tracker.calls.map(call => call.slice(0, 2)), [['comment', '9']]); assert.ok(!/Ticket changed/.test(same.tracker.calls[0][2]));
  assert.deepEqual({ id: run.delivery.tracker.id, commented: run.delivery.tracker.commented, rev: run.delivery.tracker.rev }, { id: 'example', commented: true, rev: 3 });
  assert.match(await same.writeback.comment(run), /already posted/); assert.equal(same.tracker.calls.length, 1);
  const changed = setup(5), moved = sampleRun(); moved.delivery = { tracker: null };
  assert.match(await changed.writeback.comment(moved), /changed since dispatch \(rev 3 → 5\)/);
  assert.match(changed.tracker.calls[0][2], /^Ticket changed since dispatch \(rev 3 → 5\)\./);
  const unreadable = setup(3, true), blocked = sampleRun(); blocked.delivery = { tracker: null };
  assert.match(await unreadable.writeback.comment(blocked), /not posted/); assert.equal(unreadable.tracker.calls.length, 0); assert.equal(blocked.delivery.tracker.commented, false); assert.match(blocked.delivery.tracker.error, /could not be read/);
  const noRevision = exampleTracker({ withRevision: false }), quiet = sampleRun(); quiet.delivery = { tracker: null };
  assert.match(await ticketActions([noRevision.connector]).comment(quiet), /Commented on Example Tracker work item 9\.$/); assert.equal(quiet.delivery.tracker.rev, null);
  const unknown = sampleRun(); unknown.delivery = { tracker: null };
  assert.match(await ticketActions([]).comment(unknown), /no work item a loaded connector can comment on/);
});

const stamps = async options => { options.onSession('session-1'); writeFileSync(join(options.workspace, 'value.txt'), `changed ${Date.now()}`); return { outcome: 'completed', sessionId: 'session-1', summary: 'Updated' }; };
const validation = [{ id: 'unit', command: process.execPath, args: ['-e', 'if(!require("fs").readFileSync("value.txt","utf8").startsWith("changed"))process.exit(1)'] }];
async function fixture(t, { forge = forgeDouble(), trackers = [], connectors, publish = false } = {}) {
  const adapter = { capabilities: async () => ({ available: true, authenticated: true }), run: stamps };
  const fixture = await liveFixture(t, { adapter, services: { connectors: [forge.connector, ...trackers] }, project: { connectors, validation } });
  if (publish) publishWrites(fixture.live);
  return { ...fixture, forge };
}

test('disabled delivery makes zero external calls and records nothing', async t => {
  const tracker = exampleTracker(), { live, engine, project, forge } = await fixture(t, { trackers: [tracker.connector] });
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'ready'); assert.equal(run.delivery, null); assert.equal(forge.calls.length, 0); assert.equal(tracker.calls.length, 0);
  assert.match(run.events.at(-1).message, /nothing pushed/); assert.equal((await live.connections()).connectors.forge.enabled, false);
  await assert.rejects(live.refreshDelivery(run.id), /not enabled/);
});

test('enabled delivery runs after readiness, logs one delivery event, remembers per repository and reuses the pull request for a follow-up', async t => {
  const { live, engine, project, forge } = await fixture(t, { connectors: forgeOn() });
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'ready'); assert.equal(run.delivery.error, null); assert.equal(run.delivery.headSha, run.headSha); assert.equal(run.delivery.branch, run.branch);
  assert.equal(forge.of('push')[0].workspace, run.workspace); assert.equal(run.delivery.pr.number, 7); assert.equal(run.delivery.ci.state, 'success');
  assert.equal(run.events.filter(event => event.kind === 'delivery').length, 1); assert.match(run.events.find(event => event.kind === 'ready').message, /delivering through Example Forge/);
  assert.deepEqual(live.projects.find(item => item.id === project.id).connectorMemory.forge, { repository: 'example/repo' });
  const followup = await live.followup(run.id, { input: 'Again' }); await settle(engine, followup);
  assert.equal(followup.status, 'ready'); assert.equal(forge.of('openPullRequest').length, 1); assert.equal(followup.delivery.pr.reused, true); assert.equal(forge.of('push').length, 2);
  const refreshed = await live.refreshDelivery(followup.id); assert.equal(refreshed.headSha, followup.headSha);
  assert.equal((await live.connections()).connectors.forge.enabled, true);
});

test('tracker writeback posts once per run only for tracker tickets with the comment action on', async t => {
  const tracker = exampleTracker();
  const { live, engine, project } = await fixture(t, { trackers: [tracker.connector], connectors: exampleOn() });
  const run = await live.create({ projectId: project.id, input: issueUrl('web', 9) }); await settle(engine, run);
  assert.equal(run.status, 'ready'); assert.equal(run.ticketId, 'EXAMPLE-9'); assert.equal(run.delivery.pushedAt, null); assert.equal(run.delivery.tracker.commented, true); assert.equal(run.delivery.tracker.rev, 4);
  assert.deepEqual(tracker.calls.map(call => call.slice(0, 2)), [['comment', '9']]);
  const pasted = await live.create({ projectId: project.id, input: 'Change the value again' }); await settle(engine, pasted);
  assert.equal(pasted.status, 'ready'); assert.equal(pasted.delivery, null); assert.equal(tracker.calls.length, 1);
});

test('run events reach a connector with its notify action on, after delivery, with a read-only summary', async t => {
  const tracker = exampleTracker();
  const { live, engine, project } = await fixture(t, { trackers: [tracker.connector], connectors: { ...exampleOn(), ...forgeOn() } });
  live.baseUrl = 'http://127.0.0.1:4317';
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  await new Promise(resolve => setImmediate(resolve));
  const [ready] = tracker.events;
  assert.deepEqual([ready.event, ready.run.id, ready.run.status, ready.run.url, ready.run.pullRequest, ready.run.repository.id], ['run.ready', run.id, 'ready', `http://127.0.0.1:4317/runs/${run.id}`, 'https://forge.example/repo/pull/7', project.id]);
  assert.deepEqual(ready.run.checks, [{ name: 'unit', status: 'passed' }]);
  ready.run.status = 'changed'; assert.equal(run.status, 'ready');
  live.setConnector(project.id, { example: { actions: { notify: false } } });
  const quiet = await live.create({ projectId: project.id, input: 'Change the value again' }); await settle(engine, quiet);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tracker.events.length, 1);
});

test('the change description carries the tracker reference, SQL, summary bullets and stability flags', () => {
  const run = sampleRun(); run.ticket.reference = 'EX-140'; run.title = '  Rename   the settings page  ';
  run.summary = 'Done.\n- Added a v3 route\n- Kept the legacy controller untouched\nDISPATCH_BLOCKED: not really\n- ignored\n\nNotes for next time:\n- none';
  run.sqlToRun = '-- db/migrations/001.sql\nCREATE TABLE x (id int);'; run.flags = { testsChanged: ['tests/a.test.mjs'], protectedTouched: [], envChanged: [], lockfileChanged: [] }; run.handoff = { baseMoved: 2 };
  const { title, body } = describeChange(changeFacts(run));
  assert.equal(title, 'EX-140 - Rename the settings page'); assert.equal(describeChange(changeFacts(sampleRun())).title, 'Fix it');
  assert.match(body, /^## Summary\n- Added a v3 route\n- Kept the legacy controller untouched\n\nWork item: EX-140 \(https:\/\/tracker\.example\/web\/issues\/9\)\n/); assert.ok(!/Notes for next time|- none/.test(body));
  assert.match(body, /## SQL to run before deploy\n```sql\n-- db\/migrations\/001\.sql\nCREATE TABLE x \(id int\);\n```/);
  assert.match(body, /## Flags\n- Test files changed: tests\/a\.test\.mjs\. Review the test diff before merging\.\n- Base moved by 2 commits since this run started; rebase before merge\./);
  assert.ok(!/Generated with|Co-Authored-By/.test(body));
});

test('the change description says where to look: app pages the agent opened, changed files by folder, and related pull requests', () => {
  const run = { ...sampleRun(), changedPaths: ['web/a.jsx', 'web/b.jsx', 'src/c.mjs', 'README.md'] };
  const { body } = describeChange(changeFacts(run, { pages: ['/settings'], related: [{ url: 'https://forge.example/api/pull/9', title: 'API side' }] }));
  assert.match(body, /## Where to look\n- Pages the agent opened in the browser while working:\n  - `\/settings`\n- Changed files by folder:\n  - `web`: a\.jsx, b\.jsx\n  - `src`: c\.mjs\n  - `\(repository root\)`: README\.md\n/);
  assert.match(body, /3\. Open the pages under Where to look and confirm they match the summary\./);
  assert.match(body, /## Related pull requests\n- https:\/\/forge\.example\/api\/pull\/9 — API side/);
  const plain = describeChange(changeFacts(sampleRun())).body;
  assert.match(plain, /## Where to look\n- No files changed\.\n/); assert.ok(!/Related pull requests/.test(plain));
});

function fakeTracker({ states = ['New', 'Active', 'Resolved'], rev = 4, fail = false } = {}) {
  const calls = [], tracker = exampleTracker({ rev, states,
    setState: async (ref, state, { expectedRevision }) => { calls.push([ref.id, state, expectedRevision]); if (expectedRevision !== tracker.rev) return { moved: false, changed: true, rev: tracker.rev }; tracker.rev++; return { moved: true, changed: false, rev: tracker.rev }; } });
  tracker.calls = calls;
  if (fail) tracker.states = async () => { throw new Error('no states'); };
  return tracker;
}
async function trackerFixture(t, options = {}) {
  const tracker = fakeTracker(options);
  return { ...await fixture(t, { trackers: [tracker.connector], connectors: { example: { enabled: true, actions: { state: true } }, ...forgeOn() } }), tracker };
}

test('the after-PR state offer appears only for tracker tickets with a PR, learns on the ladder, and undoes with a revision check', async t => {
  const { live, engine, project, tracker } = await trackerFixture(t);
  const text = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, text);
  assert.equal(text.status, 'ready'); assert.equal(text.offers, undefined);
  const first = await live.create({ projectId: project.id, input: issueUrl('proj', 9) }); await settle(engine, first);
  assert.equal(first.status, 'ready'); assert.equal(first.branch, 'dispatch/' + first.id);
  const offer = first.offers[0];
  assert.deepEqual([offer.kind, offer.status, offer.mode, offer.current, offer.options, offer.suggested], ['tracker.set-state', 'pending', 'ask', 'Active', ['New', 'Resolved'], null]);
  assert.equal(live.projects.find(item => item.id === project.id).connectorMemory.example.organization, trackerOrigin);
  await assert.rejects(live.answerOffer(first.id, offer.id, { value: '' }), /Choose a state/);
  const answered = await live.answerOffer(first.id, offer.id, { value: 'Resolved' });
  assert.equal(answered.status, 'applied'); assert.deepEqual(answered.result.previous, 'Active'); assert.deepEqual(tracker.calls, [['9', 'Resolved', 4]]);
  assert.equal(live.brain.find(answered.preferenceId).mode, 'ask');
  const second = await live.create({ projectId: project.id, input: issueUrl('proj', 10) }); await settle(engine, second);
  await live.answerOffer(second.id, second.offers[0].id, { value: 'Resolved' });
  const third = await live.create({ projectId: project.id, input: issueUrl('proj', 11) }); await settle(engine, third);
  assert.equal(third.offers[0].mode, 'suggest'); assert.equal(third.offers[0].suggested, 'Resolved');
  const undone = await live.undoOffer(second.id, second.offers[0].id);
  assert.equal(undone.status, 'undone'); assert.equal(tracker.calls.at(-1)[1], 'Active');
  assert.equal(live.brain.find(answered.preferenceId).mode, 'ask');
  await assert.rejects(live.undoOffer(second.id, second.offers[0].id), /Nothing to undo/);
});

test('auto mode moves the ticket without asking, drift keeps the offer pending, and never stops the card', async t => {
  const { live, engine, project, tracker } = await trackerFixture(t);
  const entry = live.brain.answer({ trigger: 'delivery.pr-opened', action: 'tracker.set-state', projectId: project.id, value: 'Resolved' });
  live.brain.setMode(entry.id, 'auto');
  const run = await live.create({ projectId: project.id, input: issueUrl('proj', 12) }); await settle(engine, run);
  assert.equal(run.offers[0].status, 'applied'); assert.equal(run.offers[0].result.auto, true); assert.equal(live.brain.find(entry.id).uses, 1);
  assert.match(run.events.find(event => event.kind === 'delivery' && /moved from/.test(event.message)).message, /remembered preference/);
  tracker.read = async ref => ({ ...ref, key: `example:${ref.id}`, revision: 1, title: 'Stale', description: 'x', acceptance: '', type: 'Bug', state: 'Active' });
  const drifted = await live.create({ projectId: project.id, input: issueUrl('proj', 13) }); await settle(engine, drifted);
  assert.equal(drifted.offers[0].status, 'pending'); assert.match(drifted.offers[0].error, /changed since dispatch/); assert.equal(drifted.offers[0].changedRevision, 5);
  const confirmed = await live.answerOffer(drifted.id, drifted.offers[0].id, { value: 'Resolved', confirmed: true });
  assert.equal(confirmed.status, 'applied');
  const never = await live.create({ projectId: project.id, input: issueUrl('proj', 14) }); await settle(engine, never);
  await live.answerOffer(never.id, never.offers[0].id, { value: 'never' });
  const quiet = await live.create({ projectId: project.id, input: issueUrl('proj', 15) }); await settle(engine, quiet);
  assert.equal(quiet.status, 'ready'); assert.equal(quiet.offers, undefined);
});

test('a branch template renders tracker branches and the push guard accepts them', async t => {
  const { live, engine, project, forge } = await trackerFixture(t, { fail: true });
  live.addBrainEntry({ kind: 'preference', scope: `project:${project.id}`, key: 'branch.template', value: '{type}/{ticketId}', pinned: true, mode: 'auto' });
  assert.throws(() => live.addBrainEntry({ kind: 'preference', scope: 'global', key: 'branch.template', value: '{slug}' }), /unique/);
  const run = await live.create({ projectId: project.id, input: issueUrl('proj', 9) }); await settle(engine, run);
  assert.equal(run.status, 'ready'); assert.equal(run.branch, 'bug/9'); assert.equal(run.delivery.error, null);
  assert.equal(forge.of('push')[0].branch, 'bug/9');
  assert.deepEqual(run.offers[0].options, []);
  const again = await live.create({ projectId: project.id, input: issueUrl('proj', 9) }); await settle(engine, again);
  assert.equal(again.branch, 'bug/9-2');
  const plain = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, plain);
  assert.equal(plain.branch, `task/${plain.id}`);
});

test('CI failure logs come from the connector, at most three, bounded into one repair prompt', async () => {
  const { forge, project, delivery } = orchestrator(), run = sampleRun();
  forge.logs.unit = `${'noise\n'.repeat(5000)}Error: expected 2 to be 3`;
  run.delivery = { headSha: 'head123', ci: { sha: 'head123', state: 'failure', checks: ['unit', 'lint', 'types', 'e2e'].map(name => ({ name, status: 'completed', conclusion: 'failure' })).concat({ name: 'ok', status: 'completed', conclusion: 'success' }) } };
  const logs = await delivery.failureLogs(run, project);
  assert.deepEqual(forge.of('checkLogs')[0].names, ['unit', 'lint', 'types']); assert.deepEqual(logs.map(item => item.name), ['unit', 'lint', 'types']);
  const prompt = ciRepairPrompt(run.delivery.ci, logs);
  assert.match(prompt, /failed on the pushed branch at head123: unit, lint, types, e2e/); assert.match(prompt, /expected 2 to be 3/); assert.ok(prompt.length <= 10_100);
  project.connectors.forge.actions.readChecks = false;
  assert.match((await delivery.failureLogs(run, project))[0].log, /switched off for Example Forge/);
});

test('Repair CI continues the same session with the failing logs only for a failure on the delivered head', async t => {
  const forge = forgeDouble({ checks: [{ name: 'unit', status: 'completed', conclusion: 'success' }] });
  forge.logs.unit = 'AssertionError: header spacing';
  const { live, engine, project } = await fixture(t, { forge, connectors: forgeOn() });
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  await assert.rejects(live.repairFromCi(run.id), /only a CI failure/);
  forge.checks = [{ name: 'unit', status: 'completed', conclusion: 'failure' }]; await live.refreshDelivery(run.id);
  const next = await live.repairFromCi(run.id);
  assert.equal(next.previousRunId, run.id); assert.match(next.input, /unit/); assert.match(next.input, /AssertionError: header spacing/);
  await settle(engine, next); assert.equal(next.status, 'ready');
  await assert.rejects(live.repairFromCi(run.id), /most recent/);
});

test('an operator-started publish needs the write actions switched on and the connector ready, but not the repository toggle', async t => {
  const { live, engine, project, forge } = await fixture(t);
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.delivery, null); assert.equal(forge.calls.length, 0);
  await assert.rejects(live.openPullRequest(run.id), /Push task branches is switched off for Example Forge/); assert.equal(forge.calls.length, 0);
  publishWrites(live); forge.status = { available: true, authenticated: false, detail: 'Log in to the forge first.' };
  await assert.rejects(live.openPullRequest(run.id), /Log in to the forge first/); assert.equal(forge.calls.length, 0);
  forge.status = { available: true, authenticated: true, detail: 'Ready.' };
  const published = await live.openPullRequest(run.id);
  assert.equal(published.delivery.error, null); assert.equal(published.delivery.pr.number, 7); assert.equal(forge.of('push')[0].branch, run.branch); assert.equal(forge.of('openPullRequest')[0].draft, true);
  assert.equal(run.events.filter(event => event.kind === 'delivery').length, 1);
  assert.equal((await live.refreshDelivery(run.id)).headSha, run.headSha);
  const followup = await live.followup(run.id, { input: 'Again' }); await settle(engine, followup);
  assert.equal(followup.delivery, null); await assert.rejects(live.openPullRequest(run.id), /most recent/);
});

test('pull requests opened together use the chosen base and link to each other', async t => {
  const { live, engine, project, forge } = await fixture(t, { publish: true });
  const first = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, first);
  const second = await live.create({ projectId: project.id, input: 'Change the value too' }); await settle(engine, second);
  await assert.rejects(live.pullRequests.open({ runIds: [first.id], bases: { [project.id]: '../main' } }), /valid base branch/); assert.equal(forge.of('push').length, 0);
  const runs = await live.pullRequests.open({ runIds: [first.id, second.id], bases: { [project.id]: 'staging' } });
  assert.deepEqual(runs.map(run => run.delivery.pr.number), [7, 8]);
  assert.ok(forge.of('openPullRequest').every(call => call.base === 'staging'));
  const edits = forge.of('describe');
  assert.deepEqual(edits.map(call => call.url), ['https://forge.example/repo/pull/7', 'https://forge.example/repo/pull/8']); assert.match(edits[0].body, /## Related pull requests\n- https:\/\/forge\.example\/repo\/pull\/8/);
  await assert.rejects(live.pullRequests.open({ runIds: [first.id] }), /no tested commit ready for a pull request/);
});

test('delivery follows the repository’s saved consent, not the copy a task started with', async () => {
  const forge = forgeDouble(), saved = { id: 'p1', connectors: forgeOn(), connectorMemory: {} };
  const connectors = new ConnectorService({ registry: new ConnectorRegistry([forge.connector]), store: { state: {}, save() {} }, projects: () => [saved] });
  const delivery = new Delivery(connectors), startedWithPushOff = { id: 'p1', connectors: { forge: { enabled: true, actions: { openPullRequest: true }, settings: {} } } };
  await delivery.deliver(sampleRun(), startedWithPushOff);
  assert.deepEqual(forge.calls.map(call => call.hook).slice(0, 1), ['push'], 'push switched on after the task started is honoured');
  saved.connectors.forge.actions.push = false;
  const run = sampleRun();
  await delivery.deliver(run, { id: 'p1', connectors: forgeOn() });
  assert.match(run.delivery.error?.message ?? '', /Pushing is switched off/, 'push switched off after the task started is refused');
});
