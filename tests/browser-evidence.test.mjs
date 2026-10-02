import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserEvidence } from '../src/browser-evidence.mjs';
function setup(t) { const dir = mkdtempSync(join(tmpdir(), 'dispatch-evidence-')); const workspace = join(dir, 'repo'); mkdirSync(workspace); const run = { id: 'run', workspace, project: {}, attempt: 1, revision: 'tree', artifacts: [] }; t.after(() => rmSync(dir, { recursive: true, force: true })); return { dir, run, evidence: new BrowserEvidence(dir), step: { id: 'browser', command: 'npm', args: ['run', 'test:e2e'] } }; }
test('collects fresh screenshots and traces outside the candidate and retains earlier attempts', t => {
  const { run, evidence, step } = setup(t); mkdirSync(join(run.workspace, 'test-results')); writeFileSync(join(run.workspace, 'test-results', 'old.png'), 'old');
  const observation = evidence.start(run, step); writeFileSync(join(run.workspace, 'test-results', 'new.png'), 'image'); writeFileSync(join(run.workspace, 'test-results', 'trace.zip'), 'trace');
  assert.equal(evidence.finish(run, observation), 0);
  assert.equal(run.artifacts.length, 2); assert.ok(run.artifacts.every(a => a.revision === 'tree' && a.check === 'browser')); assert.equal(run.browser, undefined);
  const artifact = evidence.artifact(run, run.artifacts[0].id); assert.ok(artifact.path.startsWith(evidence.root)); assert.equal(readFileSync(artifact.path, 'utf8'), 'image');
  run.attempt = 2; const next = evidence.start(run, step); evidence.finish(run, next); assert.equal(run.artifacts.length, 2);
});
test('rejects symlink escapes and arbitrary artifact ids', t => {
  const { dir, run, evidence, step } = setup(t); writeFileSync(join(dir, 'private.png'), 'private'); mkdirSync(join(run.workspace, 'test-results'));
  const observation = evidence.start(run, step); symlinkSync(join(dir, 'private.png'), join(run.workspace, 'test-results', 'leak.png')); evidence.finish(run, observation);
  assert.equal(run.artifacts.length, 0); assert.equal(evidence.artifact(run, '../private'), null);
});
test('ordinary unit commands are not scanned for browser evidence', t => {
  const { run, evidence } = setup(t); assert.equal(evidence.start(run, { id: 'unit', command: 'npm', args: ['test'] }), null); assert.equal(evidence.finish(run, null), 0);
});
test('evidence beyond the retention limit is counted, not copied', t => {
  const { run, evidence, step } = setup(t); mkdirSync(join(run.workspace, 'test-results'));
  run.artifacts = Array.from({ length: 80 }, () => ({ size: 1 }));
  const observation = evidence.start(run, step); writeFileSync(join(run.workspace, 'test-results', 'late.png'), 'image');
  assert.equal(evidence.finish(run, observation), 1); assert.equal(run.artifacts.length, 80);
});

test('agent browser snapshots are bounded and retained as observations without a check revision', t => {
  const { run, evidence } = setup(t);
  const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jcEIAAAAASUVORK5CYII=' };
  assert.equal(evidence.observeAgent(run, { label: 'browser/screenshot', images: [image] }), true);
  assert.deepEqual(readFileSync(evidence.artifact(run, run.artifacts[0].id).path), Buffer.from(image.data, 'base64'));
  assert.equal(run.artifacts[0].source, 'agent'); assert.equal(run.artifacts[0].revision, null); assert.equal(run.artifacts[0].name, 'Agent browser 1.png');
  for (let i = 0; i < 6; i++) evidence.observeAgent(run, { images: [image] });
  assert.equal(run.artifacts.length, 7); assert.equal(run.artifacts.at(-1).name, 'Agent browser 7.png');
  assert.equal(evidence.observeAgent(run, { images: [{ ...image, mimeType: 'image/svg+xml' }, { ...image, mimeType: 'image/jpeg' }, { ...image, data: 'invalid' }, { ...image, data: 'A'.repeat(1400001) }] }), false);
  assert.equal(run.artifacts.length, 7);
  run.artifacts = Array.from({ length: 80 }, () => ({ size: 1 })); assert.equal(evidence.observeAgent(run, { images: [image] }), false); assert.equal(run.artifacts.length, 80);
});

test('agent browser snapshots carry the latest pointer until the turn is forgotten', t => {
  const { run, evidence } = setup(t);
  const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jcEIAAAAASUVORK5CYII=' }, pointer = { x: 12, y: 34, action: 'left_click' };
  assert.equal(evidence.observeAgent(run, { phase: 'started', pointer }), false);
  evidence.observeAgent(run, { phase: 'completed', images: [image] }); evidence.observeAgent(run, { phase: 'completed', images: [image] });
  assert.deepEqual(run.artifacts.map(artifact => artifact.pointer), [pointer, pointer]);
  evidence.forget(run); evidence.observeAgent(run, { phase: 'completed', images: [image] });
  assert.equal(run.artifacts.at(-1).pointer, undefined);
});
