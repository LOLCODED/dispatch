import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { runAppServer } from '../src/codex-app-server.mjs';

function transport(handle, inspect = () => {}) {
  return (command, args, options) => {
    inspect(command, args, options);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let stopped = false;
    child.kill = () => { if (!stopped) { stopped = true; queueMicrotask(() => child.emit('close', 0)); } };
    const emit = value => { const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value) + '\n'); for (let i = 0; i < bytes.length; i += 7) child.stdout.write(bytes.subarray(i, i + 7)); };
    child.stdin = new Writable({ write(chunk, encoding, callback) { for (const line of chunk.toString().trim().split('\n')) { const request = JSON.parse(line); queueMicrotask(() => { if (!stopped) handle(request, emit, child); }); } callback(); } });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
}
function basic(request, emit, turn = () => {}) {
  if (request.method === 'initialize') emit({ id: request.id, result: {} });
  if (['thread/start', 'thread/resume'].includes(request.method)) emit({ id: request.id, result: { thread: { id: 'session-1' }, model: 'configured-model', reasoningEffort: null } });
  if (request.method === 'turn/start') { emit({ id: request.id, result: { turn: { id: 'turn-1' } } }); emit({ method: 'turn/started', params: { threadId: 'session-1', turn: { id: 'turn-1' } } }); turn(request, emit); }
}
const complete = emit => { emit({ method: 'item/completed', params: { threadId: 'session-1', turnId: 'turn-1', item: { id: 'message', type: 'agentMessage', text: 'Done ✓' } } }); emit({ method: 'turn/completed', params: { threadId: 'session-1', turn: { id: 'turn-1', status: 'completed' } } }); };
test('native worker resumes explicitly, decodes UTF-8, streams text and reports only provider usage', async () => {
  const events = [], progress = [], seen = [];
  const spawnProcess = transport((request, emit) => {
    seen.push(request);
    basic(request, emit, (request, emit) => {
      emit({ method: 'item/agentMessage/delta', params: { threadId: 'session-1', turnId: 'turn-1', itemId: 'message', delta: 'Thinking ✓' } });
      emit({ method: 'thread/tokenUsage/updated', params: { threadId: 'session-1', turnId: 'turn-1', tokenUsage: { last: { inputTokens: 10, cachedInputTokens: 3, outputTokens: 2 }, total: { inputTokens: 10, cachedInputTokens: 3, outputTokens: 2 } } } }); complete(emit);
    });
  });
  const result = await runAppServer({ workspace: '/tmp', sessionId: 'session-1', prompt: 'literal $(text)', spawnProcess, onEvent: (...args) => events.push(args), onProgress: message => progress.push(message) });
  assert.equal(result.outcome, 'completed'); assert.equal(result.summary, 'Done ✓'); assert.deepEqual([result.usage.input_tokens, result.usage.cached_input_tokens, result.usage.output_tokens], [10, 3, 2]); assert.ok(progress.includes('Thinking ✓'));
  assert.equal(seen.find(request => request.method === 'thread/resume').params.threadId, 'session-1'); assert.equal(seen.find(request => request.method === 'turn/start').params.input[0].text, 'literal $(text)');
});
test('owner turns stay in the workspace sandbox, decline native escalation and grant no unknown tools', async () => {
  let denied = false, refused = false;
  const spawnProcess = transport((request, emit) => {
    if (request.method === 'thread/start') assert.equal(request.params.dynamicTools, undefined);
    basic(request, emit, () => {
      assert.equal(request.params.sandboxPolicy.type, 'workspaceWrite'); assert.equal(request.params.approvalPolicy, 'never');
      emit({ id: 'approve-1', method: 'item/fileChange/requestApproval', params: { threadId: 'session-1', turnId: 'turn-1' } });
    });
    if (request.id === 'approve-1') { assert.equal(request.result.decision, 'decline'); denied = true; emit({ id: 'tool-1', method: 'item/tool/call', params: { threadId: 'session-1', turnId: 'turn-1', tool: 'dispatch_workspace', arguments: { operation: 'propose' } } }); }
    if (request.id === 'tool-1') { assert.equal(request.error.code, -32601); refused = true; complete(emit); }
  }, (command, args) => { assert.ok(args.includes('sandbox_mode="workspace-write"')); assert.ok(args.includes('features.multi_agent=false')); });
  const result = await runAppServer({ workspace: '/tmp', prompt: 'task', spawnProcess });
  assert.equal(result.outcome, 'completed'); assert.ok(denied && refused); assert.equal(result.usage, null);
});
test('native transport fails closed on malformed output, wrong session, failed turn and early exit', async () => {
  for (const kind of ['malformed', 'session', 'failed', 'exit']) {
    const spawnProcess = transport((request, emit, child) => {
      if (kind === 'session' && request.method === 'thread/resume') { emit({ id: request.id, result: { thread: { id: 'wrong' } } }); return; }
      basic(request, emit, () => {
        if (kind === 'malformed') emit('{invalid\n');
        if (kind === 'failed') emit({ method: 'turn/completed', params: { threadId: 'session-1', turn: { id: 'turn-1', status: 'failed', error: { message: 'Failed' } } } });
        if (kind === 'exit') child.kill();
      });
    });
    assert.equal((await runAppServer({ workspace: '/tmp', sessionId: 'session-1', prompt: 'task', spawnProcess })).outcome, 'failed', kind);
  }
});
test('abort stops a native turn without accepting a later result', async () => {
  const controller = new AbortController();
  const result = await runAppServer({ workspace: '/tmp', signal: controller.signal, prompt: 'task', spawnProcess: transport((request, emit) => basic(request, emit, () => controller.abort())) });
  assert.equal(result.outcome, 'cancelled');
});

test('a completed notification while a question is pending fails closed', async () => {
  const result = await runAppServer({ workspace: '/tmp', prompt: 'task', spawnProcess: transport((request, emit) => basic(request, emit, () => {
    emit({ id: 'question-1', method: 'item/tool/requestUserInput', params: { threadId: 'session-1', turnId: 'turn-1', questions: [{ id: 'scope', question: 'Which scope?' }] } });
    complete(emit);
  })), onQuestion: () => new Promise(() => {}) });
  assert.equal(result.outcome, 'failed'); assert.match(result.summary, /premature/);
});

test('resumed native turns retain the snapshotted model and reasoning level', async () => {
  const seen = [];
  const execution = { model: 'test-sol', effort: 'high' };
  const result = await runAppServer({ workspace: '/tmp', sessionId: 'session-1', prompt: 'Continue', execution, spawnProcess: transport((request, emit) => {
    seen.push(request); basic(request, emit, () => complete(emit));
  }) });
  assert.equal(result.outcome, 'completed');
  const thread = seen.find(request => request.method === 'thread/resume').params;
  assert.equal(thread.model, execution.model); assert.equal(thread.config.model_reasoning_effort, execution.effort);
  const turn = seen.find(request => request.method === 'turn/start').params;
  assert.equal(turn.model, execution.model); assert.equal(turn.effort, execution.effort); assert.equal(turn.collaborationMode, undefined);
});

test('native browser tool images reach the viewport callback without entering text logs', async () => {
  const observed = [], events = [];
  const image = { type: 'image', mimeType: 'image/png', data: 'secret-image-bytes' };
  const result = await runAppServer({ workspace: '/tmp', prompt: 'browser', onBrowser: value => observed.push(value), onEvent: (...args) => events.push(args), spawnProcess: transport((request, emit) => basic(request, emit, () => {
    emit({ method: 'item/started', params: { threadId: 'session-1', item: { id: 'browser-0', type: 'mcpToolCall', server: 'playwright', tool: 'browser_mouse_click_xy', arguments: { x: 5.4, y: 9 } } } });
    emit({ method: 'item/started', params: { threadId: 'session-1', item: { id: 'browser-1', type: 'mcpToolCall', server: 'browser', tool: 'take_screenshot' } } });
    emit({ method: 'item/completed', params: { threadId: 'session-1', item: { id: 'browser-1', type: 'mcpToolCall', server: 'browser', tool: 'take_screenshot', status: 'completed', result: { content: [image, { type: 'text', text: 'Screenshot captured' }] } } } });
    complete(emit);
  })) });
  assert.equal(result.outcome, 'completed'); assert.equal(observed[0].phase, 'started'); assert.deepEqual(observed[0].pointer, { x: 5, y: 9, action: 'click' }); assert.deepEqual(observed[2].images, [image]); assert.doesNotMatch(JSON.stringify(events), /secret-image-bytes/); assert.match(JSON.stringify(events), /Screenshot captured/);
});

const tokens = (input, cached, output) => ({ inputTokens: input, cachedInputTokens: cached, outputTokens: output });
function usageTurn(updates) {
  return runAppServer({ workspace: '/tmp', sessionId: 'session-1', prompt: 'task', spawnProcess: transport((request, emit) => basic(request, emit, () => {
    for (const tokenUsage of updates) emit({ method: 'thread/tokenUsage/updated', params: { threadId: 'session-1', turnId: 'turn-1', tokenUsage } });
    complete(emit);
  })) });
}
const counts = usage => [usage?.input_tokens, usage?.cached_input_tokens, usage?.output_tokens];
test('native usage is the per-turn delta of cumulative thread totals and records last and total', async () => {
  const single = await usageTurn([{ last: tokens(10, 4, 2), total: tokens(10, 4, 2) }]);
  assert.deepEqual(counts(single.usage), [10, 4, 2]);
  const repair = await usageTurn([{ last: tokens(30, 20, 5), total: tokens(130, 60, 15) }, { last: tokens(40, 30, 6), total: tokens(170, 90, 21) }]);
  assert.deepEqual(counts(repair.usage), [70, 50, 11]);
  assert.deepEqual(repair.usage.last, { input_tokens: 40, cached_input_tokens: 30, output_tokens: 6 });
  assert.deepEqual(repair.usage.total, { input_tokens: 170, cached_input_tokens: 90, output_tokens: 21 });
  const missing = await usageTurn([{ last: { inputTokens: 5 }, total: { inputTokens: 105, outputTokens: 7 } }]);
  assert.deepEqual(counts(missing.usage), [5, null, null]);
  assert.deepEqual(counts((await usageTurn([{ last: tokens(5, 0, 1) }])).usage), [null, null, null]);
});


test('sandbox write roots add to the worktree; full access asks Codex for no sandbox', async () => {
  const seen = [];
  const spawned = [];
  const run = options => runAppServer({ workspace: '/tmp/work', prompt: 'task', spawnProcess: transport((request, emit) => { seen.push(request); basic(request, emit, () => complete(emit)); }, (command, args) => spawned.push(args)), ...options });
  assert.equal((await run({ writableRoots: ['/home/me'] })).outcome, 'completed');
  const policy = seen.find(request => request.method === 'turn/start').params.sandboxPolicy;
  assert.deepEqual(policy.writableRoots, ['/tmp/work', '/home/me']); assert.equal(policy.networkAccess, false);
  seen.length = 0;
  assert.equal((await run({ fullAccess: true })).outcome, 'completed');
  assert.equal(seen.find(request => request.method === 'thread/start').params.sandbox, 'danger-full-access');
  assert.deepEqual(seen.find(request => request.method === 'turn/start').params.sandboxPolicy, { type: 'dangerFullAccess' });
  assert.ok(spawned[1].includes('sandbox_mode="danger-full-access"'));
});
