import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contextFileLimits, contextFileProblem, decodeContextFiles } from '../src/context-files.mjs';
import { evidenceRoute } from '../src/server-routes.mjs';
import { liveFixture, settle } from './live-double.mjs';

const bytes = Buffer.from('column,other\nhello,world\n');
const document = { name: 'ticket.csv', data: bytes.toString('base64') };

test('document uploads accept supported original bytes and reject invalid names, encoding, sizes and counts', () => {
  for (const name of ['ticket.pdf', 'ticket.DOCX', 'ticket.xlsx', 'ticket.csv', 'notes.txt', 'table.tsv']) {
    assert.deepEqual(decodeContextFiles([{ ...document, name }])[0].bytes, bytes);
  }
  for (const name of ['../ticket.csv', 'C:\\ticket.csv', 'ticket.csv\n', 'ticket.sh', 'toString', 'a'.repeat(181) + '.csv']) assert.equal(decodeContextFiles([{ ...document, name }]), null);
  assert.equal(decodeContextFiles([{ ...document, data: 'bad=' }]), null);
  assert.equal(decodeContextFiles([{ ...document, data: '' }]), null);
  assert.equal(decodeContextFiles([null]), null);
  assert.equal(decodeContextFiles({}), null);
  assert.equal(decodeContextFiles(Array(contextFileLimits.count + 1).fill(document)), null);
  assert.equal(decodeContextFiles([{ ...document, data: Buffer.alloc(contextFileLimits.bytes + 1).toString('base64') }]), null);
  assert.match(contextFileProblem([{ name: 'ticket.csv', size: bytes.length }], contextFileLimits.count), /up to 4/);
});

test('original files remain downloadable, reach worker prompts and survive a fresh-session follow-up without becoming images', async t => {
  const { live, engine, project, adapter } = await liveFixture(t);
  const run = await live.create({ projectId: project.id, input: 'Use the attached spreadsheet', files: [document] });
  const item = run.artifacts[0], file = live.browserEvidence.artifact(run, item.id);
  assert.equal(item.name, document.name);
  assert.equal(item.source, 'context-file');
  assert.equal(item.mimeType, 'text/csv');
  assert.deepEqual(readFileSync(file.path), bytes);
  assert.deepEqual(live.browserEvidence.contextPaths(run), []);
  await settle(engine, run);
  assert.equal(run.status, 'ready');
  assert.ok(adapter.calls[0].prompt.includes(JSON.stringify({ name: document.name, path: file.path })));
  assert.deepEqual(adapter.calls[0].images, []);

  let headers, response;
  const path = `/api/runs/${run.id}/artifacts/${item.id}`;
  assert.equal(await evidenceRoute({ live, engine }, { method: 'GET' }, { writeHead: (status, value) => { assert.equal(status, 200); headers = value; }, end: value => { response = value; } }, new URL(`http://localhost${path}?inline`), path), true);
  assert.equal(headers['Content-Type'], 'text/csv');
  assert.match(headers['Content-Disposition'], /^attachment;/);
  assert.deepEqual(response, bytes);

  const followup = await live.followup(run.id, { input: 'Continue using the original attachment' });
  followup.freshSession = true;
  await settle(engine, followup);
  assert.ok(adapter.calls[1].prompt.includes(file.path));
  assert.ok(adapter.calls[1].prompt.includes(document.name));
});

test('invalid uploads are rejected before a worker run is queued', async t => {
  const { live, engine, project } = await liveFixture(t);
  await assert.rejects(live.create({ projectId: project.id, input: 'Use this document', files: [{ ...document, name: '../ticket.csv' }] }), /supported documents/);
  assert.equal(engine.runs.length, 0);
});
