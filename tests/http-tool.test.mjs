import test from 'node:test';
import assert from 'node:assert/strict';
import { httpCall, httpTool } from '../src/http-tool.mjs';
import { toolNames, toolSet } from '../src/dispatch-tools.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { httpApps } from '../src/linked-repositories.mjs';
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
  assert.match(prompts[0], /dispatch_browser_\*/); assert.match(prompts[0], /dispatch_http/); assert.match(prompts[0], /dispatch_memory/); assert.match(prompts[0], /about dispatch itself .* dispatch_settings/);
  assert.doesNotMatch(prompts[1], /dispatch_[a-z]/);
});

test('dispatch_http reaches any app dispatch can start, with or without the browser', t => {
  const withDev = mkdtempSync(join(tmpdir(), 'dispatch-http-')), plain = mkdtempSync(join(tmpdir(), 'dispatch-http-'));
  t.after(() => { rmSync(withDev, { recursive: true, force: true }); rmSync(plain, { recursive: true, force: true }); });
  writeFileSync(join(withDev, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.mjs' } }));
  assert.deepEqual(httpApps({ workspace: withDev, project: {}, linked: [{ name: 'Web', workspace: plain, project: { browser: { enabled: true } } }, { name: 'Docs', workspace: plain, project: {} }] }), ['app:/', 'app:web/']);
  assert.deepEqual(httpApps({ workspace: plain, project: {} }), []);
});

test('a backend repository without the browser gets dispatch_http in its prompt when it has a dev script', async t => {
  const prompts = [];
  const { live, engine, project, repo } = await liveFixture(t, { adapter: { ...workerDouble(options => { prompts.push(options.prompt); return completes(options); }), contract: { tools: 'mcp' } } });
  await settle(engine, await live.create({ projectId: project.id, input: 'No dev script yet' }));
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.mjs' } }));
  execFileSync('git', ['-C', repo, 'add', 'package.json']); execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'dev script']);
  await settle(engine, await live.create({ projectId: project.id, input: 'With a dev script' }));
  assert.doesNotMatch(prompts[0], /dispatch_http/); assert.doesNotMatch(prompts[1], /dispatch_browser_/);
  assert.match(prompts[1], /Exercise API changes with dispatch_http: app:\/ reaches the app/);
});
