import test from 'node:test';
import assert from 'node:assert/strict';
import { CiTool, deliveredHead } from '../src/ci-tool.mjs';
import { Delivery } from '../src/delivery.mjs';
import { ConnectorRegistry } from '../src/connectors/registry.mjs';
import { ConnectorService } from '../src/connectors/service.mjs';
import { toolSet } from '../src/dispatch-tools.mjs';
import { forgeDouble } from './forge-double.mjs';

const baseSha = 'b'.repeat(40);
const delivered = { id: 'r1', kind: 'change', branch: 'dispatch/r1', baseBranch: 'main', headSha: 'head1', workspace: '/tmp/ws', delivery: { branch: 'dispatch/r1', remote: 'upstream', headSha: 'head1', pushedAt: '2026-10-05T00:00:00Z' } };

function fixture({ checks, actions = {} } = {}) {
  const forge = forgeDouble({ checks }), connectors = new ConnectorService({ registry: new ConnectorRegistry([forge.connector]), store: { state: {}, save() {} } });
  const project = { connectors: { forge: { enabled: true, actions } }, connectorMemory: {} };
  const followup = { id: 'r2', kind: 'change', previousRunId: 'r1', branch: 'dispatch/r1', baseBranch: 'main', headSha: 'head2', workspace: '/tmp/ws', project, delivery: null };
  const gitCalls = [], execute = async (command, args) => { gitCalls.push(args.slice(4)); return { exitCode: 0, output: `${baseSha}\trefs/heads/main\n` }; };
  const tool = new CiTool({ connectors, delivery: new Delivery(connectors), engine: { runs: [{ ...delivered, project }, followup] } }, { execute });
  return { forge, tool, run: followup, gitCalls };
}
const text = result => result.content[0].text;

test('a follow-up reads CI on the commit an earlier run of the task pushed and says when local commits are newer', async () => {
  const { forge, tool, run } = fixture();
  const result = text(await tool.call(run, { action: 'status' }));
  assert.equal(forge.of('checks')[0].sha, 'head1');
  assert.match(result, /^Pushed branch dispatch\/r1 at head1: CI success\.\n- ci: success/);
  assert.match(result, /local commits since that push/);
});

test('the branch label names the pull request, which a sandboxed agent cannot look up', async () => {
  const { tool, run } = fixture();
  const [first] = tool.live.engine.runs;
  first.delivery = { ...first.delivery, pr: { number: 6, url: 'https://github.com/example/repo/pull/6' } };
  assert.match(text(await tool.call(run, { action: 'status' })), /^Pushed branch dispatch\/r1 \(pull request #6, https:\/\/github\.com\/example\/repo\/pull\/6\) at head1: CI success\./);
});

test('the base target reads CI on the remote base head and logs come only for failing checks', async () => {
  const { forge, tool, run, gitCalls } = fixture({ checks: [{ name: 'unit', status: 'completed', conclusion: 'failure' }, { name: 'lint', status: 'completed', conclusion: 'success' }] });
  forge.logs.unit = 'assert failed at x.test.mjs:3';
  const result = text(await tool.call(run, { action: 'logs', target: 'base' }));
  assert.deepEqual(gitCalls, [['ls-remote', '--heads', 'upstream', 'refs/heads/main']]);
  assert.equal(forge.of('checks')[0].sha, baseSha); assert.deepEqual(forge.of('checkLogs')[0].names, ['unit']);
  assert.match(result, /Base branch main on upstream at b{12}: CI failure\./); assert.match(result, /### unit \(failure\)\nassert failed/);
  assert.doesNotMatch(result, /local commits/);
});

test('a task that never pushed is told to use the base target, and the tool is offered only while reading checks is allowed', async () => {
  const { tool, run } = fixture();
  assert.equal(deliveredHead({ id: 'x' }, []), null);
  await assert.rejects(tool.call({ ...run, previousRunId: null }, { action: 'status' }), /has not pushed a commit yet/);
  assert.equal(tool.available(run), true);
  assert.equal(tool.available({ ...run, kind: 'answer' }), false);
  const off = fixture({ actions: { readChecks: false } });
  assert.equal(off.tool.available(off.run), false);
  assert.deepEqual(toolSet({ ci: true }).map(item => item.name), ['dispatch_ci']);
});
