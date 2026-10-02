import { readModels, readRateLimits } from './codex-models.mjs';
import { runProcess } from './process.mjs';
import { commandOnPath, localEnvironment } from './local-tools.mjs';
import { runAppServer } from './codex-app-server.mjs';
import { blockedOutcome, runJsonLines } from './cli-stream.mjs';
import { codexMcpArgs, openToolBridge } from './tool-bridge.mjs';

export class CodexAdapter {
  constructor({ execute = runProcess, command = 'codex', bridge = openToolBridge } = {}) { this.execute = execute; this.command = command; this.bridge = bridge; }
  get contract() { return { questions: 'native', tools: 'mcp', browserTools: 'mcp', sessions: true, modelSwitch: true, streaming: true, readOnlyTurns: true, readOnlyTools: false, writableRoots: true }; }
  installed() { return commandOnPath(this.command); }
  models() { return readModels(); }
  limits() { return readRateLimits(); }
  async capabilities() {
    const options = { inheritEnv: false, env: localEnvironment(), timeoutMs: 10000 };
    const version = await this.execute(this.command, ['--version'], options);
    if (version.exitCode !== 0) return { available: false, authenticated: false, detail: 'Install Codex CLI, then run codex login.' };
    const auth = await this.execute(this.command, ['login', 'status'], options);
    return { available: true, authenticated: auth.exitCode === 0, version: version.output.trim(), detail: auth.exitCode === 0 ? 'Using your local Codex login' : 'Run codex login in your terminal, then refresh.' };
  }
  async run(options) {
    const bridge = options.tools?.list?.length ? await this.bridge({ tools: options.tools.list, call: options.tools.call }) : null;
    try { return await this.turn(options, bridge ? codexMcpArgs(bridge) : []); }
    finally { await bridge?.close(); }
  }
  async turn({ workspace, sessionId, prompt, images = [], signal, onEvent, onSession, onSpawn, timeoutMs = null, readOnly = false, interactive = false, execution, onQuestion, writableRoots, fullAccess, onProgress, onBrowser, onTool }, extraArgs) {
    if (interactive && !readOnly) return runAppServer({ command: this.command, workspace, writableRoots, fullAccess, sessionId, prompt, images, signal, onEvent, onSession, onSpawn, timeoutMs, execution, onQuestion, onProgress, onBrowser, onTool, extraArgs });
    const args = ['exec', ...extraArgs];
    if (sessionId) args.push('resume', sessionId);
    args.push('--skip-git-repo-check');
    if (!sessionId) args.push('--color', 'never');
    if (execution?.model) args.push('--model', execution.model);
    if (execution?.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(execution.effort)}`);
    for (const path of images) args.push('--image', path);
    args.push('--json', '-c', 'approval_policy="never"', '-c', readOnly ? 'sandbox_mode="read-only"' : 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.network_access=false', '-c', 'features.multi_agent=false', '-');
    let malformed = false, complete = false, failed = false, foundSession = sessionId, summary = '', usage = null;
    const consume = event => {
      onEvent?.('raw', JSON.stringify(event));
      if (event.type === 'thread.started') {
        if (typeof event.thread_id !== 'string' || (sessionId && event.thread_id !== sessionId)) { malformed = true; return; }
        foundSession = event.thread_id; onSession?.(foundSession);
      }
      if (event.type === 'turn.completed') { complete = true; usage = event.usage ?? null; }
      if (event.type === 'turn.failed' || event.type === 'error') { failed = true; onEvent?.('error', event.error?.message ?? event.message ?? 'Codex turn failed'); }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') { summary = event.item.text ?? ''; onEvent?.('message', summary); }
      if (event.type === 'item.started' && event.item?.type === 'command_execution') { onTool?.({ id: event.item.id, name: 'command', phase: 'started', input: { command: event.item.command } }); onEvent?.('tool', event.item.command ?? 'Running a command'); }
      if (event.type === 'item.completed' && event.item?.type === 'command_execution') onTool?.({ id: event.item.id, name: 'command', phase: 'completed', output: String(event.item.aggregated_output ?? ''), isError: event.item.exit_code !== 0 });
      if (event.type === 'item.started' && event.item?.type === 'mcp_tool_call') onTool?.({ id: event.item.id, name: String(event.item.tool ?? 'tool'), server: event.item.server, phase: 'started', input: event.item.arguments ?? {} });
      if (event.type === 'item.completed' && event.item?.type === 'mcp_tool_call') onTool?.({ id: event.item.id, name: String(event.item.tool ?? 'tool'), server: event.item.server, phase: 'completed', output: JSON.stringify(event.item.error ?? event.item.result ?? ''), isError: Boolean(event.item.error) });
      if (event.type === 'item.completed' && event.item?.type === 'command_execution') onEvent?.('tool', `${String(event.item.command ?? 'Command').slice(0, 1000)} · exit ${event.item.exit_code ?? 'unknown'}\n${String(event.item.aggregated_output ?? '').slice(-4000)}`);
      if (['item.started', 'item.completed'].includes(event.type) && event.item?.type === 'mcp_tool_call') onEvent?.('tool', `${event.item.server ?? 'MCP'}/${event.item.tool ?? 'tool'} · ${event.type === 'item.started' ? 'started' : event.item.status ?? 'completed'}\n${JSON.stringify(event.item.error ?? event.item.result ?? '').slice(-4000)}`);
      if (event.type === 'item.completed' && event.item?.type === 'file_change') onEvent?.('files', JSON.stringify(event.item.changes ?? []).slice(0, 5000));
    };
    const result = await runJsonLines(this.execute, this.command, args, { cwd: workspace, signal, timeoutMs, input: prompt, inheritEnv: false, env: localEnvironment(), onSpawn, onEvent: consume });
    malformed ||= result.malformed;
    const reported = { usage: sessionId ? null : usage, cumulativeUsage: usage };
    if (result.cancelled) return { outcome: 'cancelled', sessionId: foundSession, summary, ...reported };
    if (result.timedOut) return { outcome: 'failed', sessionId: foundSession, summary: 'Codex execution timed out.', ...reported };
    if (result.exitCode !== 0 || malformed || failed || !complete || !foundSession) return { outcome: 'failed', sessionId: foundSession, summary: `Codex did not complete a valid turn. ${result.output.slice(-2000)}`, ...reported };
    return { outcome: blockedOutcome(summary), sessionId: foundSession, summary, ...reported };
  }
}
