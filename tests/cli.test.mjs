import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.mjs';
import { liveFixture, temporaryRepository, unitCheck } from './live-double.mjs';
import { rmSync } from 'node:fs';

const cli = fileURLToPath(new URL('../bin/dispatch.mjs', import.meta.url));
const run = (args, { input = '', ...options } = {}) => {
  const pending = promisify(execFile)(process.execPath, [cli, ...args], options);
  pending.child.stdin.end(input);
  return pending.catch(error => error);
};

test('the CLI saves a task for the repository containing the working directory and lists it', async t => {
  const { engine, repo, project } = await liveFixture(t);
  const server = createServer(engine); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { ...process.env, DISPATCH_URL: `http://127.0.0.1:${server.address().port}` };
  const saved = await run(['add', 'Fix the header', 'spacing'], { cwd: repo, env });
  assert.match(saved.stdout, /Saved to .*: Fix the header spacing/);
  assert.deepEqual(engine.store.state.tasks.map(task => [task.projectId, task.input, task.kind]), [[project.id, 'Fix the header spacing', 'change']]);
  assert.equal(engine.runs.length, 0);
  const listed = await run(['tasks'], { cwd: repo, env });
  assert.match(listed.stdout, /saved\s+.*Fix the header spacing/);
});

test('the CLI saves a task for several repositories or lets the agent decide', async t => {
  const { engine, live, repo, project } = await liveFixture(t);
  const second = await temporaryRepository('dispatch-cli-second-'); t.after(() => rmSync(second.dir, { recursive: true, force: true }));
  const other = await live.saveProject({ repositoryPath: second.repo, name: 'api', baseBranch: 'main', confirmed: true, validation: [unitCheck] });
  const server = createServer(engine); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { ...process.env, DISPATCH_URL: `http://127.0.0.1:${server.address().port}` };
  const both = await run(['add', '--repo', `api,${repo}`, 'Change both'], { cwd: repo, env });
  assert.match(both.stdout, /Saved to api, .*: Change both/);
  const agent = await run(['add', '--repo', 'all', 'Change whatever'], { cwd: repo, env });
  assert.match(agent.stdout, /Saved \(agent decides\): Change whatever/);
  assert.deepEqual(engine.store.state.tasks.map(task => [task.projectId, task.projectIds ?? null]), [[project.id, 'all'], [other.id, [other.id, project.id]]]);
  const missing = await run(['add', '--repo', 'api,missing', 'Change'], { cwd: repo, env });
  assert.equal(missing.code, 1); assert.match(missing.stderr, /No saved repository matches "missing"/);
});

test('the CLI explains a stopped server and missing instructions without a stack trace', async () => {
  const env = { ...process.env, DISPATCH_URL: 'http://127.0.0.1:9' };
  const stopped = await run(['tasks'], { env });
  assert.equal(stopped.code, 1); assert.match(stopped.stderr, /not running at http:\/\/127\.0\.0\.1:9/);
  const empty = await run(['add'], { env });
  assert.equal(empty.code, 1); assert.match(empty.stderr, /instructions/);
  const help = await run(['--help'], { env });
  assert.match(help.stdout, /dispatch add/);
});
