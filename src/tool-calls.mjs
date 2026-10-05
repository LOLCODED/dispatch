import { randomUUID } from 'node:crypto';
import { InputError } from './engine.mjs';
import { riskEnabled } from './risk-policy.mjs';
import { bridgeQuestions, toolSet } from './dispatch-tools.mjs';
import { browserReview } from './browser-review.mjs';
import { usesBrowser } from './linked-repositories.mjs';
import { sqlCall } from './sql-tool.mjs';

const limits = { args: 16_000, result: 24_000 };
const textContent = value => [{ type: 'text', text: (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, limits.result) }];

// One handler for every dispatch tool, whichever CLI transported the call.
export class DispatchToolCalls {
  constructor(live) { this.live = live; }
  tools(run, contract, { readOnly = false } = {}) {
    const browser = usesBrowser(run) && Boolean(this.live.browserCall);
    const connectors = readOnly && contract.readOnlyTools !== true ? [] : this.live.connectors?.agentTools(run.project, { readOnly: readOnly || run.kind === 'answer' }) ?? [];
    return [...toolSet({ risk: !readOnly && riskEnabled(run.project), question: contract.questions === 'tool' && !readOnly, memory: run.project?.memory !== false && !readOnly, browser: browser && (!readOnly || contract.readOnlyTools === true), http: browser && !readOnly && run.kind !== 'answer', sql: Boolean(run.project?.database) && (!readOnly || contract.readOnlyTools === true), review: !readOnly && run.kind !== 'answer', repository: !readOnly && run.kind === 'change' && Boolean(this.live.repositories), permission: !readOnly && run.kind !== 'answer' && contract.permissionPrompts === 'tool' && Boolean(this.live.sensitiveWrites) }), ...connectors];
  }
  async call(run, name, args, { tools, signal, readOnly = false } = {}) {
    const tool = tools.find(item => item.name === name);
    if (!tool) return { content: textContent({ error: 'Unknown dispatch tool.' }), isError: true };
    // A permission request carries the whole file the agent wants to write.
    if (tool.kind !== 'permission' && JSON.stringify(args ?? {}).length > limits.args) return { content: textContent({ error: 'Tool arguments are too large.' }), isError: true };
    const callId = randomUUID(), started = Date.now();
    this.live.steps?.append(run, { kind: 'tool.call', callId, name, server: 'dispatch', input: args ?? {} });
    try {
      const result = await this.dispatch(run, tool, args ?? {}, { signal, readOnly });
      const content = Array.isArray(result?.content) ? result.content : textContent(result);
      this.live.steps?.append(run, { kind: 'tool.result', callId, name, output: content.filter(item => item.type === 'text').map(item => item.text).join('\n'), isError: false, durationMs: Date.now() - started, imageArtifactIds: result?.artifactIds ?? [] });
      return { content, isError: false };
    } catch (error) {
      const message = String(error.message ?? error).slice(0, 2000);
      this.live.steps?.append(run, { kind: 'tool.result', callId, name, output: message, isError: true, durationMs: Date.now() - started });
      return { content: textContent({ error: message }), isError: true };
    }
  }
  dispatch(run, tool, args, options) {
    if (tool.kind === 'browser-review') return this.review(run, args, options);
    if (tool.kind === 'question') return this.question(run, args, options);
    if (tool.kind === 'risk') return this.live.riskChecks.call(run, args, options);
    if (tool.kind === 'repository') return this.live.repositories.call(run, args, options);
    if (tool.kind === 'permission') return this.live.sensitiveWrites.call(run, args, options);
    if (tool.kind === 'memory') return this.live.memoryTool(run, args);
    if (tool.kind === 'browser') return this.live.browserCall(run, tool.name, args, options);
    if (tool.kind === 'http') return this.live.httpCall(run, args, options);
    if (tool.kind === 'sql') return sqlCall({ run, args, signal: options.signal, connectorUrl: (project, id, signal) => this.live.connectors.invoke(project, id, 'database.url', [], { signal }) });
    if (tool.kind === 'connector') return this.live.connectors.callTool(run.project, tool.name, args, { signal: options.signal, workspace: run.workspace, readOnly: options.readOnly || run.kind === 'answer' });
    throw new InputError('Unknown dispatch tool kind.');
  }
  async review(run, args, { signal, readOnly }) {
    if (readOnly || run.kind === 'answer') throw new InputError('UI feedback is available only to the implementation owner.');
    const { answers } = await this.live.interactions.request(run, browserReview(run, args), signal);
    return { feedback: answers?.['browser-feedback']?.answers?.[0] ?? null };
  }
  async question(run, args, { signal }) {
    const questions = bridgeQuestions(args.questions);
    if (!Array.isArray(questions) || !questions.length || questions.length > 3 || questions.some(question => typeof question.id !== 'string' || typeof question.question !== 'string') || JSON.stringify(questions).length > 16000) throw new InputError('Invalid question request.');
    const { answers } = await this.live.interactions.request(run, { kind: 'question', questions, source: 'tool' }, signal);
    return Object.fromEntries(Object.entries(answers ?? {}).map(([id, value]) => [id, value?.answers?.[0] ?? null]));
  }
}
