import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedReply, chooseOption, freeTextReply, interactionAnswers, nextMove, numberedOptions } from '../scripts/replay-operator.mjs';
import { assertSandboxed, sandboxInput } from '../scripts/ticket-replay.mjs';

test('the simulated operator picks the recommended option, else the first, else replies in free text', () => {
  assert.equal(chooseOption([{ label: 'Skip' }, { label: 'Approve (Recommended)' }]), 'Approve (Recommended)');
  assert.equal(chooseOption([{ label: 'A' }, { label: 'B' }]), 'A');
  assert.equal(chooseOption([]), null);
  const { answers, notes } = interactionAnswers({ source: 'risk', questions: [{ id: 'risk', header: 'Testing plan', question: 'Approve?', options: [{ label: 'Approve (Recommended)' }, { label: 'Change' }] }, { id: 'why', question: 'Anything else?' }] });
  assert.deepEqual(answers, { risk: 'Approve (Recommended)', why: freeTextReply });
  assert.equal(notes.length, 2); assert.equal(notes[0].declined, false);
});

test('anything that widens a sandboxed replay is declined', () => {
  const setting = interactionAnswers({ source: 'tool', questions: [{ id: 'setting', header: 'Change a setting', question: 'Allow db.example.test?', options: [{ label: 'Change it', description: 'Save it.' }, { label: 'Leave it', description: 'Keep the current value.' }] }] });
  assert.equal(setting.answers.setting, 'Leave it'); assert.equal(setting.notes[0].declined, true);
  const repository = interactionAnswers({ source: 'tool', questions: [{ id: 'repository', header: 'Add a repository', question: 'Add it?', options: [{ label: 'Add it', description: 'Save it.' }, { label: 'Not now', description: 'Keep working without it.' }] }] });
  assert.equal(repository.answers.repository, 'Not now');
});

test('a blocked question with numbered options is answered with the recommended one', () => {
  const question = 'How should I proceed?\n1. Run it yourself\n2. Allow the host (Recommended)\n3. Skip';
  assert.deepEqual(numberedOptions(question), ['Run it yourself', 'Allow the host (Recommended)', 'Skip']);
  assert.equal(blockedReply(question), `Allow the host. ${freeTextReply}`);
  assert.equal(blockedReply('Which export should I use?'), freeTextReply);
});

test('a stopped run gets the button or reply a person would use', () => {
  assert.deepEqual(nextMove({ status: 'ready' }), { kind: 'done' });
  assert.deepEqual(nextMove({ status: 'failed', sessionId: 's', revision: 'r', checks: [{ name: 'unit', status: 'failed', base: 'failed', revision: 'r' }] }), { kind: 'accept-preexisting' });
  assert.deepEqual(nextMove({ status: 'blocked', blockedTree: { files: 2, linkedFiles: 0, repeats: 2 } }), { kind: 'finish-as-is' });
  assert.equal(nextMove({ status: 'blocked', asIs: true, blockedTree: { files: 2, linkedFiles: 0, repeats: 3 } }).kind, 'followup');
  assert.deepEqual(nextMove({ status: 'blocked', question: 'Which one?', blockedTree: { files: 1, linkedFiles: 0, repeats: 1 } }), { kind: 'followup', input: freeTextReply });
});

test('a replay project reaches nothing outside the sandbox, whatever the overrides ask for', () => {
  const info = { repositoryPath: '/tmp/example', name: 'example', baseBranch: 'main', scripts: { test: 'node --test' }, suggestedChecks: ['test'], suggestedLocalFiles: ['.env.test'], registries: [] };
  const input = sandboxInput(info, { network: { hosts: ['db.example.test'], localPorts: true }, localFiles: ['.env'], trackRemote: true }, { tracker: { enabled: true, actions: { read: true } } });
  assert.deepEqual(input.network, { hosts: [], localPorts: false });
  assert.deepEqual([input.localFiles, input.databases, input.trackRemote, input.baseBranch], [[], [], false, 'replay-base']);
  const connector = { id: 'tracker', actions: { read: { access: 'read' }, comment: { access: 'write' } } };
  const live = { registry: { ids: () => ['tracker'], get: () => connector }, connectors: { active: project => project.connectors.tracker.enabled } };
  assert.doesNotThrow(() => assertSandboxed(live, [{ name: 'x', network: input.network, connectors: { tracker: { enabled: true, actions: { read: true, comment: false } } } }]));
  assert.throws(() => assertSandboxed(live, [{ name: 'x', network: input.network, connectors: { tracker: { enabled: true, actions: { read: true } } } }]), /write action on/);
  assert.throws(() => assertSandboxed(live, [{ name: 'x', network: { hosts: ['a.example'] }, connectors: { tracker: { enabled: false } } }]), /outside the sandbox/);
});
