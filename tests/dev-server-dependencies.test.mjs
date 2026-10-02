import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareAppDependencies } from '../src/dev-server.mjs';

function workspace(t, lock = 'package-lock.json') {
  const dir = mkdtempSync(join(process.cwd(), '.browser-dependencies-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
  if (lock) writeFileSync(join(dir, lock), '{}');
  return dir;
}

test('browser installs missing npm dependencies before launch, including dev dependencies', async t => {
  for (const lock of ['package-lock.json', 'npm-shrinkwrap.json']) {
    const dir = workspace(t, lock), calls = [], controller = new AbortController();
    await prepareAppDependencies({ workspace: dir, start: { command: 'npm' }, signal: controller.signal, execute: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === 'ci') return { exitCode: 0, output: '' };
      throw new Error('launch reached');
    } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'npm');
    assert.deepEqual(calls[0].args, ['ci', '--include=dev']);
    assert.equal(calls[0].options.cwd, dir);
    assert.equal(calls[0].options.signal, controller.signal);
    assert.equal(calls[0].options.timeoutMs, 300_000);
  }
});

test('browser preserves installed dependencies and skips repositories without npm locks', async t => {
  for (const installed of [true, false]) {
    const dir = workspace(t, installed ? 'package-lock.json' : null), calls = [];
    if (installed) mkdirSync(join(dir, 'node_modules'));
    await prepareAppDependencies({ workspace: dir, start: { command: 'npm' }, execute: async (_command, args) => {
      calls.push(args);
    } });
    assert.equal(calls.length, 0);
  }
});

test('browser does not launch after failed, timed out or cancelled dependency setup', async t => {
  for (const result of [{ exitCode: 1 }, { exitCode: 0, timedOut: true }, { exitCode: 0, cancelled: true }]) {
    const dir = workspace(t), calls = [];
    await assert.rejects(prepareAppDependencies({ workspace: dir, start: { command: 'npm' }, execute: async (_command, args) => {
      calls.push(args);
      return { output: 'setup detail', ...result };
    } }), /Browser dependency setup .*failed.*\nsetup detail/);
    assert.deepEqual(calls, [['ci', '--include=dev']]);
  }
});
