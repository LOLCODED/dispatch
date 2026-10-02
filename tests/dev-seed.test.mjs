import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedDevData } from '../scripts/dev-seed.mjs';

test('an empty dev data directory gets runs for every outcome, two of them ready to land together, and seeding never touches existing runs', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dispatch-dev-seed-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  assert.equal(await seedDevData(dataDir), true);
  const runs = () => JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).runs;
  assert.deepEqual(runs().map(run => [run.title, run.status]), [
    ['Break the value check', 'failed'], ['Pick a colour for the Count button', 'blocked'], ['Where is the demo value stored?', 'ready'], ['Add a footer note to the demo', 'ready'], ['Change the demo value', 'ready'],
  ]);
  const before = readFileSync(join(dataDir, 'state.json'), 'utf8');
  assert.equal(await seedDevData(dataDir), false);
  assert.equal(readFileSync(join(dataDir, 'state.json'), 'utf8'), before);
});
