import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from './process.mjs';
import { localEnvironment } from './local-tools.mjs';
import { openToolBridge } from './tool-bridge.mjs';
import { blockedOutcome, browserPointer, browserTool, runJsonLines } from './cli-stream.mjs';

const modelName = /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,199}$/;
const thinking = ['low', 'medium', 'high'].map(reasoningEffort => ({ reasoningEffort }));
const readTools = 'read,grep,find,ls';
const sharedFiles = ['auth.json', 'settings.json', 'models.json'];

export const piHome = (env = process.env) => env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');

// pi reads MCP servers and providers only from its config directory, so each turn gets a private one that links the
// operator's logins and settings and adds dispatch's server; the operator's ~/.pi is never written.
export async function piAgentDir({ home = piHome(), mcp = null, models = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dispatch-pi-'));
  try {
    for (const name of sharedFiles) if (!(models && name === 'models.json') && existsSync(join(home, name))) await symlink(join(home, name), join(dir, name));
    if (models) await writeFile(join(dir, 'models.json'), JSON.stringify(models), { mode: 0o600 });
    if (mcp) await writeFile(join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { dispatch: { command: mcp.command, args: mcp.args, env: mcp.env } } }), { mode: 0o600 });
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
  return { dir, close: () => rm(dir, { recursive: true, force: true }) };
}

export function piArgs({ sessionId, execution, readOnly = false, images = [] }) {
  const args = ['-p', '--mode', 'json', '--no-approve', '--offline', '--session-id', sessionId];
  if (execution?.model) args.push('--model', execution.model);
  if (execution?.effort) args.push('--thinking', execution.effort);
  if (readOnly) args.push('--tools', readTools);
  for (const path of images) args.push(`@${path}`);
  return args;
}

export function piModels(output) {
  return String(output ?? '').split('\n').slice(1).map(line => line.trim().split(/\s+/)).filter(columns => columns.length >= 5)
    .map(([provider, model, , , reasoning]) => ({ id: `${provider}/${model}`, reasoning: reasoning === 'yes' })).filter(entry => modelName.test(entry.id)).slice(0, 200)
    .map(entry => ({ model: entry.id, displayName: entry.id, isDefault: false, defaultReasoningEffort: null, supportedReasoningEfforts: entry.reasoning ? thinking : [] }));
}

const count = value => Number.isFinite(value) && value >= 0 ? value : 0;
const addUsage = (total, usage) => usage ? { input_tokens: total.input_tokens + count(usage.input) + count(usage.cacheRead) + count(usage.cacheWrite), cached_input_tokens: total.cached_input_tokens + count(usage.cacheRead), output_tokens: total.output_tokens + count(usage.output) } : total;
const resultText = result => (Array.isArray(result?.content) ? result.content : []).filter(part => part?.type === 'text').map(part => part.text).join('\n');

function toolEvent(event, { onEvent, onTool, onBrowser }) {
  const name = String(event.toolName ?? 'tool');
  if (event.type === 'tool_execution_start') {
    if (browserTool(name)) onBrowser?.({ phase: 'started', label: name, pointer: browserPointer(name, event.args) });
    onTool?.({ id: event.toolCallId, name, phase: 'started', input: event.args ?? {} });
    onEvent?.('tool', `${name} ${JSON.stringify(event.args ?? {}).slice(0, 1000)}`);
    return;
  }
  const content = Array.isArray(event.result?.content) ? event.result.content : [];
  if (browserTool(name)) onBrowser?.({ phase: 'completed', label: name, images: content.filter(part => part?.type === 'image' && part.data).slice(0, 4).map(part => ({ type: 'image', mimeType: part.mimeType, data: part.data })) });
  onTool?.({ id: event.toolCallId, name, phase: 'completed', output: resultText(event.result), isError: event.isError === true });
  onEvent?.('tool', `${name} · ${event.isError ? 'failed' : 'completed'}\n${resultText(event.result).slice(-4000)}`);
}

export function piStream({ sessionId, onEvent, onSession, onTool, onBrowser }) {
  const state = { session: null, mismatch: false, error: '', ended: false, summary: '', usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 } };
  const consume = event => {
    onEvent?.('raw', JSON.stringify(event));
    if (event.type === 'session') { if (event.id !== sessionId) { state.mismatch = true; return; } state.session = event.id; onSession?.(event.id); }
    if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') toolEvent(event, { onEvent, onTool, onBrowser });
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      const message = event.message, text = (Array.isArray(message.content) ? message.content : []).filter(part => part?.type === 'text').map(part => part.text).join('\n');
      state.usage = addUsage(state.usage, message.usage);
      if (message.stopReason === 'error' || message.stopReason === 'aborted') { state.error = String(message.errorMessage ?? `pi stopped: ${message.stopReason}`); onEvent?.('error', state.error); }
      if (text.trim()) { state.summary = text; onEvent?.('message', text); }
    }
    if (event.type === 'agent_end') state.ended = true;
  };
  return { state, consume };
}

export function piOutcome({ result, state, sessionId }) {
  const usage = state.ended ? state.usage : null;
  if (result.cancelled) return { outcome: 'cancelled', sessionId, summary: state.summary, usage };
  if (result.timedOut) return { outcome: 'failed', sessionId, summary: 'pi execution timed out.', usage };
  if (result.exitCode !== 0 || result.malformed || state.mismatch || state.error || !state.session || !state.ended) return { outcome: 'failed', sessionId, summary: `pi did not complete a valid turn. ${(state.error || result.output.slice(-2000)).slice(0, 2000)}`, usage };
  return { outcome: blockedOutcome(state.summary), sessionId, summary: state.summary, usage };
}

// pi has no OS sandbox, so dispatch starts owner turns only with full access; review turns get read-only tools and no MCP.
export class PiAdapter {
  constructor({ execute = runProcess, command = 'pi', bridge = openToolBridge, home = piHome } = {}) { this.execute = execute; this.command = command; this.bridge = bridge; this.home = home; }
  get contract() { return { questions: 'tool', tools: 'mcp', browserTools: 'mcp', sessions: true, modelSwitch: true, streaming: false, readOnlyTurns: true, readOnlyTools: false, writableRoots: false, sandbox: false }; }
  get commandOptions() { return { inheritEnv: false, env: localEnvironment({ PI_CODING_AGENT_DIR: this.home(), PI_OFFLINE: '1' }), timeoutMs: 30000 }; }
  async version() {
    const result = await this.execute(this.command, ['--version'], this.commandOptions);
    return result.exitCode === 0 ? `pi ${result.output.trim().slice(0, 40)}` : null;
  }
  async capabilities() {
    const version = await this.version();
    if (!version) return { available: false, authenticated: false, detail: 'Install pi, then refresh.' };
    return { available: true, authenticated: true, version, detail: 'Uses the models and logins set up in pi. It has no sandbox, so dispatch runs it only with Full access.' };
  }
  async models() {
    const result = await this.execute(this.command, ['--list-models'], this.commandOptions);
    const models = result.exitCode === 0 ? piModels(result.output) : [];
    return { available: models.length > 0, models, message: models.length ? 'Models reported by pi.' : 'pi did not list models. Set up a provider in pi, then refresh.' };
  }
  async run({ workspace, sessionId, prompt, images = [], signal, onEvent, onSession, onSpawn, timeoutMs = null, readOnly = false, interactive = false, execution, onQuestion, onMemory, tools, onTool, onBrowser, onProgress }, { models = null } = {}) {
    const id = sessionId ?? randomUUID();
    const handlers = readOnly ? null : tools?.list?.length ? { tools: tools.list, call: tools.call } : interactive ? { onQuestion, onMemory } : null;
    const bridge = handlers ? await this.bridge(handlers) : null;
    let agent = null;
    try {
      agent = await piAgentDir({ home: this.home(), mcp: bridge?.mcp, models });
      const env = localEnvironment({ PI_CODING_AGENT_DIR: agent.dir, PI_CODING_AGENT_SESSION_DIR: join(this.home(), 'sessions'), PI_OFFLINE: '1', PI_TELEMETRY: '0' });
      const stream = piStream({ sessionId: id, onEvent, onSession, onTool, onBrowser });
      const result = await runJsonLines(this.execute, this.command, piArgs({ sessionId: id, execution, readOnly, images }), { cwd: workspace, signal, timeoutMs, input: prompt, inheritEnv: false, env, onSpawn, onEvent: stream.consume });
      onProgress?.('');
      return piOutcome({ result, state: stream.state, sessionId: id });
    } finally { await agent?.close(); await bridge?.close(); }
  }
}
