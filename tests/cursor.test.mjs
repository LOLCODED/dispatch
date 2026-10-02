import test from 'node:test';
import assert from 'node:assert/strict';
import { CursorAdapter, cursorArgs, cursorModels, cursorUsage } from '../src/cursor.mjs';

const session = 'c0ffee00-1111-4222-8333-444455556666';
const encode = events => events.map(event => JSON.stringify(event)).join('\n') + '\n';
const init = { type: 'system', subtype: 'init', session_id: session, model: 'Auto', permissionMode: 'default' };
const done = (result = 'Done ✓', extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, result, session_id: session, usage: { inputTokens: 10, outputTokens: 7, cacheReadTokens: 20, cacheWriteTokens: 5 }, ...extra });
function adapter(output, result = {}, inspect = () => {}) {
  return new CursorAdapter({ execute: async (command, args, options) => {
    inspect(args, options, command);
    const bytes = Buffer.from(output); for (let i = 0; i < bytes.length; i += 7) options.onStdout?.(bytes.subarray(i, i + 7));
    return { exitCode: 0, output: '', ...result };
  } });
}

test('Cursor args sandbox owner turns, keep review turns in ask mode and pass the prompt literally', () => {
  const owner = cursorArgs({ workspace: '/w', execution: { model: 'gpt-5' }, prompt: '--model x $(rm -rf /)' });
  assert.deepEqual(owner, ['-p', '--output-format', 'stream-json', '--trust', '--workspace', '/w', '--model', 'gpt-5', '--force', '--sandbox', 'enabled', '--', '--model x $(rm -rf /)']);
  const full = cursorArgs({ workspace: '/w', sessionId: session, fullAccess: true, prompt: 'x' });
  assert.deepEqual(full.slice(full.indexOf('--resume'), full.indexOf('--resume') + 2), ['--resume', session]);
  assert.equal(full[full.indexOf('--sandbox') + 1], 'disabled');
  const review = cursorArgs({ workspace: '/w', readOnly: true, fullAccess: true, prompt: 'x' });
  assert.ok(!review.includes('--force'));
  assert.deepEqual(review.slice(review.indexOf('--mode'), review.indexOf('--mode') + 4), ['--mode', 'ask', '--sandbox', 'enabled']);
});

test('Cursor usage folds cache reads and writes into input and keeps missing fields unknown', () => {
  assert.deepEqual(cursorUsage({ inputTokens: 10, outputTokens: 7, cacheReadTokens: 20, cacheWriteTokens: 5 }), { input_tokens: 35, cached_input_tokens: 20, output_tokens: 7 });
  assert.deepEqual(cursorUsage({ outputTokens: 3 }), { input_tokens: null, cached_input_tokens: 0, output_tokens: 3 });
  assert.equal(cursorUsage(undefined), null);
});

test('Cursor stream reports the new session, messages, tool calls and provider usage', async () => {
  const events = [], tools = [], sessions = [];
  const stream = encode([init,
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'task' }] }, session_id: session },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Reading ✓' }] }, session_id: session },
    { type: 'tool_call', subtype: 'started', call_id: 'c1', tool_call: { readToolCall: { args: { path: 'a.js' } } }, session_id: session },
    { type: 'tool_call', subtype: 'completed', call_id: 'c1', tool_call: { readToolCall: { args: { path: 'a.js' }, result: { success: { content: 'contents' } } } }, session_id: session },
    { type: 'tool_call', subtype: 'completed', call_id: 'c2', tool_call: { shellToolCall: { args: { command: 'rm x' }, result: { rejected: { reason: 'denied' } } } }, session_id: session },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Finished' }] }, session_id: session },
    done('Reading ✓Finished')]);
  let seen;
  const result = await adapter(stream, {}, (args, options) => { seen = { args, options }; }).run({ workspace: '/w', prompt: 'task', images: ['/a/shot.png'], onEvent: (kind, message) => events.push([kind, message]), onTool: event => tools.push(event), onSession: id => sessions.push(id) });
  assert.deepEqual([result.outcome, result.sessionId, result.summary], ['completed', session, 'Reading ✓Finished']);
  assert.deepEqual(result.usage, { input_tokens: 35, cached_input_tokens: 20, output_tokens: 7 });
  assert.deepEqual(sessions, [session]);
  assert.match(seen.args.at(-1), /^task\nATTACHED IMAGES[^\n]*\n\["\/a\/shot.png"\]\n$/); assert.equal(seen.options.inheritEnv, false); assert.equal(seen.options.cwd, '/w');
  assert.deepEqual(tools.map(event => [event.id, event.name, event.phase, event.isError ?? event.input.path]), [['c1', 'read', 'started', 'a.js'], ['c1', 'read', 'completed', false], ['c2', 'shell', 'completed', true]]);
  assert.deepEqual(events.filter(([kind]) => kind === 'message').map(([, message]) => message), ['Reading ✓', 'Finished']);
});

test('Cursor resumes the exact chat and fails closed on mismatches, errors and missing results', async () => {
  const resumed = await adapter(encode([init, done()]), {}, args => assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), ['--resume', session])).run({ sessionId: session, prompt: 'x' });
  assert.equal(resumed.outcome, 'completed'); assert.equal(resumed.sessionId, session);
  for (const [name, output, result] of [
    ['mismatched chat', encode([{ ...init, session_id: 'other' }, done()]), {}],
    ['missing session', encode([{ ...init, session_id: undefined }, done()]), {}],
    ['error result', encode([init, done('Failed', { is_error: true })]), {}],
    ['missing result', encode([init]), {}],
    ['malformed line', `${JSON.stringify(init)}\n{broken\n${JSON.stringify(done())}\n`, {}],
    ['non-zero exit', encode([init, done()]), { exitCode: 1 }],
    ['timeout', encode([init]), { timedOut: true }],
  ]) assert.equal((await adapter(output, result).run({ sessionId: name === 'missing session' ? null : session, prompt: 'x' })).outcome, 'failed', name);
  assert.equal((await adapter('', { cancelled: true, exitCode: null }).run({ sessionId: session, prompt: 'x' })).outcome, 'cancelled');
  assert.equal((await adapter(encode([init, done('DISPATCH_BLOCKED: Which policy?')])).run({ sessionId: session, prompt: 'x' })).outcome, 'blocked');
  let spawned = false;
  const large = await adapter('', {}, () => { spawned = true; }).run({ prompt: 'x'.repeat(130_000) });
  assert.equal(large.outcome, 'failed'); assert.equal(spawned, false);
});

test('Cursor capabilities read the JSON login status and models parse the CLI list', async () => {
  const replies = { '--version': { exitCode: 0, output: '2026.09.15-d2fe57e\n' }, status: { exitCode: 0, output: JSON.stringify({ status: 'unauthenticated', isAuthenticated: false }) } };
  const calls = [];
  const cursor = new CursorAdapter({ execute: async (command, args, options) => { calls.push([command, args, options.inheritEnv]); return replies[args[0]] ?? { exitCode: 0, output: '\x1b[2mAvailable models\x1b[22m\n\nauto - Auto\ngpt-5 - GPT-5 (current, default)\nsonnet-4.5\n\nTip: use --model <id> to switch.\n' }; } });
  assert.deepEqual(await cursor.capabilities(), { available: true, authenticated: false, version: '2026.09.15-d2fe57e', detail: 'Run cursor-agent login in your terminal, then refresh.' });
  replies.status.output = JSON.stringify({ status: 'authenticated', isAuthenticated: true });
  assert.equal((await cursor.capabilities()).authenticated, true);
  const { models } = await cursor.models();
  assert.deepEqual(models.map(model => [model.model, model.displayName, model.isDefault]), [['auto', 'Auto', false], ['gpt-5', 'GPT-5', true], ['sonnet-4.5', 'sonnet-4.5', false]]);
  assert.deepEqual(calls.map(([command, args, inherit]) => [command, args.join(' '), inherit]), [['cursor-agent', '--version', false], ['cursor-agent', 'status --format json', false], ['cursor-agent', '--version', false], ['cursor-agent', 'status --format json', false], ['cursor-agent', 'models', false]]);
  replies['--version'] = { exitCode: 127, output: '' };
  assert.equal((await cursor.capabilities()).available, false);
  assert.deepEqual(cursorModels('No models available for this account.'), []);
});
