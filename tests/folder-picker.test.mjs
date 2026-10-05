import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { folderPickerCommand, pickFolder } from '../src/folder-picker.mjs';

const fakeSpawn = ({ code = 0, stdout = '', stderr = '' }, calls = []) => (command, args, options) => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  calls.push({ command, args, options });
  setImmediate(() => { child.stdout.end(stdout); child.stderr.end(stderr); setImmediate(() => child.emit('close', code)); });
  return child;
};

function binDir(...commands) {
  const dir = mkdtempSync(join(tmpdir(), 'picker-'));
  for (const command of commands) { writeFileSync(join(dir, command), ''); chmodSync(join(dir, command), 0o755); }
  return dir;
}

test('folder dialogs use the native picker for each platform', () => {
  assert.equal(folderPickerCommand({ platform: 'darwin' }).command, 'osascript');
  assert.equal(folderPickerCommand({ platform: 'win32' }).command, 'powershell');
  const PATH = binDir('kdialog', 'zenity');
  assert.deepEqual(folderPickerCommand({ platform: 'linux', start: '/h', env: { PATH, DISPLAY: ':0', XDG_CURRENT_DESKTOP: 'KDE' } }).args.slice(-2), ['--getexistingdirectory', '/h']);
  assert.equal(folderPickerCommand({ platform: 'linux', env: { PATH, WAYLAND_DISPLAY: 'wayland-0', XDG_CURRENT_DESKTOP: 'GNOME' } }).command, 'zenity');
  assert.throws(() => folderPickerCommand({ platform: 'linux', env: { PATH } }), /no desktop session/);
  assert.throws(() => folderPickerCommand({ platform: 'linux', env: { PATH: binDir(), DISPLAY: ':0' } }), /Install kdialog or zenity/);
});

test('pickFolder returns the chosen path, null on cancel, and reports dialog failures', async () => {
  const calls = [];
  assert.deepEqual(await pickFolder({ platform: 'darwin', spawnProcess: fakeSpawn({ stdout: '/Users/me/code/app/\n' }, calls) }), { path: '/Users/me/code/app' });
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(await pickFolder({ platform: 'darwin', spawnProcess: fakeSpawn({ code: 1, stderr: 'User canceled. (-128)' }) }), { path: null });
  assert.deepEqual(await pickFolder({ platform: 'win32', spawnProcess: fakeSpawn({}) }), { path: null });
  await assert.rejects(pickFolder({ platform: 'darwin', spawnProcess: fakeSpawn({ code: 134, stderr: 'warning\ncould not connect to display' }) }), /could not connect to display/);
});

test('only one folder dialog opens at a time', async () => {
  const first = pickFolder({ platform: 'darwin', spawnProcess: fakeSpawn({ stdout: '/a' }) });
  assert.throws(() => pickFolder({ platform: 'darwin', spawnProcess: fakeSpawn({}) }), /already open/);
  assert.deepEqual(await first, { path: '/a' });
});

test('on macOS several folders can be picked at once', async () => {
  const calls = [];
  assert.match(folderPickerCommand({ platform: 'darwin', multiple: true }).args[1], /with multiple selections allowed/);
  assert.deepEqual(await pickFolder({ platform: 'darwin', multiple: true, spawnProcess: fakeSpawn({ stdout: '/Users/me/code/api/\n/Users/me/code/web/\n' }, calls) }), { path: '/Users/me/code/api', paths: ['/Users/me/code/api', '/Users/me/code/web'] });
  assert.deepEqual(await pickFolder({ platform: 'darwin', multiple: true, spawnProcess: fakeSpawn({ code: 1 }) }), { path: null, paths: [] });
});
