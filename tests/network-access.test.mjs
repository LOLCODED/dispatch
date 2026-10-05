import test from 'node:test';
import assert from 'node:assert/strict';
import { networkSettings, taskNetwork } from '../src/network-access.mjs';
import { claudeArgs } from '../src/claude.mjs';

const settingsOf = args => JSON.parse(args[args.indexOf('--settings') + 1]);

test('network settings are host names and a local-ports switch, off by default', () => {
  assert.deepEqual(networkSettings(undefined), { hosts: [], localPorts: false });
  assert.deepEqual(networkSettings({ hosts: [' Registry.npmjs.org ', '*.example.test', 'registry.npmjs.org'], localPorts: true }), { hosts: ['registry.npmjs.org', '*.example.test'], localPorts: true });
  for (const value of [{ hosts: ['https://x.test'] }, { hosts: ['*'] }, { hosts: ['example.*'] }, { hosts: 'x.test' }, { localPorts: 'yes' }, { other: true }, []]) assert.throws(() => networkSettings(value), JSON.stringify(value));
});

test('a turn may reach what any repository in its task allows', () => {
  const run = { project: { network: { hosts: ['registry.npmjs.org'], localPorts: false } }, linked: [{ project: { network: { hosts: ['npm.example.test', 'registry.npmjs.org'], localPorts: true } } }, { project: {} }] };
  assert.deepEqual(taskNetwork(run), { hosts: ['registry.npmjs.org', 'npm.example.test'], localPorts: true });
  assert.deepEqual(taskNetwork({ project: {} }), { hosts: [], localPorts: false });
});

test('Claude Code gets the hosts and local binding inside its sandbox, never for read-only or unsandboxed turns', () => {
  const network = { hosts: ['registry.npmjs.org'], localPorts: true }, base = { sessionId: '11111111-2222-4333-8444-555555555555', writableRoots: ['/work'], network };
  assert.deepEqual(settingsOf(claudeArgs(base)).sandbox.network, { allowedDomains: ['registry.npmjs.org'], allowLocalBinding: true });
  assert.equal(settingsOf(claudeArgs({ ...base, network: { hosts: [], localPorts: false } })).sandbox.network, undefined);
  const readOnly = claudeArgs({ ...base, readOnly: true });
  assert.equal(readOnly.includes('--settings') ? settingsOf(readOnly).sandbox?.network : undefined, undefined);
  assert.equal(claudeArgs({ ...base, fullAccess: true }).includes('--settings'), false);
});
