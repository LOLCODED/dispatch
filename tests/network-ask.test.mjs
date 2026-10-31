import test from 'node:test';
import assert from 'node:assert/strict';
import { actionRequest, deniedHosts, networkQuestion, openNetworkAsk } from '../src/network-ask.mjs';
import { askOf } from '../web/lib/board.mjs';
import { taskState } from '../src/board-state.mjs';

test('refused hosts are read from sandbox violation lines, once each', () => {
  assert.deepEqual(deniedHosts('x\ndeny network-outbound registry.npmjs.org:443 (user denied)\ndeny network-outbound registry.npmjs.org:443\ndeny network-outbound api.github.com'), ['registry.npmjs.org', 'api.github.com']);
  assert.deepEqual(deniedHosts('npm error 403 user denied'), []);
  assert.deepEqual(deniedHosts('deny network-outbound github.com:22\ndeny network-outbound db.example.test:5432'), [], 'the proxy carries only web requests');
});

test('an open network ask is a decision on the board with allow recommended, routed to the network endpoint', () => {
  const latest = { id: 'r1', status: 'ready', networkAsk: { hosts: ['registry.npmjs.org'], repository: 'slash-run' } };
  assert.equal(openNetworkAsk(latest), true); assert.equal(taskState({ latest }), 'decision');
  const ask = askOf(latest);
  assert.match(ask.text, /blocked registry\.npmjs\.org during this turn\. Allow it for slash-run/);
  assert.deepEqual(ask.options.map(option => [option.label, option.recommended]), [['Allow and continue', true], ['Keep blocked', false]]);
  assert.deepEqual(actionRequest('r1', ask.options[0].action), ['/api/runs/r1/network', { action: 'allow-network' }]);
  assert.deepEqual(actionRequest('r1', 'task'), ['/api/runs/r1/remaining', { action: 'task' }]);
  assert.equal(openNetworkAsk({ ...latest, networkAsk: { ...latest.networkAsk, resolution: 'kept' } }), false);
  assert.equal(networkQuestion({ hosts: ['a.test', 'b.test'], repository: 'x' }).question.includes('Allow them'), true);
});
