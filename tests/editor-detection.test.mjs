import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editorCommand, installedEditors } from '../src/open-path.mjs';

function binDir(...commands) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-editors-'));
  for (const command of commands) { writeFileSync(join(dir, command), ''); chmodSync(join(dir, command), 0o755); }
  writeFileSync(join(dir, 'subl'), '');
  return dir;
}

test('installed editors lists only executable known editors on PATH', () => {
  const env = { PATH: binDir('zed', 'kate', 'unknown') };
  assert.deepEqual(installedEditors({ platform: 'linux', env }).map(editor => editor.command), ['zed', 'kate']);
  assert.deepEqual(installedEditors({ platform: 'linux', env: {} }), []);
});

test('editor command prefers DISPATCH_EDITOR, then the chosen installed editor, then the first detected', () => {
  const PATH = binDir('cursor', 'kate');
  assert.equal(editorCommand(undefined, { platform: 'linux', env: { PATH } }), 'cursor');
  assert.equal(editorCommand('kate', { platform: 'linux', env: { PATH } }), 'kate');
  assert.equal(editorCommand('kate', { platform: 'linux', env: { PATH, DISPATCH_EDITOR: 'nvim-qt' } }), 'nvim-qt');
  assert.throws(() => editorCommand('zed', { platform: 'linux', env: { PATH } }), /zed is not installed.*Settings → Editor/);
  assert.throws(() => editorCommand('rm -rf', { platform: 'linux', env: { PATH } }), /not installed/);
  assert.equal(editorCommand(undefined, { platform: 'linux', env: {} }), 'code');
});
