import { runProcess } from './process.mjs';
import { localEnvironment } from './local-tools.mjs';
import { openToolBridge } from './tool-bridge.mjs';
import { blockedOutcome, browserTool, runJsonLines } from './cli-stream.mjs';

const modelName = /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,199}$/;
const allow = { edit: 'allow', bash: 'allow', webfetch: 'allow', external_directory: 'allow' };
const deny = { edit: 'deny', bash: 'deny', webfetch: 'deny', external_directory: 'deny' };
// Questions wait for the operator; OpenCode's own MCP timeout would fail them first.
const unboundedToolTimeoutMs = 2 ** 31 - 1;

export function opencodeConfig({ readOnly = false, bridge = null, extra = {} } = {}) {
  const mcp = bridge ? { dispatch: { type: 'local', command: [bridge.mcp.command, ...bridge.mcp.args], environment: bridge.mcp.env, enabled: true, timeout: unboundedToolTimeoutMs } } : undefined;
  return { autoupdate: false, share: 'disabled', permission: readOnly ? deny : allow, ...(mcp ? { mcp } : {}), ...extra };
}

export function opencodeArgs({ sessionId, execution, images = [] }) {
  const args = ['run', '--format', 'json'];
  if (sessionId) args.push('--session', sessionId);
  if (execution?.model) args.push('--model', execution.model);
  if (execution?.effort) args.push('--variant', execution.effort);
  for (const path of images) args.push('--file', path);
  return args;
}

export function opencodeModels(output) {
  return [...new Set(String(output ?? '').split('\n').map(line => line.trim()).filter(line => modelName.test(line) && line.includes('/')))].slice(0, 200)
    .map(model => ({ model, displayName: model, isDefault: false, defaultReasoningEffort: null, supportedReasoningEfforts: [] }));
}

const count = value => Number.isFinite(value) && value >= 0 ? value : 0;
function addTokens(total, tokens) {
  if (!tokens) return total;
  const read = count(tokens.cache?.read), written = count(tokens.cache?.write);
  return { input_tokens: total.input_tokens + count(tokens.input) + read + written, cached_input_tokens: total.cached_input_tokens + read, output_tokens: total.output_tokens + count(tokens.output) + count(tokens.reasoning) };
}

function toolPart(part, { onEvent, onTool, onBrowser }) {
  const state = part.state ?? {}, name = String(part.tool ?? 'tool'), failed = state.status === 'error';
  const output = String(failed ? state.error ?? '' : state.output ?? '');
  onTool?.({ id: part.callID, name, phase: 'started', input: state.input ?? {} });
  onTool?.({ id: part.callID, name, phase: 'completed', output, isError: failed });
  if (browserTool(name)) onBrowser?.({ phase: 'completed', label: name, images: [] });
  onEvent?.('tool', `${name} · ${failed ? 'failed' : 'completed'} ${JSON.stringify(state.input ?? {}).slice(0, 1000)}\n${output.slice(-4000)}`);
}

export function opencodeStream({ sessionId, onEvent, onSession, onTool, onBrowser }) {
  const state = { session: sessionId ?? null, mismatch: false, error: '', reason: null, summary: '', usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 } };
  const consume = event => {
    onEvent?.('raw', JSON.stringify(event));
    if (typeof event.sessionID === 'string' && !state.session) { state.session = event.sessionID; onSession?.(event.sessionID); }
    else if (typeof event.sessionID === 'string' && event.sessionID !== state.session) state.mismatch = true;
    if (event.type === 'error') { state.error = String(event.error?.data?.message ?? event.error?.name ?? 'OpenCode reported an error.'); onEvent?.('error', state.error); }
    if (event.type === 'text' && event.part?.text?.trim()) { state.summary = event.part.text; onEvent?.('message', event.part.text); }
    if (event.type === 'tool_use' && event.part) toolPart(event.part, { onEvent, onTool, onBrowser });
    if (event.type === 'step_finish') { state.reason = event.part?.reason ?? null; state.usage = addTokens(state.usage, event.part?.tokens); }
  };
  return { state, consume };
}

export function opencodeOutcome({ result, state, sessionId }) {
  const usage = state.reason ? state.usage : null, session = state.session ?? sessionId;
  if (result.cancelled) return { outcome: 'cancelled', sessionId: session, summary: state.summary, usage };
  if (result.timedOut) return { outcome: 'failed', sessionId: session, summary: 'OpenCode execution timed out.', usage };
  if (result.exitCode !== 0 || result.malformed || state.mismatch || state.error || !state.session || !state.reason || state.reason === 'tool-calls') {
    return { outcome: 'failed', sessionId: session, summary: `OpenCode did not complete a valid turn. ${(state.error || result.output.slice(-2000)).slice(0, 2000)}`, usage };
  }
  return { outcome: blockedOutcome(state.summary), sessionId: session, summary: state.summary, usage };
}

// OpenCode has no OS sandbox, so dispatch starts owner turns only with full access; review turns deny every mutating tool.
export class OpencodeAdapter {
  constructor({ execute = runProcess, command = 'opencode', bridge = openToolBridge } = {}) { this.execute = execute; this.command = command; this.bridge = bridge; }
  get contract() { return { questions: 'tool', tools: 'mcp', browserTools: 'mcp', sessions: true, modelSwitch: true, streaming: false, readOnlyTurns: true, readOnlyTools: true, writableRoots: false, sandbox: false }; }
  get commandOptions() { return { inheritEnv: false, env: localEnvironment(), timeoutMs: 30000 }; }
  async version() {
    const result = await this.execute(this.command, ['--version'], this.commandOptions);
    return result.exitCode === 0 ? `OpenCode ${result.output.trim().slice(0, 40)}` : null;
  }
  async capabilities() {
    const version = await this.version();
    if (!version) return { available: false, authenticated: false, detail: 'Install OpenCode (opencode), then refresh.' };
    return { available: true, authenticated: true, version, detail: 'Uses the models and logins set up in OpenCode. It has no sandbox, so dispatch runs it only with Full access.' };
  }
  async models() {
    const result = await this.execute(this.command, ['models'], this.commandOptions);
    const models = result.exitCode === 0 ? opencodeModels(result.output) : [];
    return { available: models.length > 0, models, message: models.length ? 'Models reported by OpenCode.' : 'OpenCode did not list models. Set up a provider in OpenCode, then refresh.' };
  }
  async run({ workspace, sessionId, prompt, images = [], signal, onEvent, onSession, onSpawn, timeoutMs = null, readOnly = false, interactive = false, execution, onQuestion, onMemory, tools, onTool, onBrowser, onProgress }, extraConfig = {}) {
    const handlers = tools?.list?.length ? { tools: tools.list, call: tools.call } : interactive && !readOnly ? { onQuestion, onMemory } : null;
    const bridge = handlers ? await this.bridge(handlers) : null;
    try {
      const env = localEnvironment({ OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig({ readOnly, bridge, extra: extraConfig })) });
      const stream = opencodeStream({ sessionId, onEvent, onSession, onTool, onBrowser });
      const result = await runJsonLines(this.execute, this.command, opencodeArgs({ sessionId, execution, images }), { cwd: workspace, signal, timeoutMs, input: prompt, inheritEnv: false, env, onSpawn, onEvent: stream.consume });
      onProgress?.('');
      return opencodeOutcome({ result, state: stream.state, sessionId });
    } finally { await bridge?.close(); }
  }
}
