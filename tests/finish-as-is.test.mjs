import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { liveFixture, settle } from './live-double.mjs';

const question = 'The export needs access I lack. How should I proceed?';
const blocked = summary => ({ outcome: 'blocked', sessionId: 'session-1', summary });
const report = `Changed the value.\n\nDISPATCH_BLOCKED: ${question}\n1. You run it — fastest\n2. Allow the host\n\nDISPATCH_REMAINING:\n- Commit the export.`;

test('blocked replies that change nothing are counted, and the changes can be checked and saved as is without another turn', async t => {
  const { live, engine, project, turns } = await liveFixture(t, { behavior: (options, turn) => {
    if (turn === 1) writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    return blocked(report);
  } });
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.status, 'blocked'); assert.deepEqual({ ...run.blockedTree, revision: undefined }, { revision: undefined, files: 1, linkedFiles: 0, repeats: 1 });
  const unchanged = await live.followup(run.id, { input: 'Try again' }); await settle(engine, unchanged);
  assert.equal(unchanged.blockedTree.repeats, 2); assert.equal(unchanged.blockedTree.revision, run.blockedTree.revision);
  const taken = await live.finishAsIs(unchanged.id); await settle(engine, taken);
  assert.equal(taken.status, 'ready', JSON.stringify(taken.events.map(event => event.message)));
  assert.equal(turns(), 2); assert.equal(taken.asIs, true);
  assert.deepEqual(taken.checks.map(check => [check.name, check.status]), [['unit', 'passed']]);
  assert.ok(taken.headSha && taken.headSha !== taken.baseSha);
  assert.deepEqual(taken.remaining.items, [`Open question: ${question}`, 'Commit the export.']);
  assert.doesNotMatch(taken.handoff.body, /DISPATCH_BLOCKED|Allow the host/);
  await assert.rejects(live.finishAsIs(taken.id), /after it stops blocked/);
});

test('a blocked run without changes cannot be taken as is', async t => {
  const { live, engine, project } = await liveFixture(t, { behavior: () => blocked(`DISPATCH_BLOCKED: ${question}`) });
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  assert.equal(run.blockedTree.files, 0);
  await assert.rejects(live.finishAsIs(run.id), /no changes to check and save/);
});

test('changes taken as is that fail a check stop blocked without an agent repair turn', async t => {
  const { live, engine, project, turns } = await liveFixture(t, { behavior: options => {
    writeFileSync(join(options.workspace, 'value.txt'), 'bad');
    return blocked(report);
  } });
  const run = await live.create({ projectId: project.id, input: 'Change the value' }); await settle(engine, run);
  const taken = await live.finishAsIs(run.id); await settle(engine, taken);
  assert.equal(taken.status, 'blocked'); assert.equal(turns(), 1); assert.equal(taken.handoff, null);
  assert.match(taken.events.at(-1).message, /taken as they are, but check unit still failed\. Reply to have the agent fix it/);
  assert.deepEqual(taken.checks.map(check => [check.name, check.status]), [['unit', 'failed']]);
});
