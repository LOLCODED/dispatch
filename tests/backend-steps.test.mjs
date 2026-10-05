import test from 'node:test';
import assert from 'node:assert/strict';
import { backendEntries, isBackendCall } from '../src/backend-steps.mjs';

const call = (id, name, input) => ({ id, kind: 'tool.call', callId: `c${id}`, name, input, at: '2026-10-05T00:00:00Z' });
const result = (id, output, isError = false) => ({ id: `r${id}`, kind: 'tool.result', callId: `c${id}`, output, isError, durationMs: 12 });

test('backend entries pair each backend call with its result, keep order, mark running calls and skip other tools', () => {
  const steps = [
    call('1', 'dispatch_http', { method: 'POST', url: 'app:/api/items' }), result('1', 'POST /api/items → 201'),
    call('2', 'dispatch_browser_click', { ref: 'e1' }), result('2', 'clicked'),
    call('3', 'dispatch_sql', { query: 'select id\nfrom items' }), result('3', 'relation missing', true),
    call('4', 'dispatch_service', { action: 'logs', service: 'worker' }),
    call('5', 'dispatch_ci', { action: 'status' }), result('5', 'CI success'),
  ];
  assert.deepEqual(backendEntries(steps).map(({ type, label, title, output, isError, pending }) => ({ type, label, title, output, isError, pending })), [
    { type: 'http', label: 'HTTP', title: 'POST app:/api/items', output: 'POST /api/items → 201', isError: false, pending: false },
    { type: 'table', label: 'SQL', title: 'select id', output: 'relation missing', isError: true, pending: false },
    { type: 'log', label: 'Service', title: 'worker · logs', output: null, isError: false, pending: true },
    { type: 'checks', label: 'CI', title: 'status branch', output: 'CI success', isError: false, pending: false },
  ]);
  assert.equal(isBackendCall({ kind: 'tool.result', name: 'dispatch_http' }), false);
});

test('a connector tool shows once its result carries a view, labelled and typed by that view', () => {
  const steps = [call('9', 'docker_logs', { container: 'api' }), { ...result('9', 'line'), view: { type: 'log', label: 'Docker', title: 'api', text: 'line' } }, call('8', 'docker_ps', {}), result('8', 'plain text only')];
  assert.deepEqual(backendEntries(steps).map(({ type, label, title }) => ({ type, label, title })), [{ type: 'log', label: 'Docker', title: 'api' }]);
});
