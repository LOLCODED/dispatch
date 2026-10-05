import test from 'node:test';
import assert from 'node:assert/strict';
import { httpCall, httpTool } from '../src/http-tool.mjs';
import { toolNames, toolSet } from '../src/dispatch-tools.mjs';
import { completes, liveFixture, settle, workerDouble } from './live-double.mjs';

const resolveUrl = async url => `http://127.0.0.1:5199${url.replace(/^app:[\w.-]*/i, '')}`;

test('dispatch_http sends the request to the task app and reports status, key headers and a capped body', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => { seen.push({ url: String(url), options }); return new Response('x'.repeat(30000), { status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' } }); };
  const result = await httpCall({ args: { method: 'POST', url: 'app:api/v1/items?draft=1', headers: { 'content-type': 'application/json' }, body: '{"a":1}' }, resolveUrl, fetchImpl });
  assert.equal(seen[0].url, 'http://127.0.0.1:5199/v1/items?draft=1'); assert.equal(seen[0].options.body, '{"a":1}'); assert.equal(seen[0].options.redirect, 'manual');
  assert.match(result.content[0].text, /^POST \/v1\/items\?draft=1 → 201 Created in \d+ ms\ncontent-type: application\/json\n\nx{24000}\n… 6000 more characters$/);
  const get = await httpCall({ args: { url: 'app:/health', body: 'ignored' }, resolveUrl, fetchImpl: async (url, options) => { seen.push({ options }); return new Response('ok'); } });
  assert.equal(seen.at(-1).options.body, undefined); assert.match(get.content[0].text, /^GET \/health → 200/);
});

test('dispatch_http only reaches the task’s own local apps', async () => {
  const fetchImpl = async () => { throw new Error('should not fetch'); };
  await assert.rejects(httpCall({ args: { url: 'https://example.test/' }, resolveUrl, fetchImpl }), /only reaches this task/);
  await assert.rejects(httpCall({ args: { url: 'app:/x' }, resolveUrl: async () => 'http://example.test/x', fetchImpl }), /only reaches local dev servers/);
});

test('dispatch_http is attached only with the app tools', () => {
  assert.deepEqual(toolNames(toolSet({ http: true })), ['dispatch_http']);
  assert.equal(toolSet({ browser: true }).some(tool => tool.name === httpTool.name), false);
});

test('the worker prompt names dispatch tools only when the provider receives them', async t => {
  const prompts = [];
  const record = tools => ({ ...workerDouble(options => { prompts.push(options.prompt); return completes(options); }), contract: { tools } });
  for (const tools of ['mcp', 'none']) {
    const { live, engine, project } = await liveFixture(t, { adapter: record(tools), project: { browser: { enabled: true } } });
    await settle(engine, await live.create({ projectId: project.id, input: `Prompt with tools ${tools}` }));
  }
  assert.match(prompts[0], /dispatch_browser_\*/); assert.match(prompts[0], /dispatch_http/); assert.match(prompts[0], /dispatch_memory/);
  assert.doesNotMatch(prompts[1], /dispatch_[a-z]/);
});
