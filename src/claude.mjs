import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess } from './process.mjs';
import { cliProblem, localEnvironment } from './local-tools.mjs';
import { openToolBridge } from './tool-bridge.mjs';
import { blockedOutcome, browserPointer, browserTool, runJsonLines } from './cli-stream.mjs';
import { claudeLimits, claudeUsageText } from './provider-limits.mjs';
import { permissionTool } from './dispatch-tools.mjs';

const efforts = ['low', 'medium', 'high', 'xhigh', 'max'].map(reasoningEffort => ({ reasoningEffort }));
// Claude Code resolves these documented aliases to the newest model the account can use.
const aliases = [['fable', 'Fable', efforts], ['opus', 'Opus', efforts], ['sonnet', 'Sonnet', efforts], ['haiku', 'Haiku', []]];
// A dispatch_question call waits for the user; larger values overflow Node timers and fire at once.
const unboundedToolTimeoutMs = 2 ** 31 - 1;
const mutating = ['Bash', 'Edit', 'Write', 'NotebookEdit'];
const excluded = ['AskUserQuestion', 'Agent', 'Task', 'WebFetch', 'WebSearch'];
const sandboxNetwork = network => network?.hosts?.length || network?.localPorts ? { network: { ...(network.hosts?.length ? { allowedDomains: network.hosts } : {}), ...(network.localPorts ? { allowLocalBinding: true } : {}) } } : {};
const sandbox = (writableRoots, network) => ({ sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, failIfUnavailable: true, ...(writableRoots.length ? { filesystem: { allowWrite: writableRoots } } : {}), ...sandboxNetwork(network) } });

// Owner turns write through Claude's OS sandbox unless the operator chose full access. Prompts go to dispatch's
// permission tool when the turn has it (it approves sandboxed shell commands and file writes in the worktrees) and are refused otherwise.
// Review turns cannot call mutating tools.
export function claudeArgs({ sessionId, resume, execution, readOnly = false, mcpConfig, mcpTools = [], writableRoots = [], readableRoots = [], fullAccess = false, streamInput = false, network = null }) {
  const prompts = mcpConfig && !readOnly && mcpTools.includes(permissionTool.name) ? ['host', '--permission-prompt-tool', `mcp__dispatch__${permissionTool.name}`] : ['none'];
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompts', ...prompts];
  if (streamInput) args.push('--input-format', 'stream-json');
  args.push(...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]));
  if (execution?.model) args.push('--model', execution.model);
  if (execution?.effort) args.push('--effort', execution.effort);
  const allowed = [...(readOnly ? ['Read', 'Grep', 'Glob'] : []), ...(mcpConfig ? mcpTools.map(name => `mcp__dispatch__${name}`) : [])];
  const sandboxed = !readOnly && !fullAccess;
  args.push('--permission-mode', readOnly ? 'dontAsk' : fullAccess ? 'bypassPermissions' : 'acceptEdits', '--disallowedTools', ...excluded, ...(readOnly ? mutating : []));
  if (sandboxed) args.push('--settings', JSON.stringify(sandbox(writableRoots, readOnly ? null : network)));
  if (sandboxed && writableRoots.length) args.push('--add-dir', ...writableRoots);
  if (readOnly && readableRoots.length) args.push('--add-dir', ...readableRoots);
  if (allowed.length) args.push('--allowedTools', ...allowed);
  if (mcpConfig) args.push('--mcp-config', mcpConfig);
  return args;
}

export function claudeInput(prompt, images = [], read = readFileSync) {
  if (!images.length) return prompt;
  const blocks = images.map(path => ({ type: 'image', source: { type: 'base64', media_type: extname(path).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg', data: read(path).toString('base64') } }));
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }, ...blocks] }, parent_tool_use_id: null }) + '\n';
}

const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(item => item?.type === 'text').map(item => item.text).join('\n') : JSON.stringify(value ?? '');
const count = value => Number.isFinite(value) && value >= 0 ? value : null;
export function claudeUsage(usage) {
  if (!usage) return null;
  const [input, created, read, output] = [usage.input_tokens, usage.cache_creation_input_tokens ?? 0, usage.cache_read_input_tokens ?? 0, usage.output_tokens].map(count);
  return { input_tokens: input === null || created === null || read === null ? null : input + created + read, cached_input_tokens: read, output_tokens: output };
}

const progressEveryMs = 300;
export function claudeStream({ sessionId, onEvent, onProgress, onSession, onBrowser, onLimits, onTool }) {
  const state = { session: null, result: null, mismatch: false, summary: '', progress: '', tools: new Map(), progressAt: 0 };
  const toolUse = block => {
    state.tools.set(block.id, block.name);
    if (browserTool(block.name)) onBrowser?.({ phase: 'started', label: block.name, pointer: browserPointer(block.name, block.input) });
    onTool?.({ id: block.id, name: block.name, phase: 'started', input: block.input ?? {} });
    onEvent?.('tool', `${block.name} ${JSON.stringify(block.input ?? {}).slice(0, 1000)}`);
  };
  const toolResult = block => {
    const name = state.tools.get(block.tool_use_id) ?? 'tool', content = Array.isArray(block.content) ? block.content : [];
    if (browserTool(name)) onBrowser?.({ phase: 'completed', label: name, images: content.filter(item => item?.type === 'image' && item.source?.data).slice(0, 4).map(item => ({ type: 'image', mimeType: item.source.media_type, data: item.source.data })) });
    onTool?.({ id: block.tool_use_id, name, phase: 'completed', output: text(block.content), isError: block.is_error === true });
    onEvent?.('tool', `${name} · ${block.is_error ? 'failed' : 'completed'}\n${text(block.content).slice(-4000)}`);
  };
  const consume = event => {
    onEvent?.('raw', JSON.stringify(event));
    if (event.type === 'system' && event.subtype === 'init') {
      if (event.session_id !== sessionId) { state.mismatch = true; return; }
      state.session = event.session_id; onSession?.(event.session_id);
    }
    if (event.type === 'rate_limit_event' && event.rate_limit_info) onLimits?.(claudeLimits(event.rate_limit_info));
    if (event.type === 'stream_event') {
      if (event.event?.type === 'message_start') state.progress = '';
      if (event.event?.delta?.type === 'text_delta') { state.progress = (state.progress + event.event.delta.text).slice(-100000); if (Date.now() - state.progressAt >= progressEveryMs) { state.progressAt = Date.now(); onProgress?.(state.progress); } }
    }
    if (event.type === 'assistant') for (const block of event.message?.content ?? []) {
      if (block.type === 'text' && block.text.trim()) { state.summary = block.text; onProgress?.(''); onEvent?.('message', block.text); }
      if (block.type === 'tool_use') toolUse(block);
    }
    if (event.type === 'user') for (const block of Array.isArray(event.message?.content) ? event.message.content : []) if (block.type === 'tool_result') toolResult(block);
    if (event.type === 'result') {
      state.result = event;
      const denied = Array.isArray(event.permission_denials) ? event.permission_denials : [];
      if (denied.length) onEvent?.('tool', `Claude Code refused ${denied.length} tool request(s) outside this turn's permissions: ${[...new Set(denied.map(item => item.tool_name))].join(', ').slice(0, 500)}`);
    }
  };
  return { state, consume };
}

export function claudeOutcome({ result, state, sessionId }) {
  const report = state.result, usage = claudeUsage(report?.usage);
  if (result.cancelled) return { outcome: 'cancelled', sessionId, summary: state.summary, usage };
  if (result.timedOut) return { outcome: 'failed', sessionId, summary: 'Claude Code execution timed out.', usage };
  if (result.exitCode !== 0 || result.malformed || state.mismatch || !state.session || !report || report.is_error || report.subtype !== 'success') {
    return { outcome: 'failed', sessionId, summary: `Claude Code did not complete a valid turn. ${String(report?.result ?? report?.subtype ?? result.output.slice(-2000)).slice(0, 2000)}`, usage };
  }
  const summary = typeof report.result === 'string' && report.result.trim() ? report.result : state.summary;
  return { outcome: blockedOutcome(summary), sessionId, summary, usage };
}

export class ClaudeAdapter {
  constructor({ execute = runProcess, command = 'claude', bridge = openToolBridge } = {}) { this.execute = execute; this.command = command; this.bridge = bridge; }
  get contract() { return { questions: 'tool', tools: 'mcp', browserTools: 'mcp', sessions: true, modelSwitch: true, streaming: true, readOnlyTurns: true, readOnlyTools: true, writableRoots: true, permissionPrompts: 'tool' }; }
  get commandOptions() { return { inheritEnv: false, env: localEnvironment(), timeoutMs: 10000 }; }
  async probe() {
    const result = await this.execute(this.command, ['--version'], this.commandOptions);
    return result.exitCode === 0 ? { version: result.output.trim() } : { version: null, problem: cliProblem('Claude Code', this.command, result, 'Install it, then refresh.') };
  }
  async version() { return (await this.probe()).version; }
  async capabilities() {
    const { version, problem } = await this.probe();
    if (!version) return { available: false, authenticated: false, detail: problem };
    const auth = await this.execute(this.command, ['auth', 'status'], this.commandOptions);
    return { available: true, authenticated: auth.exitCode === 0, version, detail: auth.exitCode === 0 ? 'Using your local Claude Code login' : 'Run claude auth login in your terminal, then refresh.' };
  }
  async limits() {
    const result = await this.execute(this.command, ['-p', '/usage', '--output-format', 'json', '--no-session-persistence'], { cwd: tmpdir(), inheritEnv: false, env: localEnvironment(), timeoutMs: 30000 });
    let report; try { report = JSON.parse(result.output); } catch { report = null; }
    if (result.exitCode !== 0 || result.timedOut || report?.is_error || report?.num_turns !== 0) return null;
    return claudeUsageText(report.result);
  }
  async models() {
    return { available: true, models: aliases.map(([model, displayName, supportedReasoningEfforts]) => ({ model, displayName, isDefault: false, defaultReasoningEffort: null, supportedReasoningEfforts })), message: 'Claude Code model aliases; the CLI resolves each to the newest version your account can use.' };
  }
  async run({ workspace, sessionId, prompt, images = [], signal, onEvent, onSession, onSpawn, timeoutMs = null, readOnly = false, interactive = false, execution, onQuestion, onMemory, tools, onTool, writableRoots = [], readableRoots = [], fullAccess = false, network = null, onProgress, onBrowser, onLimits }, providerEnv = {}) {
    const id = sessionId ?? randomUUID();
    const handlers = tools?.list?.length ? { tools: tools.list, call: tools.call } : interactive && !readOnly ? { onQuestion, onMemory } : null;
    const bridge = handlers ? await this.bridge(handlers) : null;
    try {
      const mcpConfig = bridge && await bridge.writeConfig('claude-mcp.json', { mcpServers: { dispatch: { type: 'stdio', ...bridge.mcp } } });
      const stream = claudeStream({ sessionId: id, onEvent, onProgress, onSession, onBrowser, onLimits, onTool });
      const result = await runJsonLines(this.execute, this.command, claudeArgs({ sessionId: id, resume: Boolean(sessionId), execution, readOnly, mcpConfig, mcpTools: bridge?.names ?? [], writableRoots, readableRoots, fullAccess, network, streamInput: images.length > 0 }), { cwd: workspace, signal, timeoutMs, input: claudeInput(prompt, images), inheritEnv: false, env: localEnvironment({ MCP_TOOL_TIMEOUT: String(timeoutMs ?? unboundedToolTimeoutMs), ...providerEnv }), onSpawn, onEvent: stream.consume });
      onProgress?.('');
      return claudeOutcome({ result, state: stream.state, sessionId: id });
    } finally { await bridge?.close(); }
  }
}
