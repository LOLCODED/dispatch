import net from 'node:net';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { bridgeTools, toolsByName } from './dispatch-tools.mjs';

const socketPath = process.env.DISPATCH_TOOL_SOCKET, token = process.env.DISPATCH_TOOL_TOKEN;
// Connector tools are not in the static registry, so the bridge hands over every schema the turn advertises.
const advertised = process.env.DISPATCH_TOOL_SCHEMAS ? JSON.parse(readFileSync(process.env.DISPATCH_TOOL_SCHEMAS, 'utf8')) : process.env.DISPATCH_TOOL_NAMES ? toolsByName(process.env.DISPATCH_TOOL_NAMES.split(',')) : bridgeTools;
const tools = advertised.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const unavailable = { ok: false, content: [{ type: 'text', text: JSON.stringify({ error: 'dispatch is unavailable for this turn.' }) }] };

function callDispatch(name, args) {
  return new Promise(resolve => {
    let response = '';
    const socket = net.createConnection(socketPath, () => socket.write(JSON.stringify({ token, name, arguments: args }) + '\n'));
    socket.setEncoding('utf8');
    socket.on('data', chunk => { response += chunk; if (response.length > 5_000_000) socket.destroy(); });
    socket.on('error', () => {});
    socket.on('close', () => {
      try { const value = JSON.parse(response); resolve({ ok: value.ok === true, content: Array.isArray(value.content) ? value.content : [{ type: 'text', text: String(value.text ?? '') }] }); }
      catch { resolve(unavailable); }
    });
  });
}

async function handle(message) {
  if (message.id === undefined) return;
  if (message.method === 'initialize') return send({ id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dispatch', version: '1.1.0' } } });
  if (message.method === 'ping') return send({ id: message.id, result: {} });
  if (message.method === 'tools/list') return send({ id: message.id, result: { tools } });
  if (message.method === 'tools/call') {
    if (!tools.some(tool => tool.name === message.params?.name)) return send({ id: message.id, error: { code: -32602, message: 'Unknown tool.' } });
    const { ok, content } = await callDispatch(message.params.name, message.params.arguments ?? {});
    return send({ id: message.id, result: { content, isError: !ok } });
  }
  send({ id: message.id, error: { code: -32601, message: 'Method not found.' } });
}

if (socketPath && token) {
  createInterface({ input: process.stdin }).on('line', line => { let message; try { message = JSON.parse(line); } catch { return; } handle(message).catch(() => {}); });
  process.stdin.on('end', () => process.exit(0));
}
