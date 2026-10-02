import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeContextImages } from '../src/browser-evidence.mjs';
import { claudeArgs, claudeInput } from '../src/claude.mjs';
import { CodexAdapter } from '../src/codex.mjs';
import { contextImageLimits } from '../src/context-images.mjs';
import { liveFixture, settle } from './live-double.mjs';

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('pixels')]);
const pasted = { mimeType: 'image/png', data: png.toString('base64') };

test('pasted images must be at most the limit of real PNG or JPEG files', () => {
  assert.equal(decodeContextImages([pasted]).length, 1);
  assert.equal(decodeContextImages([{ mimeType: 'image/png', data: Buffer.from('not a png').toString('base64') }]), null);
  assert.equal(decodeContextImages([{ mimeType: 'image/gif', data: pasted.data }]), null);
  assert.equal(decodeContextImages(Array(contextImageLimits.count + 1).fill(pasted)), null);
  assert.equal(decodeContextImages('image'), null);
});

test('a dispatched run keeps pasted images and hands them to the first worker turn', async t => {
  const { live, engine, project, adapter } = await liveFixture(t);
  const run = await live.create({ projectId: project.id, input: 'Match this screenshot', images: [pasted] });
  const [image] = run.artifacts;
  assert.equal(run.artifacts.length, 1); assert.equal(image.source, 'context'); assert.equal(image.mimeType, 'image/png');
  await settle(engine, run);
  assert.equal(run.status, 'ready');
  assert.equal(adapter.calls[0].images.length, 1);
  assert.deepEqual(readFileSync(adapter.calls[0].images[0]), png);
});

test('a run with an invalid pasted image is refused before it is queued', async t => {
  const { live, engine, project } = await liveFixture(t);
  await assert.rejects(live.create({ projectId: project.id, input: 'Match this', images: [{ mimeType: 'image/png', data: 'bad' }] }), /PNG or JPEG/);
  assert.equal(engine.runs.length, 0);
});

test('Claude receives pasted images as stream-json image blocks', () => {
  assert.equal(claudeInput('Plain prompt'), 'Plain prompt');
  const message = JSON.parse(claudeInput('Look', ['/tmp/shot.png'], () => png));
  assert.deepEqual(message.message.content, [{ type: 'text', text: 'Look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pasted.data } }]);
  assert.ok(claudeArgs({ sessionId: 's', streamInput: true }).join(' ').includes('--input-format stream-json'));
  assert.ok(!claudeArgs({ sessionId: 's' }).includes('--input-format'));
});

test('Codex exec attaches pasted images with --image', async () => {
  let captured;
  const adapter = new CodexAdapter({ execute: async (command, args) => { captured = args; return { exitCode: 1, output: '' }; } });
  await adapter.turn({ workspace: '/tmp', prompt: 'Look', images: ['/tmp/shot.png'], readOnly: true }, []);
  assert.deepEqual(captured.slice(captured.indexOf('--image'), captured.indexOf('--image') + 2), ['--image', '/tmp/shot.png']);
});
