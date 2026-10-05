import test from 'node:test';
import assert from 'node:assert/strict';
import { SensitiveWrites, writeTarget } from '../src/sensitive-writes.mjs';
import { claudeArgs } from '../src/claude.mjs';
import { DispatchToolCalls } from '../src/tool-calls.mjs';

const workspace = '/work/run-1', linked = '/work/run-1-api';
const write = (path, tool_name = 'Write') => ({ tool_name, input: { file_path: path, content: 'registry=https://example.test/\n' }, tool_use_id: 'toolu_1' });

function harness({ allowSensitiveFiles = false, answer = 'Allow' } = {}) {
  const asked = [], saves = { count: 0 };
  const run = { id: 'run-1', workspace, linked: [{ workspace: linked }], project: { allowSensitiveFiles } };
  const live = { engine: { store: { save: () => saves.count++ } }, interactions: { request: async (_run, details) => { asked.push(details); return { answers: { 'sensitive-file': { answers: [answer] } } }; } } };
  return { run, asked, saves, writes: new SensitiveWrites(live) };
}

test('sensitive writes target only files inside the task worktrees', () => {
  const run = { workspace, linked: [{ workspace: linked }] };
  assert.deepEqual(writeTarget(run, write('.npmrc')), { path: `${workspace}/.npmrc`, inner: '.npmrc' });
  assert.deepEqual(writeTarget(run, write(`${linked}/.env`, 'Edit')), { path: `${linked}/.env`, inner: '.env' });
  assert.equal(writeTarget(run, { tool_name: 'NotebookEdit', input: { notebook_path: 'a.ipynb' } }).inner, 'a.ipynb');
  for (const args of [write('/home/me/.bashrc'), write('../run-2/.npmrc'), write(workspace), { tool_name: 'Bash', input: { command: 'cat .npmrc' } }, { tool_name: 'Write', input: {} }]) assert.equal(writeTarget(run, args), null);
});

test('an approved sensitive write passes and stays approved for the run', async () => {
  const { run, asked, saves, writes } = harness();
  const first = await writes.call(run, write('.npmrc'));
  assert.deepEqual(first, { behavior: 'allow', updatedInput: write('.npmrc').input });
  assert.match(asked[0].questions[0].question, /\.npmrc/);
  assert.deepEqual(run.sensitiveApprovals, [`${workspace}/.npmrc`]);
  assert.equal(saves.count, 1);
  assert.equal((await writes.call(run, write(`${workspace}/.npmrc`, 'Edit'))).behavior, 'allow');
  assert.equal(asked.length, 1);
});

test('a declined sensitive write is denied without remembering it', async () => {
  const { run, writes } = harness({ answer: 'Not now' });
  const result = await writes.call(run, write('.npmrc'));
  assert.equal(result.behavior, 'deny');
  assert.match(result.message, /did not allow writing \.npmrc/);
  assert.equal(run.sensitiveApprovals, undefined);
});

test('allowing sensitive files skips the question except for git and agent settings', async () => {
  const { run, asked, writes } = harness({ allowSensitiveFiles: true, answer: 'Not now' });
  assert.equal((await writes.call(run, write('.npmrc'))).behavior, 'allow');
  assert.equal((await writes.call(run, write(`${linked}/.env`))).behavior, 'allow');
  assert.equal(asked.length, 0);
  assert.equal((await writes.call(run, write('.claude/settings.json'))).behavior, 'deny');
  assert.equal((await writes.call(run, write('.git/config'))).behavior, 'deny');
  assert.equal(asked.length, 2);
});

test('requests outside the worktrees are denied without asking', async () => {
  const { run, asked, writes } = harness({ allowSensitiveFiles: true });
  assert.equal((await writes.call(run, write('/home/me/.npmrc'))).behavior, 'deny');
  assert.equal((await writes.call(run, { tool_name: 'Bash', input: { command: 'curl example.test' } })).behavior, 'deny');
  assert.equal(asked.length, 0);
});

test('Claude owner turns send permission prompts to dispatch only when the turn has the permission tool', () => {
  const session = '11111111-2222-4333-8444-555555555555';
  const routed = claudeArgs({ sessionId: session, mcpConfig: '/tmp/mcp.json', mcpTools: ['dispatch_question', 'dispatch_permission'] });
  assert.deepEqual(routed.slice(routed.indexOf('--permission-prompts'), routed.indexOf('--permission-prompts') + 4), ['--permission-prompts', 'host', '--permission-prompt-tool', 'mcp__dispatch__dispatch_permission']);
  const full = claudeArgs({ sessionId: session, mcpConfig: '/tmp/mcp.json', mcpTools: ['dispatch_permission'], fullAccess: true });
  assert.equal(full[full.indexOf('--permission-prompts') + 1], 'host');
  const plain = claudeArgs({ sessionId: session, mcpConfig: '/tmp/mcp.json', mcpTools: ['dispatch_question'] });
  assert.equal(plain[plain.indexOf('--permission-prompts') + 1], 'none');
  assert.ok(!plain.includes('--permission-prompt-tool'));
  const review = claudeArgs({ sessionId: session, readOnly: true, mcpConfig: '/tmp/mcp.json', mcpTools: ['dispatch_permission'] });
  assert.equal(review[review.indexOf('--permission-prompts') + 1], 'none');
});

test('only providers that route prompts to a tool get the permission tool, and never on read-only turns', async () => {
  const live = { sensitiveWrites: { call: async (_run, args) => ({ behavior: 'allow', updatedInput: args.input }) }, repositories: null };
  const calls = new DispatchToolCalls(live), run = { kind: 'change', project: { memory: false } };
  const names = (contract, options) => calls.tools(run, contract, options).map(tool => tool.name);
  assert.ok(names({ permissionPrompts: 'tool' }).includes('dispatch_permission'));
  assert.ok(!names({}).includes('dispatch_permission'));
  assert.ok(!names({ permissionPrompts: 'tool' }, { readOnly: true }).includes('dispatch_permission'));
  const tools = calls.tools(run, { permissionPrompts: 'tool' });
  const large = { tool_name: 'Write', input: { file_path: '.npmrc', content: 'x'.repeat(20_000) } };
  const result = await calls.call(run, 'dispatch_permission', large, { tools });
  assert.equal(result.isError, false);
  assert.equal(JSON.parse(result.content[0].text).behavior, 'allow');
});

test('shell commands Claude Code asks about pass while the sandbox contains them, never with the sandbox off', async () => {
  const { run, asked, writes } = harness();
  const shell = (command, extra = {}) => ({ tool_name: 'Bash', input: { command, ...extra } });
  assert.equal((await writes.call(run, shell('W=/work/run-1; git -C $W status'))).behavior, 'deny');
  run.access = 'home';
  assert.deepEqual(await writes.call(run, shell('VITE_OUTDIR=dist vite build')), { behavior: 'allow', updatedInput: { command: 'VITE_OUTDIR=dist vite build' } });
  const escape = await writes.call(run, shell('npm view left-pad', { dangerouslyDisableSandbox: true }));
  assert.equal(escape.behavior, 'deny'); assert.match(escape.message, /tell the operator what it needs/);
  run.access = 'full';
  assert.equal((await writes.call(run, shell('ls'))).behavior, 'deny');
  assert.equal(asked.length, 0);
});
