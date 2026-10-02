import test from 'node:test';
import assert from 'node:assert/strict';
import { browserTools, dispatchTools, toolNames, toolSchemaCharacters, toolSet, toolsByName } from '../src/dispatch-tools.mjs';
import { DispatchToolCalls } from '../src/tool-calls.mjs';

test('toolSet is the single gate: nothing attaches unless asked, and schema cost stays bounded', () => {
  assert.deepEqual(toolSet(), []);
  assert.deepEqual(toolNames(toolSet({ question: true })), ['dispatch_question']);
  assert.deepEqual(toolNames(toolSet({ question: true, memory: true })), ['dispatch_question', 'dispatch_memory']);
  assert.equal(toolSet({ browser: true }).length, browserTools.length);
  assert.ok(toolSchemaCharacters(toolSet({ question: true, memory: true, browser: true })) < 6000, 'full tool set schema stays under 6,000 characters');
  assert.ok(toolSchemaCharacters(browserTools) < 4000);
  assert.deepEqual(toolsByName(['dispatch_memory', 'nope']).map(tool => tool.name), ['dispatch_memory']);
  assert.ok(Object.values(dispatchTools).every(tool => tool.inputSchema.additionalProperties === false));
});

test('DispatchToolCalls gates by contract and project settings and records correlated steps', async () => {
  const steps = [];
  const live = { steps: { append: (run, step) => { steps.push(step); return { id: 'step' }; } }, interactions: { request: async (run, details) => ({ answers: { [details.questions[0].id]: { answers: ['Small'] } } }) }, memoryTool: () => ({ rules: [] }) };
  const calls = new DispatchToolCalls(live);
  const run = { project: { memory: true, browser: { enabled: true } } };
  assert.deepEqual(toolNames(calls.tools(run, { questions: 'native' })), ['dispatch_memory']);
  assert.deepEqual(toolNames(calls.tools(run, { questions: 'tool' })), ['dispatch_question', 'dispatch_memory']);
  assert.deepEqual(toolNames(calls.tools(run, { questions: 'tool', readOnlyTools: true }, { readOnly: true })), []);
  assert.deepEqual(toolNames(calls.tools({ project: { memory: false } }, { questions: 'native' })), []);
  live.browserCall = async () => ({ content: [{ type: 'text', text: 'ok' }] });
  assert.equal(calls.tools(run, { questions: 'native', readOnlyTools: true }, { readOnly: true }).length, browserTools.length);
  const tools = calls.tools(run, { questions: 'tool' });
  const answered = await calls.call(run, 'dispatch_question', { questions: [{ question: 'Scope?', options: [{ label: 'Small' }] }] }, { tools });
  assert.deepEqual(JSON.parse(answered.content[0].text), { 'question-1': 'Small' }); assert.equal(answered.isError, false);
  assert.deepEqual(steps.map(step => step.kind), ['tool.call', 'tool.result']); assert.equal(steps[0].callId, steps[1].callId); assert.equal(steps[0].server, 'dispatch');
  const unknown = await calls.call(run, 'dispatch_nothing', {}, { tools });
  assert.equal(unknown.isError, true); assert.match(unknown.content[0].text, /Unknown dispatch tool/);
  const huge = await calls.call(run, 'dispatch_memory', { action: 'remember', text: 'x'.repeat(20000) }, { tools });
  assert.equal(huge.isError, true); assert.match(huge.content[0].text, /too large/);
});
