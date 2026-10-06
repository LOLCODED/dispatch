import test from 'node:test';
import assert from 'node:assert/strict';
import { Updates, installedService, releaseAfter } from '../src/updates.mjs';

const files = map => path => { if (path in map) return map[path]; throw new Error('ENOENT'); };

test('a newer vX.Y.Z tag is offered; older, equal and pre-release tags are not', () => {
  assert.equal(releaseAfter('1.2.0', 'v1.2.0\nv1.10.0\nv1.3.0-rc1'), '1.10.0');
  assert.equal(releaseAfter('1.10.0', 'v1.2.0\nv1.10.0'), null);
});

test('the installed service is found from its systemd unit on Linux and its launchd plist on macOS', () => {
  const root = '/home/me/.local/share/dispatch/app';
  assert.equal(installedService(root, { platform: 'linux', home: '/home/me', read: files({ '/home/me/.config/systemd/user/dispatch.service': `[Service]\nWorkingDirectory=${root}\n` }) }), true);
  assert.equal(installedService('/home/me/code/dispatch', { platform: 'linux', home: '/home/me', read: files({ '/home/me/.config/systemd/user/dispatch.service': `WorkingDirectory=${root}\n` }) }), false);
  const plist = '/Users/me/Library/LaunchAgents/dev.dispatch.server.plist', mac = '/Users/me/.local/share/dispatch & co/app';
  assert.equal(installedService(mac, { platform: 'darwin', home: '/Users/me', read: files({ [plist]: '  <key>WorkingDirectory</key><string>/Users/me/.local/share/dispatch &amp; co/app</string>\n' }) }), true);
  assert.equal(installedService(mac, { platform: 'darwin', home: '/Users/me', read: files({}) }), false);
});

test('the installed service reads release tags from its origin; a checkout never checks', async () => {
  const calls = [], execute = async (command, args) => { calls.push([command, ...args]); return { exitCode: 0, output: 'a\trefs/tags/v1.2.0\nb\trefs/tags/v1.3.0\n' }; };
  const status = await new Updates({ root: '/app', version: '1.2.0', execute, installed: true }).check();
  assert.deepEqual([status.latest, status.installed, status.error], ['1.3.0', true, null]);
  assert.deepEqual(calls[0], ['git', 'ls-remote', '--tags', '--refs', 'origin']);
  const checkout = new Updates({ root: '/app', version: '1.2.0', execute, installed: false });
  assert.equal((await checkout.check()).latest, null); assert.equal(calls.length, 1);
  const later = new Updates({ root: '/app', version: '1.2.0', execute, installed: true });
  await later.fresh(); const checked = Date.parse(later.checkedAt);
  await later.fresh({ now: checked + 9 * 60 * 1000 }); assert.equal(calls.length, 2, 'a check under ten minutes old is reused');
  await later.fresh({ now: checked + 11 * 60 * 1000 }); assert.equal(calls.length, 3, 'an older one is repeated');
  await checkout.fresh(); assert.equal(calls.length, 3, 'a checkout never checks');
  const failing = new Updates({ root: '/app', version: '1.2.0', execute: async () => ({ exitCode: 128, output: 'fatal: no origin' }), installed: true });
  assert.match((await failing.check()).error, /Could not read release tags: fatal: no origin/);
});
