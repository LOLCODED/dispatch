import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexAdapter } from '../src/codex.mjs';
const events = [ { type: 'thread.started', thread_id: 'session-1' }, { type: 'item.completed', item: { type: 'agent_message', text: 'Done ✓' } }, { type: 'turn.completed', usage: { input_tokens: 8, cached_input_tokens: 3, output_tokens: 4 } } ];
function adapter(lines, result = {}, inspect = () => {}) {
  return new CodexAdapter({ execute: async (command, args, options) => {
    inspect(args, options); const bytes = Buffer.from(lines);
    for (let i = 0; i < bytes.length; i += 7) options.onStdout(bytes.subarray(i, i + 7));
    return { exitCode: 0, output: '', ...result };
  } });
}
const encode = items => items.map(x => JSON.stringify(x)).join('\n');
test('Codex parses fragmented UTF-8 events, records usage and uses explicit session resume', async () => {
  const worker = adapter(encode(events), {}, (args, options) => { assert.deepEqual(args.slice(0, 3), ['exec', 'resume', 'session-1']); assert.ok(!args.includes('--last')); assert.ok(!args.includes('--color')); assert.equal(options.inheritEnv, false); assert.equal(options.input, 'task'); });
  const result = await worker.run({ workspace: '/tmp', sessionId: 'session-1', prompt: 'task' });
  assert.equal(result.outcome, 'completed'); assert.equal(result.summary, 'Done ✓'); assert.equal(result.usage, null); assert.equal(result.cumulativeUsage.input_tokens, 8);
});
for (const [name, lines, result] of [
  ['no terminal event', encode(events.slice(0, 2)), {}], ['malformed JSON', encode(events) + '\n{broken', {}], ['failed turn', encode([...events, { type: 'turn.failed' }]), {}], ['process failure', encode(events), { exitCode: 1 }], ['timeout', encode(events), { timedOut: true }], ['wrong session', encode([{ type: 'thread.started', thread_id: 'other' }, events[2]]), {}]
]) test(`Codex fails closed on ${name}`, async () => assert.equal((await adapter(lines, result).run({ sessionId: 'session-1', prompt: 'task' })).outcome, 'failed'));
test('Codex preserves blocked and cancelled outcomes', async () => {
  assert.equal((await adapter(encode([events[0], { type: 'item.completed', item: { type: 'agent_message', text: 'DISPATCH_BLOCKED: Which policy?' } }, events[2]])).run({})).outcome, 'blocked');
  assert.equal((await adapter('', { cancelled: true }).run({})).outcome, 'cancelled');
});
test('Codex tolerates unknown events without inventing usage', async () => {
  const result = await adapter(encode([events[0], { type: 'new.provider.event' }, { type: 'turn.completed' }])).run({});
  assert.equal(result.outcome, 'completed'); assert.equal(result.usage, null);
});

test('selected model and reasoning reach both new and resumed CLI turns', async () => {
  for (const sessionId of [undefined, 'session-1']) {
    const result = await adapter(encode(events), {}, args => {
      assert.equal(args[args.indexOf('--model') + 1], 'test-sol');
      assert.ok(args.includes('model_reasoning_effort="high"'));
      assert.ok(args.includes('approval_policy="never"'));
      assert.ok(args.includes('features.multi_agent=false'));
    }).run({ sessionId, execution: { model: 'test-sol', effort: 'high' } });
    assert.equal(result.outcome, 'completed');
  }
});

test('retains bounded command output, browser tool results and file activity for conversation history', async () => {
  const recorded = [];
  const items = [
    { type: 'item.completed', item: { type: 'command_execution', command: 'npm run test:e2e', exit_code: 0, aggregated_output: 'x'.repeat(8000) + '\n3 browser tests passed' } },
    { type: 'item.completed', item: { type: 'mcp_tool_call', server: 'playwright', tool: 'browser_snapshot', status: 'completed', result: { content: [{ type: 'text', text: 'Button visible' }] } } },
    { type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'app.js', kind: 'update' }] } },
  ];
  const result = await adapter(encode([events[0], ...items, events[2]])).run({ onEvent: (kind, message) => { if (kind !== 'raw') recorded.push({ kind, message }); } });
  assert.equal(result.outcome, 'completed');
  assert.match(recorded[0].message, /npm run test:e2e · exit 0/);
  assert.match(recorded[0].message, /3 browser tests passed/);
  assert.ok(recorded[0].message.length < 5100);
  assert.match(recorded[1].message, /playwright\/browser_snapshot.*completed/);
  assert.match(recorded[1].message, /Button visible/);
  assert.equal(recorded[2].kind, 'files');
});

test('review turns request read-only sandbox without resuming the implementation session', async () => {
  const reviewer = adapter(encode(events), {}, args => {
    assert.ok(args.includes('sandbox_mode="read-only"')); assert.ok(!args.includes('sandbox_mode="workspace-write"')); assert.ok(!args.includes('resume'));
  });
  assert.equal((await reviewer.run({ prompt: 'Review', readOnly: true })).outcome, 'completed');
});

test('codex exec reports thread totals as cumulative and per-turn usage only for a new session', async () => {
  const fresh = await adapter(encode(events)).run({ prompt: 'task' });
  assert.equal(fresh.usage.input_tokens, 8); assert.equal(fresh.cumulativeUsage.input_tokens, 8);
  const resumed = await adapter(encode(events)).run({ sessionId: 'session-1', prompt: 'task' });
  assert.equal(resumed.usage, null); assert.equal(resumed.cumulativeUsage.output_tokens, 4);
});
test('Codex attaches the dispatch MCP server through config overrides only when tools are supplied, and reports tool ids', async () => {
  let seenArgs;
  const items = [
    { type: 'item.started', item: { id: 'cmd-1', type: 'command_execution', command: 'ls' } },
    { type: 'item.completed', item: { id: 'cmd-1', type: 'command_execution', command: 'ls', exit_code: 0, aggregated_output: 'value.txt' } },
    { type: 'item.started', item: { id: 'mcp-1', type: 'mcp_tool_call', server: 'dispatch', tool: 'dispatch_memory', arguments: { action: 'list' } } },
    { type: 'item.completed', item: { id: 'mcp-1', type: 'mcp_tool_call', server: 'dispatch', tool: 'dispatch_memory', status: 'completed', result: { content: [{ type: 'text', text: '{}' }] } } },
  ];
  const tools = [];
  const bridge = async () => ({ names: ['dispatch_memory'], mcp: { command: '/node', args: ['/mcp.mjs'], env: { DISPATCH_TOOL_SOCKET: '/s', DISPATCH_TOOL_TOKEN: 't', DISPATCH_TOOL_NAMES: 'dispatch_memory' } }, close: async () => { tools.push('closed'); } });
  const worker = new CodexAdapter({ bridge, execute: async (command, args, options) => { seenArgs = args; const bytes = Buffer.from(encode([events[0], ...items, events[2]])); options.onStdout(bytes); return { exitCode: 0, output: '' }; } });
  const result = await worker.run({ workspace: '/tmp', prompt: 'task', tools: { list: [{ name: 'dispatch_memory' }], call: async () => ({}) }, onTool: event => tools.push(event) });
  assert.equal(result.outcome, 'completed');
  assert.ok(seenArgs.includes('mcp_servers.dispatch.command="/node"') && seenArgs.includes('mcp_servers.dispatch.tool_timeout_sec=600'));
  assert.deepEqual(tools.filter(item => typeof item === 'object').map(item => [item.id, item.name, item.phase]), [['cmd-1', 'command', 'started'], ['cmd-1', 'command', 'completed'], ['mcp-1', 'dispatch_memory', 'started'], ['mcp-1', 'dispatch_memory', 'completed']]);
  assert.equal(tools.at(-1), 'closed');
  const plain = adapter(encode(events), {}, args => { assert.ok(!args.some(arg => /mcp_servers/.test(arg))); });
  assert.equal((await plain.run({ workspace: '/tmp', prompt: 'task' })).outcome, 'completed');
});
