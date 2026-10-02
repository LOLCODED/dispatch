import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createConnector from '../index.mjs';

const has = (args, ...words) => words.every(word => args.includes(word));
const pr = { number: 3, url: 'https://github.com/example/repo/pull/3', state: 'OPEN', headRefOid: 'head123' };
const checkRuns = checks => JSON.stringify({ total: checks.length, checks });
const change = (extra = {}) => ({ id: 'r1', title: 'Fix it', workspace: '/tmp/ws', branch: 'dispatch/r1', baseBranch: 'main', base: 'main', headSha: 'head123', delivery: { remote: 'origin', headSha: 'head123', pushedAt: '2026-01-01T00:00:00Z', pr: null }, ...extra });

function happy(command, args, bodies) {
  if (command === 'git' && has(args, 'remote', 'get-url')) return { output: 'git@github.com:example/repo.git\n' };
  if (has(args, 'pr', 'list')) return { output: '[]' };
  if (has(args, 'pr', 'create') || has(args, 'pr', 'edit')) { bodies.push(readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')); return { output: 'https://github.com/example/repo/pull/7\n' }; }
  if (has(args, 'repo', 'view')) return { output: 'example/repo\n' };
  if (has(args, 'api')) return { output: checkRuns([{ name: 'ci', status: 'completed', conclusion: 'success' }]) };
  return {};
}

// The dispatch object a connector receives, faked: a recorded runProcess and git that fails the way dispatch's does.
function github(script = () => undefined) {
  const calls = [], bodies = [], remembered = [];
  const runProcess = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    return { exitCode: 0, output: '', timedOut: false, cancelled: false, ...(await script(command, args, calls) ?? happy(command, args, bodies)) };
  };
  const git = async (cwd, args, options = {}) => {
    const result = await runProcess('git', args, { cwd, ...options });
    if (result.exitCode !== 0 || result.timedOut || result.cancelled) throw Object.assign(new Error(`Git ${args[0]} failed: ${result.output}`), { result });
    return result.output.trimEnd();
  };
  const connector = createConnector({ runProcess, git, localEnvironment: extra => ({ PATH: '/usr/bin', ...extra }), plainText: text => text, describeChange: item => ({ title: item.title, body: `Body for ${item.title}` }) });
  const hook = name => Object.values(connector.actions).find(action => action.hooks[name]).hooks[name];
  const ctx = ({ memory = {}, settings = {} } = {}) => ({ settings: { remote: 'origin', draft: true, ...settings }, memory, remember: values => remembered.push(values) });
  return { connector, hook, ctx, calls, bodies, remembered, gh: () => calls.filter(call => call.command === 'gh'), pushes: () => calls.filter(call => call.command === 'git' && has(call.args, 'push')) };
}
const cached = { memory: { repository: { remote: 'origin', nameWithOwner: 'example/repo' } } };

test('declares its actions, settings and mark so dispatch can switch each one off', () => {
  const { connector } = github();
  assert.deepEqual(Object.entries(connector.actions).map(([id, action]) => [id, action.access, Object.keys(action.hooks)]), [
    ['push', 'write', ['delivery.push']], ['openPullRequest', 'write', ['delivery.openPullRequest', 'delivery.describe']],
    ['readPullRequests', 'read', ['delivery.findPullRequest', 'delivery.reviews']], ['readChecks', 'read', ['delivery.checks', 'delivery.checkLogs']],
  ]);
  assert.deepEqual(Object.entries(connector.settings).map(([key, setting]) => [key, setting.type, setting.default]), [['remote', 'string', 'origin'], ['draft', 'boolean', true]]);
  assert.match(connector.icon, /^M12/);
});

test('push sends only the task branch to the configured remote, without force', async () => {
  const double = github();
  assert.deepEqual(await double.hook('delivery.push')(change(), double.ctx({ settings: { remote: 'upstream' } })), { remote: 'upstream' });
  const [push] = double.pushes();
  assert.deepEqual(push.args, ['push', 'upstream', 'HEAD:refs/heads/dispatch/r1']); assert.equal(push.options.timeoutMs, 120000);
});

test('push timeout, cancellation and rejection fail with their kind after one attempt; a transient failure is retried once', async () => {
  for (const [override, kind] of [[{ exitCode: null, timedOut: true }, 'timeout'], [{ exitCode: null, cancelled: true }, 'cancelled'], [{ exitCode: 1, output: ' ! [rejected] dispatch/r1 -> dispatch/r1 (non-fast-forward)' }, 'rejected']]) {
    const double = github((command, args) => { if (command === 'git' && has(args, 'push')) return override; });
    await assert.rejects(double.hook('delivery.push')(change(), double.ctx()), error => error.kind === kind);
    assert.equal(double.pushes().length, 1);
  }
  let failures = 0;
  const flaky = github((command, args) => { if (command === 'git' && has(args, 'push') && failures++ === 0) return { exitCode: 128, output: 'fatal: unable to access https://github.com/x: Could not resolve host' }; });
  await flaky.hook('delivery.push')(change(), flaky.ctx()); assert.equal(flaky.pushes().length, 2);
  const dead = github((command, args) => { if (command === 'git' && has(args, 'push')) return { exitCode: 128, output: 'fatal: Could not read from remote repository.' }; });
  await assert.rejects(dead.hook('delivery.push')(change(), dead.ctx()), error => error.kind === 'failed'); assert.equal(dead.pushes().length, 2);
});

test('opens a draft pull request with the described title and body, or a ready one when draft is off', async () => {
  const double = github();
  const opened = await double.hook('delivery.openPullRequest')(change({ base: 'staging' }), double.ctx());
  assert.deepEqual(opened, { number: 7, url: 'https://github.com/example/repo/pull/7', state: 'OPEN', headRefOid: 'head123', reused: false });
  const create = double.gh().find(call => has(call.args, 'pr', 'create'));
  assert.ok(has(create.args, '--draft', '--head', 'dispatch/r1', '--base', 'staging', '--title=Fix it')); assert.equal(create.options.cwd, '/tmp/ws'); assert.equal(create.options.inheritEnv, false);
  assert.equal(create.options.env.GH_PROMPT_DISABLED, '1'); assert.deepEqual(double.bodies, ['Body for Fix it']);
  const ready = github(); await ready.hook('delivery.openPullRequest')(change(), ready.ctx({ settings: { draft: false } }));
  assert.ok(!ready.gh().find(call => has(call.args, 'pr', 'create')).args.includes('--draft'));
  const edited = github(); await edited.hook('delivery.describe')(change({ delivery: { pr } }), edited.ctx());
  assert.deepEqual(edited.gh()[0].args.slice(0, 3), ['pr', 'edit', pr.url]); assert.deepEqual(edited.bodies, ['Body for Fix it']);
});

test('finds the branch’s open pull request first and reads its review state', async () => {
  const double = github((command, args) => { if (has(args, 'pr', 'list')) return { output: JSON.stringify([{ ...pr, state: 'MERGED' }, { ...pr, state: 'OPEN', baseRefName: 'main', reviewDecision: 'CHANGES_REQUESTED', mergeable: 'CONFLICTING', latestReviews: [{ state: 'CHANGES_REQUESTED', submittedAt: '2026-01-02T00:00:00Z' }] }]) }; });
  assert.deepEqual(await double.hook('delivery.findPullRequest')(change(), double.ctx()), { number: 3, url: pr.url, state: 'OPEN', headRefOid: 'head123', reused: true, baseRefName: 'main', reviewDecision: 'CHANGES_REQUESTED', mergeable: 'CONFLICTING', changesRequestedAt: '2026-01-02T00:00:00Z' });
  assert.equal(await github().hook('delivery.findPullRequest')(change(), github().ctx()), null);
  const invalid = github((command, args) => { if (has(args, 'pr', 'list')) return { output: 'not json' }; });
  await assert.rejects(invalid.hook('delivery.findPullRequest')(change(), invalid.ctx()), /invalid pull request list/);
});

test('gh missing, not logged in and rate limited are classified', async () => {
  for (const [override, kind] of [[{ exitCode: -2, output: 'spawn gh ENOENT' }, 'unavailable'], [{ exitCode: 1, output: 'You are not logged into any GitHub hosts. To log in, run: gh auth login' }, 'unauthenticated'], [{ exitCode: 1, output: 'gh: API rate limit exceeded for user (HTTP 403)' }, 'rate-limited'], [{ exitCode: 1, output: 'gh: HTTP 429: too many requests' }, 'rate-limited']]) {
    const double = github((command, args) => { if (command === 'gh' && has(args, 'pr', 'list')) return override; });
    await assert.rejects(double.hook('delivery.findPullRequest')(change(), double.ctx()), error => error.kind === kind);
  }
});

test('checks read the delivered head’s check runs and remember the repository for the remote', async () => {
  const double = github();
  assert.deepEqual(await double.hook('delivery.checks')(change(), double.ctx()), [{ id: null, app: null, name: 'ci', status: 'completed', conclusion: 'success' }]);
  assert.equal(double.gh().find(call => has(call.args, 'api')).args[1], 'repos/example/repo/commits/head123/check-runs');
  assert.deepEqual(double.remembered, [{ repository: { remote: 'origin', nameWithOwner: 'example/repo' } }]);
  const known = github(); await known.hook('delivery.checks')(change(), known.ctx(cached));
  assert.ok(!known.calls.some(call => has(call.args, 'repo', 'view') || has(call.args, 'get-url')));
  const invalid = github((command, args) => { if (has(args, 'api')) return { output: 'not json' }; });
  await assert.rejects(invalid.hook('delivery.checks')(change(), invalid.ctx(cached)), /invalid check-run data/);
});

test('failing logs come from the Actions job or the check-run output, and an unreadable one becomes a note', async () => {
  const double = github((command, args) => {
    if (has(args, 'repos/example/repo/actions/jobs/11/logs')) return { output: 'Error: expected 2 to be 3' };
    if (has(args, 'repos/example/repo/check-runs/12')) return { exitCode: 1, output: 'HTTP 404' };
  });
  const logs = await double.hook('delivery.checkLogs')(change(), [{ id: 11, app: 'github-actions', name: 'unit', conclusion: 'failure' }, { id: 12, app: 'circleci', name: 'lint', conclusion: 'timed_out' }, { id: null, name: 'other', conclusion: 'failure' }], double.ctx(cached));
  assert.deepEqual(logs.map(item => item.name), ['unit', 'lint', 'other']); assert.match(logs[0].log, /expected 2 to be 3/); assert.match(logs[1].log, /Log unavailable/); assert.match(logs[2].log, /No check-run id/);
});

test('reviews return written feedback and leave approvals out', async () => {
  const double = github((command, args) => {
    if (args.some(arg => String(arg).includes('/pulls/3/reviews'))) return { output: JSON.stringify([{ author: 'a', state: 'APPROVED', body: 'ok', at: '2026-01-02' }, { author: 'b', state: 'CHANGES_REQUESTED', body: 'Rename it', at: '2026-01-02' }, { author: 'c', state: 'COMMENTED', body: '', at: '2026-01-02' }]) };
    if (args.some(arg => String(arg).includes('/pulls/3/comments'))) return { output: JSON.stringify([{ author: 'b', path: 'a.js', line: 4, body: 'Typo', at: '2026-01-02' }]) };
  });
  const items = await double.hook('delivery.reviews')(change({ delivery: { remote: 'origin', pr } }), double.ctx(cached));
  assert.deepEqual(items.map(item => item.body), ['Rename it', 'Typo']);
});

test('status reports a missing, logged-out or ready GitHub CLI', async () => {
  assert.equal((await github((command, args) => { if (has(args, '--version')) return { exitCode: -2, output: 'spawn gh ENOENT' }; }).connector.status()).available, false);
  const loggedOut = await github((command, args) => has(args, '--version') ? { output: 'gh version 2.0.0\n' } : { exitCode: 1, output: 'not logged in' }).connector.status();
  assert.deepEqual([loggedOut.available, loggedOut.authenticated, loggedOut.version], [true, false, 'gh version 2.0.0']);
  const ready = github((command, args) => ({ output: has(args, '--version') ? 'gh version 2.0.0\n' : 'Logged in' }));
  assert.equal((await ready.connector.status()).authenticated, true); assert.deepEqual(ready.calls.map(call => call.args), [['--version'], ['auth', 'status']]);
});
