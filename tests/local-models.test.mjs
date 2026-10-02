import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeAdapter } from '../src/claude.mjs';
import { LocalModelAdapter, claudeProviderEnv, endpointList, localSession, minimumContext, ollamaBase, opencodeProvider, piProvider, resolveLocalModel } from '../src/local-models.mjs';

const json = value => ({ ok: true, json: async () => value });
function server(routes, seen = []) {
  return async (url, options) => {
    seen.push([url, options.body ? JSON.parse(options.body) : null]);
    const route = routes[url];
    if (!route) throw new Error('connection refused');
    return json(typeof route === 'function' ? route(JSON.parse(options.body)) : route);
  };
}
const turn = args => [{ type: 'system', subtype: 'init', session_id: args[args.indexOf('--session-id') + 1] }, { type: 'result', subtype: 'success', is_error: false, result: 'Done', session_id: args[args.indexOf('--session-id') + 1], usage: {} }].map(event => JSON.stringify(event)).join('\n') + '\n';
function claude(calls = [], version = 0) {
  return new ClaudeAdapter({ execute: async (command, args, options) => {
    calls.push({ args, options });
    if (args[0] === '--version') return { exitCode: version, output: '2.1.0 (Claude Code)\n' };
    options.onStdout?.(Buffer.from(turn(args))); return { exitCode: 0, output: '' };
  } });
}
const home = { id: 'home', name: 'Home', kind: 'ollama', url: 'http://127.0.0.1:11434' };
const box = { id: 'box', name: 'GPU box', kind: 'server', url: 'http://10.0.0.5:1234' };
const local = (routes, { endpoints = [home], calls } = {}) => new LocalModelAdapter({ endpoints: () => endpoints, fetchJson: server(routes), claude: claude(calls) });
const loaded = (size, model = 'qwen3.6:latest') => ({ 'http://127.0.0.1:11434/api/generate': {}, 'http://127.0.0.1:11434/api/ps': { models: [{ name: model, context_length: size }] } });

test('Ollama host parsing keeps the local default and normalizes bind-all addresses', () => {
  assert.equal(ollamaBase(undefined), 'http://127.0.0.1:11434');
  assert.equal(ollamaBase('0.0.0.0:11500'), 'http://127.0.0.1:11500');
  assert.equal(ollamaBase('https://models.example.test'), 'https://models.example.test');
});

test('endpoint lists keep stable ids, derive unique ones and reject credentials or unknown kinds', () => {
  assert.deepEqual(endpointList([{ id: 'home', name: ' Home ', kind: 'ollama', url: 'http://127.0.0.1:11434/' }, { name: 'Home', kind: 'server', url: 'http://10.0.0.5:1234' }]),
    [{ id: 'home', name: 'Home', kind: 'ollama', url: 'http://127.0.0.1:11434' }, { id: 'home-2', name: 'Home', kind: 'server', url: 'http://10.0.0.5:1234' }]);
  assert.throws(() => endpointList([{ name: 'x', kind: 'ollama', url: 'http://user:pass@host' }]), /without credentials/);
  assert.throws(() => endpointList([{ name: 'x', kind: 'grpc', url: 'http://host' }]), /kind/);
  assert.throws(() => endpointList([{ name: 'x', kind: 'ollama', url: 'file:///etc' }]), /http/);
  assert.throws(() => endpointList(Array.from({ length: 9 }, () => ({ name: 'x', kind: 'ollama', url: 'http://h' }))), /at most 8/);
});

test('model ids name their endpoint and resolve only against saved endpoints', () => {
  assert.deepEqual(resolveLocalModel('box/hf.co/org/model:q4', [home, box]), { endpoint: box, model: 'hf.co/org/model:q4' });
  assert.equal(resolveLocalModel('gone/qwen', [home]), null);
  assert.equal(resolveLocalModel('home/--flag', [home]), null);
  assert.equal(resolveLocalModel(null, [home]), null);
});

test('discovery lists tool-capable Ollama models and every server model, per endpoint', async () => {
  const adapter = local({
    'http://127.0.0.1:11434/api/tags': { models: [{ name: 'qwen3.6:latest' }, { name: 'embed:latest' }, { name: '--unsafe' }] },
    'http://127.0.0.1:11434/api/show': body => ({ capabilities: body.model.startsWith('qwen') ? ['completion', 'tools'] : ['embedding'] }),
    'http://10.0.0.5:1234/v1/models': { data: [{ id: 'devstral' }] },
  }, { endpoints: [home, box, { id: 'off', name: 'Off', kind: 'ollama', url: 'http://127.0.0.1:9' }] });
  const result = await adapter.models();
  assert.deepEqual(result.models.map(model => [model.model, model.isDefault]), [['home/qwen3.6:latest', true], ['box/devstral', false]]);
  assert.deepEqual(result.models[0].supportedReasoningEfforts, []);
  assert.match(result.message, /Home: 1 model, 1 without tool support hidden\. GPU box: 1 model\. Off is not reachable/);
});

test('capabilities need Claude Code and a reachable endpoint, never a login', async () => {
  const ready = await local({ 'http://127.0.0.1:11434/api/version': { version: '0.31.2' } }).capabilities();
  assert.equal(ready.available && ready.authenticated, true); assert.match(ready.version, /Ollama 0\.31\.2 · 2\.1\.0 \(Claude Code\)/);
  assert.ok(!ready.detail.includes('login'));
  const down = await local({}).capabilities();
  assert.equal(down.available, false); assert.match(down.detail, /Home is not reachable at http:\/\/127\.0\.0\.1:11434/);
  const noCodex = await new LocalModelAdapter({ endpoints: () => [home], fetchJson: server({}), claude: claude([], 1) }).capabilities();
  assert.match(noCodex.detail, /Install it/);
});

test('turns refuse without a saved model and refuse a context too small for agent tools', async () => {
  const calls = [];
  assert.match((await local({}, { calls }).run({ prompt: 'x', execution: { provider: 'local-models', model: null } })).summary, /Choose a local model/);
  const small = await local(loaded(4096), { calls }).run({ prompt: 'x', execution: { provider: 'local-models', model: 'home/qwen3.6:latest' } });
  assert.equal(small.outcome, 'failed'); assert.match(small.summary, new RegExp(`4096-token context.*OLLAMA_CONTEXT_LENGTH=${minimumContext}`));
  assert.match((await local({}, { calls }).run({ prompt: 'x', execution: { provider: 'local-models', model: 'home/qwen3.6:latest' } })).summary, /Home could not load qwen3\.6:latest/);
  assert.equal(calls.length, 0);
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await local({}, { calls }).run({ prompt: 'x', signal: aborted.signal, execution: { provider: 'local-models', model: 'home/qwen3.6:latest' } })).outcome, 'cancelled');
});

test('turns run Claude Code against the endpoint with its context window, no Claude login and no reasoning level', async () => {
  const calls = [];
  const result = await local(loaded(32768), { calls }).run({ prompt: 'x', readOnly: true, execution: { provider: 'local-models', model: 'home/qwen3.6:latest', effort: 'high' } });
  assert.equal(result.outcome, 'completed');
  const { args, options } = calls[0];
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'qwen3.6:latest']);
  assert.ok(!args.includes('--effort'));
  assert.equal(options.inheritEnv, false);
  assert.deepEqual([options.env.ANTHROPIC_BASE_URL, options.env.ANTHROPIC_AUTH_TOKEN, options.env.ANTHROPIC_API_KEY, options.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, options.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW], ['http://127.0.0.1:11434', 'dispatch-local', '', 'qwen3.6:latest', '32768']);
});

test('server endpoints are used as given and skip the context check', async () => {
  assert.equal(claudeProviderEnv(box, 'devstral').ANTHROPIC_BASE_URL, 'http://10.0.0.5:1234');
  assert.equal(claudeProviderEnv(box, 'devstral').CLAUDE_CODE_AUTO_COMPACT_WINDOW, undefined);
  const calls = [];
  assert.equal((await local({}, { endpoints: [box], calls }).run({ prompt: 'x', readOnly: true, execution: { provider: 'local-models', model: 'box/devstral' } })).outcome, 'completed');
  assert.equal(calls[0].options.env.ANTHROPIC_BASE_URL, 'http://10.0.0.5:1234');
});

const recorder = (name, calls) => ({ contract: { sandbox: false }, version: async () => `${name} 1`, run: async (options, extra) => { calls.push({ name, options, extra }); options.onSession?.(`${name}-session`); return { outcome: 'completed', sessionId: `${name}-session` }; } });
const harnessed = (agent, calls) => new LocalModelAdapter({ endpoints: () => [home], agent: () => agent, fetchJson: server(loaded(32768)), claude: recorder('claude', calls), opencode: recorder('opencode', calls), pi: recorder('pi', calls) });

test('the chosen agent drives the endpoint with its own provider config, and its sessions are tagged', async () => {
  const calls = [], sessions = [];
  const opencode = await harnessed('opencode', calls).run({ prompt: 'x', execution: { provider: 'local-models', model: 'home/qwen3.6:latest' }, onSession: id => sessions.push(id) });
  assert.equal(calls[0].options.execution.model, 'dispatch_local/qwen3.6:latest');
  assert.deepEqual(calls[0].extra, opencodeProvider(home, 'qwen3.6:latest', 32768));
  assert.equal(calls[0].extra.provider.dispatch_local.options.baseURL, 'http://127.0.0.1:11434/v1');
  assert.deepEqual([opencode.sessionId, sessions[0]], ['opencode:opencode-session', 'opencode:opencode-session']);
  await harnessed('pi', calls).run({ prompt: 'x', execution: { provider: 'local-models', model: 'home/qwen3.6:latest' } });
  assert.deepEqual(calls[1].extra, { models: piProvider(home, 'qwen3.6:latest', 32768) });
  assert.equal(calls[1].extra.models.providers.dispatch_local.models[0].contextWindow, 32768);
  assert.equal(harnessed('pi', calls).contract.sandbox, false);
  assert.equal(harnessed('unknown', calls).harness.id, 'claude');
});

test('a follow-up resumes only its own agent session and starts fresh after the agent changes', async () => {
  const calls = [];
  await harnessed('pi', calls).run({ prompt: 'x', sessionId: 'pi:abc', execution: { provider: 'local-models', model: 'home/qwen3.6:latest' } });
  await harnessed('pi', calls).run({ prompt: 'x', sessionId: 'claude:def', execution: { provider: 'local-models', model: 'home/qwen3.6:latest' } });
  assert.deepEqual(calls.map(call => call.options.sessionId), ['abc', undefined]);
  assert.deepEqual(localSession('5b1c'), { agent: 'claude', id: '5b1c' });
  assert.deepEqual(localSession(undefined), { agent: null, id: undefined });
});
