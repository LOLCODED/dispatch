import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { codexMcpArgs, openToolBridge } from '../src/tool-bridge.mjs';
import { toolSet } from '../src/dispatch-tools.mjs';

function mcpClient({ command, args, env }) {
  const child = spawn(command, args, { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map(); let id = 0;
  createInterface({ input: child.stdout }).on('line', line => { const message = JSON.parse(line); waiting.get(message.id)?.(message); });
  const request = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return { request, close: () => child.kill() };
}

test('MCP server forwards questions through the private bridge and normalizes them', async t => {
  const calls = [];
  const bridge = await openToolBridge({
    onQuestion: async questions => { calls.push(questions); if (questions[0].question === 'Fail?') throw new Error('Run stopped'); return { answers: { 'question-1': { answers: ['Small'] } } }; },
  });
  const client = mcpClient(bridge.mcp);
  t.after(async () => { client.close(); await bridge.close(); });
  assert.equal(statSync(dirname(bridge.mcp.env.DISPATCH_TOOL_SOCKET)).mode & 0o077, 0);
  const initialized = await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(initialized.result.serverInfo.name, 'dispatch');
  assert.deepEqual((await client.request('tools/list', {})).result.tools.map(tool => tool.name), ['dispatch_question', 'dispatch_memory']);
  const answered = await client.request('tools/call', { name: 'dispatch_question', arguments: { questions: [{ question: 'Which scope?', options: [{ label: 'Small' }] }] } });
  assert.deepEqual(JSON.parse(answered.result.content[0].text), { 'question-1': 'Small' }); assert.equal(answered.result.isError, false);
  assert.deepEqual(calls[0], [{ id: 'question-1', header: undefined, question: 'Which scope?', options: [{ label: 'Small', description: '' }] }]);
  const failed = await client.request('tools/call', { name: 'dispatch_question', arguments: { questions: [{ question: 'Fail?' }] } });
  assert.equal(failed.result.isError, true); assert.match(failed.result.content[0].text, /Run stopped/);
  for (const name of ['dispatch_workspace', 'shell']) assert.equal((await client.request('tools/call', { name, arguments: {} })).error.code, -32602);
});

test('bridge rejects callers without the per-turn token and removes its directory on close', async () => {
  let invoked = false;
  const bridge = await openToolBridge({ onQuestion: async () => { invoked = true; return { answers: {} }; } });
  const path = bridge.mcp.env.DISPATCH_TOOL_SOCKET;
  const reply = await new Promise(resolve => {
    let data = ''; const socket = net.createConnection(path, () => socket.write(JSON.stringify({ token: 'wrong', name: 'dispatch_question', arguments: { questions: [] } }) + '\n'));
    socket.on('data', chunk => { data += chunk; }); socket.on('close', () => resolve(data)); socket.on('error', () => {});
  });
  assert.equal(reply, ''); assert.equal(invoked, false);
  await bridge.close(); assert.equal(existsSync(dirname(path)), false);
});

test('MCP exposes the workspace tool only when the turn supplies a workspace handler', async t => {
  const bridge = await openToolBridge({ onQuestion: async () => ({ answers: {} }) });
  const client = mcpClient(bridge.mcp);
  t.after(async () => { client.close(); await bridge.close(); });
  assert.deepEqual((await client.request('tools/list', {})).result.tools.map(tool => tool.name), ['dispatch_question', 'dispatch_memory']);
  assert.equal((await client.request('tools/call', { name: 'dispatch_request_access', arguments: { path: '~/code/app', reason: 'New app' } })).error.code, -32602);
  assert.equal((await client.request('tools/call', { name: 'dispatch_workspace', arguments: { operation: 'read' } })).error.code, -32602);
});

test('a tool-agnostic bridge advertises only the supplied tools, forwards MCP content, and renders Codex overrides', async t => {
  const calls = [];
  const tools = toolSet({ memory: true, browser: true });
  const bridge = await openToolBridge({ tools, call: async (name, args) => { calls.push([name, args]); return name === 'dispatch_browser_screenshot' ? { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }], isError: false } : { content: [{ type: 'text', text: JSON.stringify({ ok: name }) }], isError: name === 'dispatch_browser_click' }; } });
  const client = mcpClient(bridge.mcp);
  t.after(async () => { client.close(); await bridge.close(); });
  assert.deepEqual(bridge.names, tools.map(tool => tool.name)); assert.equal(bridge.mcp.env.DISPATCH_TOOL_NAMES, bridge.names.join(','));
  assert.deepEqual((await client.request('tools/list', {})).result.tools.map(tool => tool.name), bridge.names);
  const listed = await client.request('tools/call', { name: 'dispatch_memory', arguments: { action: 'list' } });
  assert.deepEqual(JSON.parse(listed.result.content[0].text), { ok: 'dispatch_memory' }); assert.equal(listed.result.isError, false);
  const image = await client.request('tools/call', { name: 'dispatch_browser_screenshot', arguments: {} });
  assert.deepEqual(image.result.content, [{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }]);
  assert.equal((await client.request('tools/call', { name: 'dispatch_browser_click', arguments: { ref: 'e1' } })).result.isError, true);
  assert.equal((await client.request('tools/call', { name: 'dispatch_question', arguments: {} })).error.code, -32602);
  assert.deepEqual(calls.map(([name]) => name), ['dispatch_memory', 'dispatch_browser_screenshot', 'dispatch_browser_click']);
  const args = codexMcpArgs({ mcp: { command: '/usr/bin/no"de', args: ['/tmp/a b/mcp-server.mjs'], env: { DISPATCH_TOOL_SOCKET: '/tmp/x\\y.sock', DISPATCH_TOOL_TOKEN: 'tok', DISPATCH_TOOL_NAMES: 'dispatch_memory' } } });
  assert.deepEqual(args, ['-c', 'mcp_servers.dispatch.command="/usr/bin/no\\"de"', '-c', 'mcp_servers.dispatch.args=["/tmp/a b/mcp-server.mjs"]', '-c', 'mcp_servers.dispatch.env={DISPATCH_TOOL_SOCKET="/tmp/x\\\\y.sock",DISPATCH_TOOL_TOKEN="tok",DISPATCH_TOOL_NAMES="dispatch_memory"}', '-c', 'mcp_servers.dispatch.tool_timeout_sec=600', '-c', 'mcp_servers.dispatch.default_tools_approval_mode="approve"']);
});

test('the MCP server advertises connector tools from the schemas the bridge wrote for this turn', async t => {
  const tools = [{ name: 'box_list', kind: 'connector', description: 'List things.', inputSchema: { type: 'object', properties: { all: { type: 'boolean' } } } }];
  const bridge = await openToolBridge({ tools, call: async (name, args) => ({ content: [{ type: 'text', text: JSON.stringify({ name, args }) }], isError: false }) });
  const client = mcpClient(bridge.mcp);
  t.after(async () => { client.close(); await bridge.close(); });
  assert.equal(statSync(bridge.mcp.env.DISPATCH_TOOL_SCHEMAS).mode & 0o077, 0);
  assert.deepEqual((await client.request('tools/list', {})).result.tools, [{ name: 'box_list', description: 'List things.', inputSchema: tools[0].inputSchema }]);
  assert.deepEqual(JSON.parse((await client.request('tools/call', { name: 'box_list', arguments: { all: true } })).result.content[0].text), { name: 'box_list', args: { all: true } });
});
