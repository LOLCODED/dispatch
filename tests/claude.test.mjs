import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ClaudeAdapter, claudeArgs, claudeUsage } from '../src/claude.mjs';

const session = '11111111-2222-4333-8444-555555555555';
const encode = events => events.map(event => JSON.stringify(event)).join('\n') + '\n';
const init = { type: 'system', subtype: 'init', session_id: session, model: 'claude-test' };
const done = (result = 'Done ✓', extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, result, session_id: session, usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 20, output_tokens: 7 }, ...extra });
function adapter(output, result = {}, inspect = () => {}) {
  return new ClaudeAdapter({ execute: async (command, args, options) => {
    inspect(args, options);
    const created = args.includes('--session-id') ? args[args.indexOf('--session-id') + 1] : session;
    const bytes = Buffer.from(output.replaceAll(session, created)); for (let i = 0; i < bytes.length; i += 5) options.onStdout?.(bytes.subarray(i, i + 5));
    return { exitCode: 0, output: '', ...result };
  } });
}

test('Claude args keep owner turns in the sandbox and review turns away from mutating tools', () => {
  const auto = claudeArgs({ sessionId: session, execution: { model: 'opus', effort: 'high' }, mcpConfig: '/tmp/mcp.json', mcpTools: ['dispatch_question', 'dispatch_memory'] });
  assert.deepEqual(auto.slice(auto.indexOf('--session-id'), auto.indexOf('--session-id') + 2), ['--session-id', session]);
  assert.equal(auto[auto.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.equal(auto[auto.indexOf('--permission-prompts') + 1], 'none');
  assert.deepEqual(JSON.parse(auto[auto.indexOf('--settings') + 1]).sandbox, { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, failIfUnavailable: true });
  assert.ok(!auto.includes('Bash') && auto.includes('AskUserQuestion') && auto.includes('Agent'));
  assert.deepEqual(auto.slice(auto.indexOf('--model'), auto.indexOf('--model') + 4), ['--model', 'opus', '--effort', 'high']);
  assert.deepEqual(auto.slice(auto.indexOf('--allowedTools'), auto.indexOf('--allowedTools') + 4), ['--allowedTools', 'mcp__dispatch__dispatch_question', 'mcp__dispatch__dispatch_memory', '--mcp-config']);
  assert.ok(!auto.includes('--add-dir'));
  const granted = claudeArgs({ sessionId: session, mcpConfig: '/tmp/mcp.json', writableRoots: ['/home/me/code/todo-app'] });
  assert.deepEqual(JSON.parse(granted[granted.indexOf('--settings') + 1]).sandbox.filesystem, { allowWrite: ['/home/me/code/todo-app'] });
  assert.deepEqual(granted.slice(granted.indexOf('--add-dir'), granted.indexOf('--add-dir') + 2), ['--add-dir', '/home/me/code/todo-app']);
  assert.ok(!claudeArgs({ sessionId: session, readOnly: true, writableRoots: ['/home/me/code/todo-app'] }).includes('--add-dir'));
  const full = claudeArgs({ sessionId: session, mcpConfig: '/tmp/mcp.json', fullAccess: true, writableRoots: ['/home/me'] });
  assert.equal(full[full.indexOf('--permission-mode') + 1], 'bypassPermissions'); assert.ok(!full.includes('--settings') && !full.includes('--add-dir'));
  const fullReview = claudeArgs({ sessionId: session, readOnly: true, fullAccess: true });
  assert.equal(fullReview[fullReview.indexOf('--permission-mode') + 1], 'dontAsk');
  const review = claudeArgs({ sessionId: session, resume: true, readOnly: true });
  assert.equal(review[review.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.deepEqual(review.slice(review.indexOf('--resume'), review.indexOf('--resume') + 2), ['--resume', session]);
  for (const tool of ['Bash', 'Edit', 'Write', 'NotebookEdit']) assert.ok(review.indexOf(tool) > review.indexOf('--disallowedTools'));
  assert.ok(!review.includes('--settings') && !review.includes('mcp__dispatch__dispatch_question'));
});

test('Claude usage counts cache writes and reads as input and keeps missing fields unknown', () => {
  assert.deepEqual(claudeUsage({ input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 20, output_tokens: 7 }), { input_tokens: 35, cached_input_tokens: 20, output_tokens: 7 });
  assert.deepEqual(claudeUsage({ output_tokens: 3 }), { input_tokens: null, cached_input_tokens: 0, output_tokens: 3 });
  assert.equal(claudeUsage(undefined), null);
});

test('Claude stream reports session, progress, tools, browser images and provider usage', async () => {
  const events = [], progress = [], browser = [], sessions = [], limits = [];
  const stream = encode([init,
    { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 1790783400 } } } },
    { type: 'stream_event', event: { type: 'message_start' } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Thinking ✓' } } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Working' }, { type: 'tool_use', id: 't0', name: 'mcp__claude-in-chrome__computer', input: { action: 'left_click', coordinate: [40, 60] } }, { type: 'tool_use', id: 't1', name: 'mcp__playwright__browser_take_screenshot', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'captured' }] }] } },
    done('Finished', { permission_denials: [{ tool_name: 'WebFetch' }] })]);
  const result = await adapter(stream).run({ workspace: '/tmp', prompt: 'literal $(text)', onEvent: (kind, message) => events.push([kind, message]), onProgress: value => progress.push(value), onBrowser: value => browser.push(value), onSession: id => sessions.push(id), onLimits: value => limits.push(value) });
  assert.equal(result.outcome, 'completed'); assert.equal(result.summary, 'Finished');
  assert.deepEqual(limits.map(value => value.windows), [[{ label: '5-hour', usedPercent: 40, resetsAt: '2026-09-30T15:50:00.000Z' }]]); assert.match(result.sessionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(result.usage, { input_tokens: 35, cached_input_tokens: 20, output_tokens: 7 });
  assert.deepEqual(sessions, [result.sessionId]);
  assert.ok(progress.includes('Thinking ✓'));
  assert.deepEqual(browser.map(item => item.phase), ['started', 'started', 'completed']); assert.deepEqual(browser[0].pointer, { x: 40, y: 60, action: 'left_click' }); assert.equal(browser[1].pointer, null); assert.deepEqual(browser[2].images, [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }]);
  assert.ok(events.some(([kind, message]) => kind === 'tool' && message.includes('captured')));
  assert.ok(events.some(([kind, message]) => kind === 'tool' && message.includes('WebFetch')));
});

test('Claude resumes the exact session and fails closed on mismatches, errors and missing results', async () => {
  const resumed = await adapter(encode([init, done()]), {}, args => assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), ['--resume', session])).run({ sessionId: session, prompt: 'x', onSession: id => assert.equal(id, session) });
  assert.equal(resumed.outcome, 'completed'); assert.equal(resumed.sessionId, session);
  for (const [name, output, result] of [
    ['mismatched session', encode([{ ...init, session_id: 'other' }, done()]), {}],
    ['error result', encode([init, done('Failed', { is_error: true, subtype: 'error_during_execution' })]), {}],
    ['missing result', encode([init]), {}],
    ['malformed line', `${JSON.stringify(init)}\n{broken\n${JSON.stringify(done())}\n`, {}],
    ['non-zero exit', encode([init, done()]), { exitCode: 1 }],
    ['timeout', encode([init]), { timedOut: true }],
  ]) assert.equal((await adapter(output, result).run({ sessionId: session, prompt: 'x' })).outcome, 'failed', name);
  assert.equal((await adapter('', { cancelled: true, exitCode: null }).run({ sessionId: session, prompt: 'x' })).outcome, 'cancelled');
  assert.equal((await adapter(encode([init, done('DISPATCH_BLOCKED: Which policy?')])).run({ sessionId: session, prompt: 'x' })).outcome, 'blocked');
});

test('interactive Claude turns expose dispatch tools through a private MCP config removed after the turn', async () => {
  let config;
  const result = await adapter(encode([init, done()]), {}, (args, options) => {
    config = args[args.indexOf('--mcp-config') + 1];
    const value = JSON.parse(readFileSync(config, 'utf8'));
    assert.equal(value.mcpServers.dispatch.type, 'stdio'); assert.match(value.mcpServers.dispatch.env.DISPATCH_TOOL_TOKEN, /^[a-f0-9]{64}$/);
    assert.equal(options.env.ANTHROPIC_API_KEY, undefined); assert.equal(options.input, 'task');
  }).run({ sessionId: session, prompt: 'task', interactive: true, onQuestion: async () => ({ answers: {} }) });
  assert.equal(result.outcome, 'completed'); assert.equal(existsSync(config), false);
});

test('Claude plan usage runs the local /usage command and refuses anything that took a model turn', async () => {
  const calls = [];
  const reply = report => new ClaudeAdapter({ execute: async (command, args, options) => { calls.push([command, args, options]); return { exitCode: 0, output: JSON.stringify(report) }; } });
  const usage = await reply({ is_error: false, num_turns: 0, result: 'Current session: 7% used · resets 1pm' }).limits();
  assert.deepEqual(usage.windows.map(window => [window.label, window.usedPercent]), [['Current session', 7]]);
  assert.deepEqual(calls[0][1], ['-p', '/usage', '--output-format', 'json', '--no-session-persistence']); assert.equal(calls[0][2].inheritEnv, false);
  assert.equal(await reply({ is_error: false, num_turns: 1, result: 'Current session: 7% used' }).limits(), null);
  assert.equal(await reply({ is_error: true, num_turns: 0 }).limits(), null);
});

test('Claude progress is throttled to one update per interval and the completed block still lands', async () => {
  const progress = [], events = [];
  const stream = encode([init, { type: 'stream_event', event: { type: 'message_start' } },
    ...['One ', 'two ', 'three'].map(text => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })),
    { type: 'assistant', message: { content: [{ type: 'text', text: 'One two three' }] } }, done('Finished')]);
  await adapter(stream).run({ workspace: '/tmp', prompt: 'x', onEvent: (kind, message) => events.push([kind, message]), onProgress: value => progress.push(value) });
  assert.deepEqual(progress.filter(Boolean), ['One ']); assert.ok(events.some(([kind, message]) => kind === 'message' && message === 'One two three'));
});

test('Claude derives the MCP allow list from the supplied tools and reports tool ids on every turn kind', async () => {
  let seen;
  const stream = encode([init, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't9', name: 'Read', input: { file_path: 'a.js' } }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't9', content: 'contents' }] } }, done()]);
  const events = [];
  const worker = new ClaudeAdapter({ bridge: async ({ tools }) => ({ names: tools.map(tool => tool.name), mcp: { command: '/node', args: [], env: {} }, writeConfig: async () => '/tmp/claude-mcp.json', close: async () => {} }), execute: async (command, args, options) => { seen = args; const bytes = Buffer.from(stream.replaceAll(session, args[args.indexOf('--session-id') + 1])); options.onStdout?.(bytes); return { exitCode: 0, output: '' }; } });
  const result = await worker.run({ workspace: '/tmp', prompt: 'task', readOnly: true, tools: { list: [{ name: 'dispatch_browser_snapshot' }], call: async () => ({}) }, onTool: event => events.push(event) });
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(seen.slice(seen.indexOf('--allowedTools'), seen.indexOf('--allowedTools') + 5), ['--allowedTools', 'Read', 'Grep', 'Glob', 'mcp__dispatch__dispatch_browser_snapshot']);
  assert.deepEqual(events.map(event => [event.id, event.name, event.phase, event.output ?? event.input.file_path]), [['t9', 'Read', 'started', 'a.js'], ['t9', 'Read', 'completed', 'contents']]);
});
