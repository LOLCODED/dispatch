import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { localEnvironment } from './local-tools.mjs';
import { blockedOutcome, browserPointer, browserTool } from './cli-stream.mjs';
import { usageDelta } from './usage.mjs';

const unknownUsage = { input_tokens: null, cached_input_tokens: null, output_tokens: null };
const tokenCounts = value => value ? { input_tokens: value.inputTokens ?? null, cached_input_tokens: value.cachedInputTokens ?? null, output_tokens: value.outputTokens ?? null } : null;
// Codex totals are thread-cumulative; the turn's first update fixes the pre-turn total as total minus last.
function turnUsage(tokenUsage, baseline) {
  const last = tokenCounts(tokenUsage?.last), total = tokenCounts(tokenUsage?.total);
  const start = baseline === undefined ? usageDelta(total, last) : baseline;
  return { baseline: start, usage: { ...(usageDelta(total, start) ?? unknownUsage), last, total } };
}

// One native app-server connection per worker turn. No polling, credential copy,
// auto-approval, session-wide grant, or model call for routing.
export function runAppServer({ command = 'codex', spawnProcess = spawn, workspace, writableRoots = [], fullAccess = false, sessionId, prompt, images = [], signal, timeoutMs = null, execution, onSpawn, onSession, onEvent, onProgress, onQuestion, onBrowser, onTool, extraArgs = [] }) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve({ outcome: 'cancelled', sessionId });
    let buffer = '', nextId = 0, threadId = sessionId, turnId, summary = '', usage = null, usageBaseline, terminalResult = null, closing = false, failure = '', timer, killer, progressAt = 0, activeRequests = 0;
    const pending = new Map(), items = new Map(), decoder = new StringDecoder('utf8');
    const sandbox = fullAccess ? 'danger-full-access' : 'workspace-write';
    const args = ['app-server', '--listen', 'stdio://', '-c', 'approval_policy="never"', '-c', `sandbox_mode="${sandbox}"`, '-c', 'sandbox_workspace_write.network_access=false', '-c', 'features.multi_agent=false', ...extraArgs];
    const child = spawnProcess(command, args, { cwd: workspace, env: localEnvironment(), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const kill = sig => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, sig); else child.kill(sig); } catch { /* Process group already gone. */ } };
    const send = value => { if (!closing) child.stdin.write(JSON.stringify(value) + '\n'); };
    const stop = () => {
      if (closing) return;
      closing = true; clearTimeout(timer); child.stdin.end(); kill('SIGTERM'); killer = setTimeout(() => kill('SIGKILL'), 1000); killer.unref();
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Codex connection closed.')); } pending.clear();
    };
    const fail = message => { failure ||= message; stop(); };
    const rpc = (method, params) => new Promise((resolve, reject) => {
      if (closing) { reject(new Error('Codex connection closed.')); return; }
      const id = ++nextId;
      const requestTimer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out.`)); }, 15000);
      pending.set(id, { resolve, reject, timer: requestTimer }); send({ id, method, params });
    });
    const abort = () => { terminalResult = { outcome: 'cancelled' }; stop(); };
    child.on('spawn', () => onSpawn?.(child.pid));
    child.on('error', () => fail('Could not start Codex app-server. Check the installed CLI.'));
    child.stdin.on('error', () => fail('Codex input connection closed.'));
    child.stderr.on('data', () => {}); // Never expose credential diagnostics.
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killer); signal?.removeEventListener('abort', abort);
      if (closing || signal?.aborted) kill('SIGKILL');
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Codex connection closed.')); } pending.clear();
      onProgress?.('');
      resolve({ outcome: failure || !terminalResult ? 'failed' : terminalResult.outcome, sessionId: threadId, summary: failure || (!terminalResult ? `Codex ended without a completed turn (exit ${code ?? 'unknown'}).` : summary), usage });
    });
    const belongs = params => !params?.threadId || params.threadId === threadId;
    const notification = event => {
      const p = event.params ?? {};
      if (!belongs(p)) return;
      if (event.method === 'turn/started') {
        if (turnId && turnId !== p.turn?.id) { fail('Codex changed the active turn.'); return; } turnId = p.turn?.id;
      }
      if (p.turnId && turnId && p.turnId !== turnId) return;
      if (event.method === 'item/started') {
        const item = p.item; if (!item) return;
        items.set(item.id, item);
        if (items.size > 200) items.delete(items.keys().next().value);
        if (item.type === 'mcpToolCall' && browserTool(`${item.server}/${item.tool}`)) onBrowser?.({ phase: 'started', label: `${item.server}/${item.tool}`, pointer: browserPointer(item.tool, item.arguments) });
        if (item.type === 'mcpToolCall') onTool?.({ id: item.id, name: String(item.tool ?? 'tool'), server: item.server, phase: 'started', input: item.arguments ?? {} });
        if (item.type === 'commandExecution') { onTool?.({ id: item.id, name: 'command', phase: 'started', input: { command: item.command } }); onEvent?.('tool', String(item.command ?? 'Running command').slice(0, 1000)); }
      }
      if (event.method === 'item/agentMessage/delta') {
        const item = items.get(p.itemId) ?? { id: p.itemId, type: 'agentMessage', text: '' };
        item.text = (item.text + String(p.delta ?? '')).slice(-100000); items.set(p.itemId, item);
        if (Date.now() - progressAt >= 300) { progressAt = Date.now(); onProgress?.(item.text); }
      }
      if (event.method === 'item/completed') {
        const item = p.item; if (!item) return;
        items.delete(item.id);
        if (item.type === 'agentMessage') { summary = String(item.text ?? ''); onProgress?.(''); onEvent?.('message', summary); }
        if (item.type === 'commandExecution') { onTool?.({ id: item.id, name: 'command', phase: 'completed', output: String(item.aggregatedOutput ?? ''), isError: item.exitCode !== 0 }); onEvent?.('tool', `${String(item.command ?? 'Command').slice(0, 1000)} · exit ${item.exitCode ?? 'unknown'}\n${String(item.aggregatedOutput ?? '').slice(-4000)}`); }
        if (item.type === 'mcpToolCall') {
          const content = Array.isArray(item.result?.content) ? item.result.content : [];
          onTool?.({ id: item.id, name: String(item.tool ?? 'tool'), server: item.server, phase: 'completed', output: item.error ? JSON.stringify(item.error) : content.filter(part => part.type === 'text').map(part => String(part.text)).join('\n'), isError: Boolean(item.error) || item.status === 'failed' });
          if (browserTool(`${item.server}/${item.tool}`)) onBrowser?.({ phase: 'completed', label: `${item.server}/${item.tool}`, images: content.filter(item => item.type === 'image').slice(0, 4) });
          const details = item.error ?? content.filter(item => item.type === 'text').map(item => String(item.text).slice(-2000));
          onEvent?.('tool', `${item.server ?? 'MCP'}/${item.tool ?? 'tool'} · ${item.status}\n${JSON.stringify(details).slice(-4000)}`);
        }
        if (item.type === 'fileChange') onEvent?.('files', JSON.stringify(item.changes ?? []).slice(0, 5000));
      }
      if (event.method === 'thread/tokenUsage/updated') {
        ({ usage, baseline: usageBaseline } = turnUsage(p.tokenUsage, usageBaseline));
      }
      if (event.method === 'turn/completed') {
        if (!turnId || !p.turn?.id || p.turn.id !== turnId || activeRequests) { fail('Codex returned a mismatched or premature completed turn.'); return; }
        const status = p.turn.status;
        terminalResult = { outcome: status === 'completed' ? blockedOutcome(summary) : status === 'interrupted' ? 'cancelled' : 'failed' };
        if (status === 'failed') summary = p.turn.error?.message ?? 'Codex turn failed.';
        stop();
      }
      if (event.method === 'error' && p.willRetry !== true) fail(p.error?.message ?? 'Codex app-server reported an error.');
    };
    const handleRequest = async event => {
      try {
      const p = event.params ?? {};
      if (!belongs(p) || !threadId || p.turnId && turnId && p.turnId !== turnId) { send({ id: event.id, error: { code: -32602, message: 'Request does not belong to this worker turn.' } }); return; }
      if (event.method === 'item/tool/requestUserInput' && onQuestion) {
        try { send({ id: event.id, result: await onQuestion(p.questions) }); }
        catch { send({ id: event.id, result: { answers: {} } }); }
      } else if (['item/fileChange/requestApproval', 'item/commandExecution/requestApproval'].includes(event.method)) {
        send({ id: event.id, result: { decision: 'decline' } });
        onEvent?.('tool', 'Native permission escalation declined.');
      } else send({ id: event.id, error: { code: -32601, message: 'Unsupported request; no permissions granted.' } });
      } finally { activeRequests--; }
    };
    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      if (buffer.length > 2000000) { fail('Codex event exceeded the stream limit.'); return; }
      let newline;
      while (!closing && (newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (!line.trim()) continue;
        let event; try { event = JSON.parse(line); } catch { fail('Codex returned malformed JSON.'); return; }
        if (event.method && event.id != null) {
          if (activeRequests >= 4) { fail('Too many pending Codex requests.'); return; }
          activeRequests++;
          void handleRequest(event).catch(() => fail('Could not answer a Codex request.'));
        }
        else if (event.method) { try { notification(event); } catch { fail('Could not record Codex activity.'); } }
        else {
          const request = pending.get(event.id); if (!request) continue;
          pending.delete(event.id); clearTimeout(request.timer);
          if (event.error) request.reject(new Error(`Codex request failed: ${String(event.error.message ?? 'unsupported protocol').slice(0, 1000)}`)); else request.resolve(event.result);
        }
      }
    });
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) { abort(); return; }
    if (timeoutMs != null) timer = setTimeout(() => fail('Codex turn exceeded its time limit.'), timeoutMs);
    void (async () => {
      await rpc('initialize', { clientInfo: { name: 'dispatch', title: 'dispatch', version: '1.2.0' }, capabilities: { experimentalApi: true } }); send({ method: 'initialized' });
      const config = { 'features.multi_agent': false, 'sandbox_workspace_write.network_access': false };
      const thread = await rpc(sessionId ? 'thread/resume' : 'thread/start', { ...(sessionId ? { threadId: sessionId, excludeTurns: true } : {}), ...(execution?.model ? { model: execution.model } : {}), cwd: workspace, sandbox, approvalPolicy: 'never', approvalsReviewer: 'user', config: { ...config, ...(execution?.effort ? { model_reasoning_effort: execution.effort } : {}) } });
      if (typeof thread?.thread?.id !== 'string' || sessionId && thread.thread.id !== sessionId) throw new Error('Codex did not resume the expected session.');
      threadId = thread.thread.id; onSession?.(threadId);
      const turn = await rpc('turn/start', { threadId, ...(execution?.model ? { model: execution.model } : {}), ...(execution?.effort ? { effort: execution.effort } : {}), input: [{ type: 'text', text: prompt, text_elements: [] }, ...images.map(path => ({ type: 'localImage', path }))], cwd: workspace, approvalPolicy: 'never', sandboxPolicy: fullAccess ? { type: 'dangerFullAccess' } : { type: 'workspaceWrite', writableRoots: [workspace, ...writableRoots], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } });
      if (typeof turn?.turn?.id !== 'string' || turnId && turn.turn.id !== turnId) throw new Error('Codex did not start the expected turn.');
      turnId = turn.turn.id;
    })().catch(error => { if (!closing) fail(error.message); });
  });
}
