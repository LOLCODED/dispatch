import test from 'node:test';
import assert from 'node:assert/strict';
import { OpencodeAdapter, opencodeArgs, opencodeConfig, opencodeModels } from '../src/opencode.mjs';

const session = 'ses_f028e20b7ffei1h8y6eec39epc';
const encode = events => events.map(event => JSON.stringify(event)).join('\n') + '\n';
const step = (reason, tokens = { input: 100, output: 10, reasoning: 2, cache: { read: 40, write: 5 } }) => ({ type: 'step_finish', sessionID: session, part: { type: 'step-finish', reason, tokens } });
const tool = (name, status = 'completed') => ({ type: 'tool_use', sessionID: session, part: { type: 'tool', tool: name, callID: `call_${name}`, state: { status, input: { url: 'app:/' }, output: 'ok', error: 'boom' } } });
const done = [{ type: 'step_start', sessionID: session }, tool('dispatch_dispatch_browser_navigate'), step('tool-calls'), { type: 'text', sessionID: session, part: { type: 'text', text: 'Done ✓' } }, step('stop')];
function adapter(events, result = {}, inspect = () => {}) {
  return new OpencodeAdapter({ bridge: async () => ({ mcp: { command: 'node', args: ['mcp.mjs'], env: { DISPATCH_TOOL_TOKEN: 't' } }, close: async () => {} }), execute: async (command, args, options) => {
    inspect(args, options);
    if (args[0] === '--version') return { exitCode: 0, output: '1.18.4\n' };
    if (args[0] === 'models') return { exitCode: 0, output: 'opencode/big-pickle\nollama/qwen3.6:latest\n\nnot a model line\n' };
    options.onStdout?.(Buffer.from(encode(events)));
    return { exitCode: 0, output: '', ...result };
  } });
}

test('OpenCode args pass the prompt on stdin, resume by session and map effort to a variant', () => {
  assert.deepEqual(opencodeArgs({ execution: { model: 'ollama/qwen3.6:latest' } }), ['run', '--format', 'json', '--model', 'ollama/qwen3.6:latest']);
  assert.deepEqual(opencodeArgs({ sessionId: session, execution: { model: 'a/b', effort: 'high' }, images: ['/i.png'] }), ['run', '--format', 'json', '--session', session, '--model', 'a/b', '--variant', 'high', '--file', '/i.png']);
});

test('OpenCode config denies every mutating tool on review turns and adds the dispatch MCP server', () => {
  const bridge = { mcp: { command: 'node', args: ['mcp.mjs'], env: { A: '1' } } };
  assert.deepEqual(opencodeConfig({ readOnly: true }).permission, { edit: 'deny', bash: 'deny', webfetch: 'deny', external_directory: 'deny' });
  const owner = opencodeConfig({ bridge, extra: { provider: { x: {} } } });
  assert.equal(owner.permission.bash, 'allow'); assert.deepEqual(owner.mcp.dispatch.command, ['node', 'mcp.mjs']); assert.deepEqual(owner.mcp.dispatch.environment, { A: '1' });
  assert.deepEqual(owner.provider, { x: {} }); assert.equal(owner.share, 'disabled'); assert.equal(owner.autoupdate, false);
});

test('OpenCode models keep provider/model lines only', () => {
  assert.deepEqual(opencodeModels('opencode/big-pickle\nnot a model\n--flag/x\nollama/qwen3.6:latest').map(model => model.model), ['opencode/big-pickle', 'ollama/qwen3.6:latest']);
});

test('OpenCode turns record the session, tools, summary and usage, and run without the parent environment', async () => {
  const tools = [], browser = [], sessions = [];
  let seen;
  const result = await adapter(done, {}, (args, options) => { seen = options; }).run({ workspace: '/w', prompt: 'task', interactive: true, onQuestion: async () => ({}), onSession: id => sessions.push(id), onTool: item => tools.push(`${item.name}:${item.phase}`), onBrowser: item => browser.push(item.phase) });
  assert.equal(result.outcome, 'completed'); assert.equal(result.summary, 'Done ✓'); assert.equal(result.sessionId, session);
  assert.deepEqual(result.usage, { input_tokens: 290, cached_input_tokens: 80, output_tokens: 24 });
  assert.deepEqual(sessions, [session]); assert.deepEqual(tools, ['dispatch_dispatch_browser_navigate:started', 'dispatch_dispatch_browser_navigate:completed']); assert.deepEqual(browser, ['completed']);
  assert.equal(seen.inheritEnv, false); assert.equal(seen.input, 'task'); assert.equal(seen.cwd, '/w');
  assert.equal(JSON.parse(seen.env.OPENCODE_CONFIG_CONTENT).mcp.dispatch.environment.DISPATCH_TOOL_TOKEN, 't');
});

for (const [name, events, result] of [
  ['an error event', [...done, { type: 'error', sessionID: session, error: { name: 'UnknownError', data: { message: 'Unexpected server error.' } } }], {}],
  ['a turn that stops mid tool call', done.slice(0, 3), {}],
  ['no step finish', done.slice(0, 2), {}],
  ['process failure', done, { exitCode: 1 }],
  ['timeout', done, { timedOut: true }],
]) test(`OpenCode fails closed on ${name}`, async () => assert.equal((await adapter(events, result).run({ prompt: 'x' })).outcome, 'failed'));

test('OpenCode keeps blocked and cancelled outcomes, rejects a changed session, and reports no sandbox', async () => {
  assert.equal((await adapter([{ type: 'text', sessionID: session, part: { text: 'DISPATCH_BLOCKED: Which policy?' } }, step('stop')]).run({ prompt: 'x' })).outcome, 'blocked');
  assert.equal((await adapter([], { cancelled: true }).run({ prompt: 'x' })).outcome, 'cancelled');
  assert.equal((await adapter(done).run({ sessionId: 'ses_other', prompt: 'x' })).outcome, 'failed');
  assert.equal(adapter([]).contract.sandbox, false);
  const ready = await adapter([]).capabilities();
  assert.equal(ready.available && ready.authenticated, true); assert.match(ready.detail, /Full access/);
  assert.deepEqual((await adapter([]).models()).models.map(model => model.model), ['opencode/big-pickle', 'ollama/qwen3.6:latest']);
});
