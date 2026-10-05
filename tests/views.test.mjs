import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedView, withView } from '../src/views.mjs';
import { DispatchToolCalls } from '../src/tool-calls.mjs';

test('views keep their shape and limits, and anything unknown is dropped', () => {
  assert.equal(boundedView({ type: 'chart' }), null); assert.equal(boundedView('table'), null);
  const http = boundedView({ type: 'http', label: 'A very long connector label', request: { method: 'post', url: 'x' }, response: { status: '201', body: 'b'.repeat(20_000) } });
  assert.equal(http.label.length, 16); assert.equal(http.request.method, 'POST'); assert.equal(http.response.status, 201); assert.equal(http.response.body.length, 8000); assert.equal(http.response.bodyLength, 20_000);
  assert.deepEqual(boundedView({ type: 'checks', items: [{ name: 'lint', state: 'nope' }] }).items, [{ name: 'lint', state: 'muted', detail: '' }]);
  assert.equal(boundedView({ type: 'log', text: 'x'.repeat(20_000) }).text.length, 12_000);
});

test('a connector tool returning withView gives the agent the value and the step the view, labelled with the connector', async () => {
  const steps = [], connector = { id: 'docker', name: 'Docker' };
  const live = { steps: { append: (run, step) => steps.push(step) }, connectors: { connectorOfTool: () => connector, callTool: async () => withView({ lines: 2 }, { type: 'log', text: 'a\nb' }) } };
  const calls = new DispatchToolCalls(live), tools = [{ name: 'docker_logs', kind: 'connector' }];
  const answer = await calls.call({ project: {} }, 'docker_logs', {}, { tools });
  assert.equal(answer.isError, false); assert.match(answer.content[0].text, /"lines":2/);
  assert.deepEqual(steps.at(-1).view, { type: 'log', text: 'a\nb', label: 'Docker' });
});
