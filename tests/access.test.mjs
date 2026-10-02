import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxAccess } from '../src/access.mjs';
import { liveFixture, settle } from './live-double.mjs';

function fakeHome(t) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dispatch-home-'))), previous = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = previous; rmSync(home, { recursive: true, force: true }); });
  return home;
}

test('home access keeps the sandbox and makes the home folder writable; full access drops the sandbox', t => {
  const home = fakeHome(t);
  assert.deepEqual(sandboxAccess('home'), { fullAccess: false, writableRoots: [home] });
  assert.deepEqual(sandboxAccess(undefined), { fullAccess: false, writableRoots: [home] });
  assert.deepEqual(sandboxAccess('full'), { fullAccess: true, writableRoots: [] });
});

test('runs snapshot the access setting when queued and pass it to the owner turn', async t => {
  const home = fakeHome(t);
  const { live, engine, project, adapter } = await liveFixture(t);
  assert.equal(live.accessMode, 'home');
  assert.throws(() => live.setAccess({ mode: 'everything' }), /home or full/);
  const first = await live.create({ projectId: project.id, input: 'Build a todo app in ~/code' });
  await settle(engine, first);
  assert.deepEqual(live.setAccess({ mode: 'full' }), { accessMode: 'full' });
  assert.equal(engine.store.state.accessMode, 'full'); assert.equal(first.access, 'home');
  const second = await live.followup(first.id, { input: 'Now add tests' });
  await settle(engine, second);
  assert.equal(second.access, 'full');
  assert.deepEqual(adapter.calls.map(call => [call.fullAccess, call.writableRoots]), [[false, [home]], [true, []]]);
  assert.equal(adapter.calls[0].onAccess, undefined); assert.doesNotMatch(adapter.calls[0].prompt, /dispatch_request_access/);
});
