import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { completeSetup, setupNeeded } from '../src/onboarding.mjs';

test('setup is needed only for a fresh workspace that has not finished it', () => {
  const fresh = { projects: [], runs: [], tasks: [] };
  assert.equal(setupNeeded(fresh), true);
  assert.equal(setupNeeded({ ...fresh, setupCompletedAt: '2026-10-02T00:00:00.000Z' }), false);
  assert.equal(setupNeeded({ ...fresh, projects: [{ id: 'p' }] }), false);
  assert.equal(setupNeeded({ ...fresh, runs: [{ id: 'r' }] }), false);
  assert.equal(setupNeeded({ ...fresh, tasks: [{ id: 't' }] }), false);
});

test('completing setup persists the first completion time', t => {
  const directory = mkdtempSync(join(tmpdir(), 'dispatch-onboarding-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  assert.equal(setupNeeded(store.state), true);
  const first = completeSetup(store, new Date('2026-10-02T10:00:00.000Z'));
  assert.deepEqual(completeSetup(store, new Date('2026-10-03T10:00:00.000Z')), first);
  assert.equal(JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).setupCompletedAt, '2026-10-02T10:00:00.000Z');
  assert.equal(setupNeeded(new Store(directory).state), false);
});
