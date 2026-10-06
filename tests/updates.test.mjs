import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Updates, progressView, releaseAfter } from '../src/updates.mjs';

function fixture(t, { unit = true, service = 'dispatch', active = 'inactive', tags = 'abc\trefs/tags/v1.2.0\ndef\trefs/tags/v1.10.0\nghi\trefs/tags/v1.3.0-rc1\n', systemdRun = 0 } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dispatch-updates-')), app = join(home, '.local', 'share', 'dispatch', 'app'), data = join(home, '.dispatch');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true }); mkdirSync(data, { recursive: true }); mkdirSync(app, { recursive: true });
  if (unit) writeFileSync(join(home, '.config', 'systemd', 'user', `${service}.service`), `[Service]\nWorkingDirectory=${app}\n`);
  const calls = [];
  const execute = async (command, args) => {
    calls.push([command, ...args]);
    if (command === 'git') return { exitCode: 0, output: tags };
    if (command === 'systemctl') return { exitCode: 3, output: `${active}\n` };
    return { exitCode: systemdRun, output: systemdRun ? 'Unit dispatch-update.service already exists.' : '' };
  };
  const updates = new Updates({ root: `${app}/`, version: '1.2.0', dataDir: data, env: { PORT: '4317', PATH: '/usr/bin', ...(service === 'dispatch' ? {} : { DISPATCH_SERVICE: service }) }, platform: 'linux', execute, home });
  return { updates, calls, app, data, home };
}

test('a newer vX.Y.Z tag on origin is offered; older, equal and pre-release tags are not', async t => {
  assert.equal(releaseAfter('1.2.0', 'v1.2.0\nv1.10.0\nv1.3.0-rc1'), '1.10.0');
  assert.equal(releaseAfter('1.10.0', 'v1.2.0\nv1.10.0'), null);
  const { updates, calls } = fixture(t);
  const status = await updates.check();
  assert.deepEqual([status.installed, status.current, status.latest, status.error, status.progress], [true, '1.2.0', '1.10.0', null, null]);
  assert.deepEqual(calls[0], ['git', 'ls-remote', '--tags', '--refs', 'origin']);
});

test('a checkout that no user service runs, such as npm run dev, never checks or updates itself', async t => {
  const { updates, calls } = fixture(t, { unit: false });
  assert.deepEqual(await updates.check(), { current: '1.2.0', latest: null, checkedAt: null, error: null, installed: false, progress: null });
  assert.equal(calls.length, 0);
  await assert.rejects(updates.start(), /Only the installed dispatch service/);
});

test('the update runs in its own transient unit with the service, status file and install folder', async t => {
  const { updates, calls, data } = fixture(t, { service: 'dispatch-test' });
  await updates.start();
  const run = calls.find(call => call[0] === 'systemd-run');
  assert.deepEqual(run.slice(0, 7), ['systemd-run', '--user', '--unit=dispatch-test-update', '--collect', '--quiet', '--setenv=PORT=4317', '--setenv=PATH=/usr/bin']);
  assert.deepEqual(run.slice(-7), ['update', '--service', 'dispatch-test', '--port', '4317', '--status', join(data, 'update.json')], 'the default install folder passes no --dir');
  assert.equal(JSON.parse(readFileSync(join(data, 'update.json'), 'utf8')).stage, 'starting');
});

test('an install in its own folder passes that folder to the update', async t => {
  const home = mkdtempSync(join(tmpdir(), 'dispatch-updates-')), app = join(home, 'test-install', 'app');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.config', 'systemd', 'user'), { recursive: true }); mkdirSync(app, { recursive: true });
  writeFileSync(join(home, '.config', 'systemd', 'user', 'dispatch-test.service'), `WorkingDirectory=${app}\n`);
  const calls = [], execute = async (command, args) => { calls.push([command, ...args]); return { exitCode: command === 'systemctl' ? 3 : 0, output: '' }; };
  await new Updates({ root: app, version: '1.2.0', dataDir: home, env: { DISPATCH_SERVICE: 'dispatch-test' }, platform: 'linux', execute, home }).start();
  assert.deepEqual(calls.find(call => call[0] === 'systemd-run').slice(-2), ['--dir', join(home, 'test-install')]);
});

test('a second update is refused while one runs, and a unit that cannot start records the failure', async t => {
  await assert.rejects(fixture(t, { active: 'active' }).updates.start(), /already running/);
  const { updates, data } = fixture(t, { systemdRun: 1 });
  await assert.rejects(updates.start(), /Could not start the update: Unit dispatch-update.service already exists/);
  assert.equal(JSON.parse(readFileSync(join(data, 'update.json'), 'utf8')).stage, 'failed');
});

test('progress reports done once the new version runs, and a vanished updater as failed', () => {
  assert.deepEqual(progressView({ stage: 'restarting', version: 'v1.3.0', at: 'x' }, { version: '1.3.0', running: false }), { stage: 'done', version: '1.3.0', at: 'x' });
  assert.equal(progressView({ stage: 'building', at: 'x' }, { version: '1.2.0', running: true }).stage, 'building');
  assert.match(progressView({ stage: 'building', at: 'x' }, { version: '1.2.0', running: false }).message, /stopped before it finished/);
  assert.deepEqual(progressView({ stage: 'failed', message: 'Updating to v1.3.0 failed', at: 'x' }, { version: '1.2.0', running: false }), { stage: 'failed', message: 'Updating to v1.3.0 failed', at: 'x' });
  assert.equal(progressView(null, { version: '1.2.0', running: false }), null);
  assert.equal(progressView({ stage: 'failed', message: 'old', at: '2026-01-01T00:00:00.000Z' }, { version: '1.2.0', running: false, startedAt: Date.parse('2026-02-01T00:00:00.000Z') }), null);
});
