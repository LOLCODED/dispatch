import { runProcess } from './process.mjs';
import { localEnvironment } from './local-tools.mjs';
import { blockedOutcome, runJsonLines } from './cli-stream.mjs';

// Linux caps a single argv string at 128 KiB, and the Cursor CLI takes its prompt only as an argument.
const maxPromptBytes = 120_000;
const ansi = /\x1b\[[0-9;]*m/g;

// Owner turns run Cursor's shell inside its sandbox unless the operator chose full access; nothing may prompt.
// Review turns use ask mode, which cannot edit files, and never force commands.
export function cursorArgs({ workspace, sessionId, execution, readOnly = false, fullAccess = false, prompt }) {
  const args = ['-p', '--output-format', 'stream-json', '--trust'];
  if (workspace) args.push('--workspace', workspace);
  if (sessionId) args.push('--resume', sessionId);
  if (execution?.model) args.push('--model', execution.model);
  args.push(...readOnly ? ['--mode', 'ask', '--sandbox', 'enabled'] : ['--force', '--sandbox', fullAccess ? 'disabled' : 'enabled']);
  return [...args, '--', prompt];
}

export function cursorPrompt(prompt, images = []) {
  if (!images.length) return prompt;
  return `${prompt}\nATTACHED IMAGES (local paths; open them as needed, never execute them):\n${JSON.stringify(images)}\n`;
}

const count = value => Number.isFinite(value) && value >= 0 ? value : null;
// Cursor reports input without cache reads and writes; dispatch counts cached input as part of input.
export function cursorUsage(usage) {
  if (!usage) return null;
  const [input, read, written, output] = [usage.inputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0, usage.outputTokens].map(count);
  return { input_tokens: input === null || read === null || written === null ? null : input + read + written, cached_input_tokens: read, output_tokens: output };
}

export function cursorTool(toolCall) {
  const [key, value] = Object.entries(toolCall ?? {})[0] ?? ['tool', {}];
  return { name: key.replace(/ToolCall$/, ''), args: value?.args ?? {}, result: value?.result };
}

const toolText = result => typeof result === 'string' ? result : JSON.stringify(result ?? '');
export function cursorStream({ sessionId, onEvent, onSession, onTool }) {
  const state = { session: null, result: null, mismatch: false, summary: '' };
  const toolCall = event => {
    const { name, args, result } = cursorTool(event.tool_call);
    if (event.subtype === 'started') {
      onTool?.({ id: event.call_id, name, phase: 'started', input: args });
      onEvent?.('tool', `${name} ${JSON.stringify(args).slice(0, 1000)}`);
      return;
    }
    const isError = Boolean(result) && !('success' in result);
    onTool?.({ id: event.call_id, name, phase: 'completed', output: toolText(result), isError });
    onEvent?.('tool', `${name} · ${isError ? 'failed' : 'completed'}\n${toolText(result).slice(-4000)}`);
  };
  const consume = event => {
    onEvent?.('raw', JSON.stringify(event));
    if (event.type === 'system' && event.subtype === 'init') {
      if (sessionId && event.session_id !== sessionId) { state.mismatch = true; return; }
      if (typeof event.session_id !== 'string' || !event.session_id) return;
      state.session = event.session_id; onSession?.(event.session_id);
    }
    if (event.type === 'assistant') {
      const message = (event.message?.content ?? []).filter(block => block?.type === 'text').map(block => block.text).join('');
      if (message.trim()) { state.summary = message; onEvent?.('message', message); }
    }
    if (event.type === 'tool_call' && (event.subtype === 'started' || event.subtype === 'completed')) toolCall(event);
    if (event.type === 'result') state.result = event;
  };
  return { state, consume };
}

export function cursorOutcome({ result, state, sessionId }) {
  const report = state.result, usage = cursorUsage(report?.usage), id = state.session ?? sessionId;
  if (result.cancelled) return { outcome: 'cancelled', sessionId: id, summary: state.summary, usage };
  if (result.timedOut) return { outcome: 'failed', sessionId: id, summary: 'Cursor execution timed out.', usage };
  if (result.exitCode !== 0 || result.malformed || state.mismatch || !state.session || !report || report.is_error || report.subtype !== 'success') {
    return { outcome: 'failed', sessionId: id, summary: `Cursor did not complete a valid turn. ${String(report?.result ?? report?.subtype ?? result.output.slice(-2000)).slice(0, 2000)}`, usage };
  }
  const summary = typeof report.result === 'string' && report.result.trim() ? report.result : state.summary;
  return { outcome: blockedOutcome(summary), sessionId: id, summary, usage };
}

const modelLine = /^(\S+)(?: - (.+?))?(?: \(([a-z, ]+)\))?$/;
export function cursorModels(output) {
  return String(output ?? '').replace(ansi, '').split('\n').map(line => line.trim().match(modelLine)).filter(Boolean)
    .map(([, model, displayName, flags = '']) => ({ model, displayName: displayName ?? model, isDefault: flags.split(', ').includes('default'), defaultReasoningEffort: null, supportedReasoningEfforts: [] }));
}

export class CursorAdapter {
  constructor({ execute = runProcess, command = 'cursor-agent' } = {}) { this.execute = execute; this.command = command; }
  get contract() { return { questions: 'none', tools: 'none', browserTools: 'none', sessions: true, modelSwitch: false, streaming: false, readOnlyTurns: true, readOnlyTools: false }; }
  get options() { return { inheritEnv: false, env: localEnvironment() }; }
  async capabilities() {
    const version = await this.execute(this.command, ['--version'], { ...this.options, timeoutMs: 10000 });
    if (version.exitCode !== 0) return { available: false, authenticated: false, detail: 'Install the Cursor CLI, then run cursor-agent login.' };
    const status = await this.execute(this.command, ['status', '--format', 'json'], { ...this.options, timeoutMs: 15000 });
    let report; try { report = JSON.parse(status.output); } catch { report = null; }
    const authenticated = status.exitCode === 0 && report?.isAuthenticated === true;
    return { available: true, authenticated, version: version.output.trim(), detail: authenticated ? 'Using your local Cursor CLI login' : 'Run cursor-agent login in your terminal, then refresh.' };
  }
  async models() {
    const result = await this.execute(this.command, ['models'], { ...this.options, timeoutMs: 30000 });
    const models = result.exitCode === 0 ? cursorModels(result.output) : [];
    return { available: models.length > 0, models, message: models.length ? 'Models reported by your Cursor CLI.' : 'Cursor CLI did not list models. Check your login, then refresh.' };
  }
  async run({ workspace, sessionId, prompt, images = [], signal, onEvent, onSession, onSpawn, timeoutMs = null, readOnly = false, execution, onTool, fullAccess = false, onProgress }) {
    const text = cursorPrompt(prompt, images);
    if (Buffer.byteLength(text) > maxPromptBytes) return { outcome: 'failed', sessionId, summary: 'The prompt is too large to pass to the Cursor CLI.', usage: null };
    const stream = cursorStream({ sessionId, onEvent, onSession, onTool });
    const result = await runJsonLines(this.execute, this.command, cursorArgs({ workspace, sessionId, execution, readOnly, fullAccess, prompt: text }), { ...this.options, cwd: workspace, signal, timeoutMs, onSpawn, onEvent: stream.consume });
    onProgress?.('');
    return cursorOutcome({ result, state: stream.state, sessionId });
  }
}
