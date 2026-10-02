import net from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeQuestions, bridgeTools, toolNames } from './dispatch-tools.mjs';

const mcpServer = fileURLToPath(new URL('./mcp-server.mjs', import.meta.url));
const maxRequestBytes = 1_000_000, maxActive = 4, maxResponseBytes = 4_000_000;
const text = value => [{ type: 'text', text: JSON.stringify(value).slice(0, 24000) }];

async function legacy(request, { onQuestion, onMemory }) {
  if (request.name === 'dispatch_question') {
    if (!onQuestion) throw new Error('Questions are unavailable for this turn.');
    const { answers } = await onQuestion(bridgeQuestions(request.arguments?.questions));
    return Object.fromEntries(Object.entries(answers ?? {}).map(([id, value]) => [id, value?.answers?.[0] ?? null]));
  }
  if (request.name === 'dispatch_memory') {
    if (!onMemory) throw new Error('Memory is unavailable for this turn.');
    return onMemory(request.arguments ?? {});
  }
  throw new Error('Unknown dispatch tool.');
}
async function answer(request, handlers) {
  if (handlers.call) {
    if (!handlers.tools.some(tool => tool.name === request.name)) throw new Error('Unknown dispatch tool.');
    const result = await handlers.call(request.name, request.arguments ?? {});
    return { ok: result.isError !== true, content: result.content };
  }
  return { ok: true, content: text(await legacy(request, handlers)) };
}

function serve(socket, token, handlers, state) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('error', () => {});
  socket.on('data', async chunk => {
    buffer += chunk;
    if (buffer.length > maxRequestBytes) { socket.destroy(); return; }
    const newline = buffer.indexOf('\n'); if (newline < 0) return;
    socket.pause();
    let request; try { request = JSON.parse(buffer.slice(0, newline)); } catch { socket.destroy(); return; }
    const presented = Buffer.from(String(request.token ?? ''));
    if (presented.length !== token.length || !timingSafeEqual(presented, token)) { socket.destroy(); return; }
    if (state.active >= maxActive) { socket.end(JSON.stringify({ ok: false, content: text({ error: 'Too many pending dispatch tool calls.' }) }) + '\n'); return; }
    state.active++;
    try { socket.end(JSON.stringify(await answer(request, handlers)).slice(0, maxResponseBytes) + '\n'); }
    catch (error) { socket.end(JSON.stringify({ ok: false, content: text({ error: String(error.message).slice(0, 2000) }) }) + '\n'); }
    finally { state.active--; }
  });
}

const toml = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
// Codex reads MCP servers from config overrides; the default 60 s tool timeout would cut long waits short.
// Under approval policy "never" Codex rejects MCP calls unless the server's tools are pre-approved (verified on 0.159.0).
export function codexMcpArgs(bridge, { name = 'dispatch', timeoutSeconds = 600 } = {}) {
  const env = Object.entries(bridge.mcp.env).map(([key, value]) => `${key}=${toml(value)}`).join(',');
  return ['-c', `mcp_servers.${name}.command=${toml(bridge.mcp.command)}`, '-c', `mcp_servers.${name}.args=[${bridge.mcp.args.map(toml).join(',')}]`, '-c', `mcp_servers.${name}.env={${env}}`, '-c', `mcp_servers.${name}.tool_timeout_sec=${timeoutSeconds}`, '-c', `mcp_servers.${name}.default_tools_approval_mode="approve"`];
}

// Per-turn local socket in a private temp directory. A random token keeps other
// local processes from putting questions to the operator.
export async function openToolBridge(handlers) {
  const dir = await mkdtemp(join(tmpdir(), 'dispatch-tools-'));
  const socketPath = join(dir, 'tools.sock'), token = randomBytes(32).toString('hex'), state = { active: 0 };
  const names = toolNames(handlers.tools ?? bridgeTools), sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); serve(socket, Buffer.from(token), handlers, state); });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); }); }
  catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
  return {
    names,
    mcp: { command: process.execPath, args: [mcpServer], env: { DISPATCH_TOOL_SOCKET: socketPath, DISPATCH_TOOL_TOKEN: token, DISPATCH_TOOL_NAMES: names.join(',') } },
    async writeConfig(name, value) { const path = join(dir, name); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, JSON.stringify(value), { mode: 0o600 }); return path; },
    async close() { const closed = new Promise(resolve => server.close(resolve)); for (const socket of sockets) socket.destroy(); await closed; await rm(dir, { recursive: true, force: true }); },
  };
}
