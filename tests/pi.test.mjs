import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiAdapter, piAgentDir, piArgs, piModels } from '../src/pi.mjs';

const session = '11111111-2222-4333-8444-555555555555';
const encode = events => events.map(event => JSON.stringify(event)).join('\n') + '\n';
const assistant = (content, stopReason = 'stop', extra = {}) => ({ type: 'message_end', message: { role: 'assistant', content, stopReason, usage: { input: 100, output: 10, cacheRead: 40, cacheWrite: 5 }, ...extra } });
const turn = id => [
  { type: 'session', id }, { type: 'agent_start' },
  assistant([{ type: 'toolCall', name: 'codemode' }], 'toolUse'),
  { type: 'tool_execution_start', toolCallId: 'c/1', toolName: 'mcp__dispatch__dispatch_browser_navigate', args: { url: 'app:/' }, parentToolCallId: 'c' },
  { type: 'tool_execution_end', toolCallId: 'c/1', toolName: 'mcp__dispatch__dispatch_browser_navigate', result: { content: [{ type: 'text', text: 'opened' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }] }, isError: false },
  assistant([{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Done ✓' }]),
  { type: 'agent_end', messages: [] },
];
function home() {
  const dir = mkdtempSync(join(tmpdir(), 'pi-home-'));
  writeFileSync(join(dir, 'auth.json'), '{"secret":true}'); writeFileSync(join(dir, 'models.json'), '{"providers":{}}');
  return dir;
}
function adapter(events, result = {}, inspect = () => {}, root = home()) {
  return new PiAdapter({ home: () => root, bridge: async () => ({ mcp: { command: 'node', args: ['mcp.mjs'], env: { DISPATCH_TOOL_TOKEN: 't' } }, close: async () => {} }), execute: async (command, args, options) => {
    inspect(args, options);
    if (args[0] === '--version') return { exitCode: 0, output: '1.0.0\n' };
    if (args[0] === '--list-models') return { exitCode: 0, output: 'provider  model  context  max-out  thinking  images\nollama  qwen3.6:latest  262.1K  16.4K  yes  yes\nopenai  gpt-4  8.2K  8.2K  no  no\n' };
    options.onStdout?.(Buffer.from(encode(typeof events === 'function' ? events(args) : events)));
    return { exitCode: 0, output: '', ...result };
  } });
}

test('pi args run print mode with an exact session id, ignore project-local files and restrict review tools', () => {
  assert.deepEqual(piArgs({ sessionId: session, execution: { model: 'ollama/qwen3.6:latest', effort: 'high' } }), ['-p', '--mode', 'json', '--no-approve', '--offline', '--session-id', session, '--model', 'ollama/qwen3.6:latest', '--thinking', 'high']);
  const review = piArgs({ sessionId: session, readOnly: true, images: ['/i.png'] });
  assert.deepEqual(review.slice(-3), ['--tools', 'read,grep,find,ls', '@/i.png']);
});

test('pi models come from the table, with thinking levels only where reported', () => {
  const models = piModels('provider  model  context  max-out  thinking  images\nollama  qwen3.6:latest  262.1K  16.4K  yes  yes\nopenai  gpt-4  8.2K  8.2K  no  no');
  assert.deepEqual(models.map(model => [model.model, model.supportedReasoningEfforts.length]), [['ollama/qwen3.6:latest', 3], ['openai/gpt-4', 0]]);
});

test('the per-turn agent directory links the operator files, adds MCP and local models, and is removed after', async () => {
  const root = home();
  const linked = await piAgentDir({ home: root, mcp: { command: 'node', args: ['m.mjs'], env: { T: '1' } } });
  assert.ok(lstatSync(join(linked.dir, 'auth.json')).isSymbolicLink()); assert.ok(lstatSync(join(linked.dir, 'models.json')).isSymbolicLink());
  assert.deepEqual(JSON.parse(readFileSync(join(linked.dir, 'mcp.json'), 'utf8')), { mcpServers: { dispatch: { command: 'node', args: ['m.mjs'], env: { T: '1' } } } });
  await linked.close(); assert.equal(existsSync(linked.dir), false);
  const local = await piAgentDir({ home: root, models: { providers: { dispatch_local: {} } } });
  assert.ok(!lstatSync(join(local.dir, 'models.json')).isSymbolicLink()); assert.equal(existsSync(join(local.dir, 'mcp.json')), false);
  assert.equal(readFileSync(join(root, 'models.json'), 'utf8'), '{"providers":{}}');
  await local.close();
});

test('pi turns record the session, nested MCP tools with images, the summary and usage', async () => {
  const tools = [], browser = [], sessions = [], root = home();
  mkdirSync(join(root, 'sessions'));
  let seen, seenArgs;
  const result = await adapter(args => turn(args[args.indexOf('--session-id') + 1]), {}, (args, options) => { if (args[0] === '-p') { seen = options; seenArgs = args; } }, root)
    .run({ workspace: '/w', prompt: 'task', interactive: true, onQuestion: async () => ({}), onSession: id => sessions.push(id), onTool: item => tools.push(`${item.name}:${item.phase}`), onBrowser: item => browser.push([item.phase, item.images?.length ?? 0]) });
  assert.equal(result.outcome, 'completed', result.summary); assert.equal(result.summary, 'Done ✓'); assert.equal(sessions[0], result.sessionId);
  assert.deepEqual(result.usage, { input_tokens: 290, cached_input_tokens: 80, output_tokens: 20 });
  assert.deepEqual(tools, ['mcp__dispatch__dispatch_browser_navigate:started', 'mcp__dispatch__dispatch_browser_navigate:completed']);
  assert.deepEqual(browser, [['started', 0], ['completed', 1]]);
  assert.equal(seen.inheritEnv, false); assert.equal(seen.input, 'task');
  assert.equal(seen.env.PI_CODING_AGENT_SESSION_DIR, join(root, 'sessions')); assert.notEqual(seen.env.PI_CODING_AGENT_DIR, root);
  assert.equal(existsSync(seen.env.PI_CODING_AGENT_DIR), false);
  assert.ok(seenArgs.includes(result.sessionId));
});

for (const [name, events, result] of [
  ['an error stop', [{ type: 'session', id: session }, assistant([], 'error', { errorMessage: 'connection refused' }), { type: 'agent_end' }], {}],
  ['no agent end', turn(session).slice(0, -1), {}],
  ['a different session', turn('99999999-2222-4333-8444-555555555555'), {}],
  ['process failure', turn(session), { exitCode: 1 }],
  ['timeout', turn(session), { timedOut: true }],
]) test(`pi fails closed on ${name}`, async () => assert.equal((await adapter(events, result).run({ sessionId: session, prompt: 'x' })).outcome, 'failed'));

test('pi review turns carry no MCP server, and pi reports no sandbox', async () => {
  let bridged = false;
  const pi = adapter(turn(session)); pi.bridge = async () => { bridged = true; return { mcp: {}, close: async () => {} }; };
  assert.equal((await pi.run({ sessionId: session, prompt: 'x', readOnly: true, tools: { list: [{ name: 'dispatch_question' }], call: async () => ({}) } })).outcome, 'completed');
  assert.equal(bridged, false); assert.equal(pi.contract.sandbox, false); assert.equal(pi.contract.readOnlyTools, false);
  assert.match((await pi.capabilities()).detail, /Full access/);
  assert.deepEqual((await pi.models()).models.map(model => model.model), ['ollama/qwen3.6:latest', 'openai/gpt-4']);
});
