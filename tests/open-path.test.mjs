import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openCommand, openPath } from '../src/open-path.mjs';

const fakeSpawn = (event, calls = []) => (command, args, options) => {
  const child = new EventEmitter(); child.unref = () => { child.unrefed = true; };
  calls.push({ command, args, options, child });
  queueMicrotask(() => event === 'spawn' ? child.emit('spawn') : child.emit('error', Object.assign(new Error('spawn failed'), { code: event })));
  return child;
};

test('open commands use the platform file manager and an overridable editor', () => {
  assert.deepEqual(openCommand('folder', '/w', { platform: 'linux', env: {} }), { command: 'xdg-open', args: ['/w'] });
  assert.deepEqual(openCommand('folder', '/w', { platform: 'darwin', env: {} }), { command: 'open', args: ['/w'] });
  assert.deepEqual(openCommand('editor', '/w', { env: {} }), { command: 'code', args: ['/w'] });
  assert.deepEqual(openCommand('editor', '/w', { env: { DISPATCH_EDITOR: ' zed ' } }), { command: 'zed', args: ['/w'] });
  assert.throws(() => openCommand('shell', '/w'), /Open target/);
});

test('openPath starts a detached process without a shell and reports a missing command', async () => {
  const calls = [];
  assert.deepEqual(await openPath('folder', '/w', { spawnProcess: fakeSpawn('spawn', calls), platform: 'linux' }), { command: 'xdg-open' });
  assert.equal(calls[0].options.shell, false); assert.equal(calls[0].options.detached, true); assert.equal(calls[0].child.unrefed, true);
  await assert.rejects(openPath('editor', '/w', { spawnProcess: fakeSpawn('ENOENT'), env: {} }), /code is not installed/);
});
