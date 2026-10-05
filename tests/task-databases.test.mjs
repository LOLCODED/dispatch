import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Databases, databaseSettings } from '../src/database.mjs';
import { TaskDatabases } from '../src/task-databases.mjs';

const source = 'postgres://dev:secret@127.0.0.1:5432/app';
function fixture(t, perTask, { invoke = async () => ({}) } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-taskdb-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, 'checkout'), workspace = join(dir, 'live-workspaces', '0f9e8d7c-1234'); mkdirSync(checkout); mkdirSync(workspace, { recursive: true });
  for (const root of [checkout, workspace]) writeFileSync(join(root, '.env'), `DATABASE_URL=${source}\nLOG_LEVEL=info\n`);
  const project = { id: 'p1', repositoryPath: checkout, database: databaseSettings({ connection: { envFile: '.env', variables: ['DATABASE_URL'] }, perTask }) };
  const run = { id: 'r1', workspace, project }, logs = [], calls = [], live = { engine: { dataDir: dir, runs: [run] }, log: (_, kind, message) => logs.push(message), stopDevServer: async () => {}, connectors: { invoke: async (...args) => { calls.push(args); return invoke(...args); }, registry: { get: () => ({ name: 'Example' }), withHook: () => [] } } };
  live.databases = new Databases(live);
  return { dir, run, live, logs, calls };
}

test('the commands provider runs create with {task} and {port}, hands its variables to processes and the env file, and drop on release', async t => {
  const executed = [], execute = async (command, args, options) => { executed.push({ command, args, env: options.env }); return { exitCode: 0, output: 'ok' }; };
  const { run, live } = fixture(t, { provider: 'commands', create: 'docker run -d --name app-{task} -p {port}:5432 postgres:16', drop: 'docker rm -f app-{task}', env: 'DATABASE_URL=postgres://dev:secret@127.0.0.1:{port}/app', migrate: 'npm run db:migrate' });
  const databases = new TaskDatabases(live, { execute }); live.taskDatabases = databases;
  await databases.create(run);
  const port = databases.saved(run).port, created = executed.find(call => call.args.includes('run'));
  assert.ok(port > 0); assert.deepEqual(created.args, ['run', '-d', '--name', 'app-dispatch_task_0f9e8d7c1234', '-p', `${port}:5432`, 'postgres:16']); assert.equal(created.env.DATABASE_URL, source);
  assert.deepEqual(databases.env(run), { DATABASE_URL: `postgres://dev:secret@127.0.0.1:${port}/app` });
  assert.match(readFileSync(join(run.workspace, '.env'), 'utf8'), new RegExp(`DATABASE_URL=postgres://dev:secret@127.0.0.1:${port}/app\nLOG_LEVEL=info`));
  assert.equal(readFileSync(join(run.project.repositoryPath, '.env'), 'utf8').includes(String(port)), false);
  assert.equal(await databases.migrate(run), 'ok'); assert.equal(executed.at(-1).env.DATABASE_URL, `postgres://dev:secret@127.0.0.1:${port}/app`);
  await databases.release(run);
  assert.deepEqual(executed.at(-1).args, ['rm', '-f', 'app-dispatch_task_0f9e8d7c1234']); assert.deepEqual(databases.env(run), {});
});

test('a connector provider gets the task and the source connection, and a reset clones from the checkout, not the task copy', async t => {
  const { run, live, calls } = fixture(t, { provider: 'example' }, { invoke: async (project, id, hook) => hook === 'database.provision' ? { env: { DATABASE_URL: 'postgres://dev:secret@127.0.0.1:5432/dispatch_task_0f9e8d7c1234', 'bad name': 'x' } } : undefined });
  const databases = new TaskDatabases(live); live.taskDatabases = databases;
  await databases.create(run); await databases.call(run, { action: 'reset' });
  const provisions = calls.filter(call => call[2] === 'database.provision');
  assert.equal(provisions.length, 2); assert.deepEqual(provisions[1][3][0].env, { DATABASE_URL: source }); assert.deepEqual(provisions[0][3][0].task, { id: '0f9e8d7c1234', name: 'dispatch_task_0f9e8d7c1234' });
  assert.deepEqual(Object.keys(databases.env(run)), ['DATABASE_URL']);
  assert.equal(calls.filter(call => call[2] === 'database.release').length, 1);
  await assert.rejects(databases.migrate(run), /no migrate command/);
});

test('queries use the task database, and a task database whose worktree is gone is released by the next create', async t => {
  const { run, live, calls, dir } = fixture(t, { provider: 'example' }, { invoke: async (project, id, hook) => hook === 'database.provision' ? { env: { DATABASE_URL: 'postgres://task' } } : hook === 'database.query' ? { columns: ['a'], rows: [] } : undefined });
  const databases = new TaskDatabases(live); live.taskDatabases = databases; live.connectors.registry.withHook = () => [{ connector: { id: 'pg' } }];
  await databases.create(run);
  await live.databases.query(run, 'select 1');
  assert.deepEqual(calls.find(call => call[2] === 'database.query')[3][0].env, { DATABASE_URL: 'postgres://task' });
  run.worktreeRemovedAt = 'now';
  const next = { ...run, id: 'r2', workspace: join(dir, 'live-workspaces', 'aaaa'), worktreeRemovedAt: undefined }; mkdirSync(next.workspace); writeFileSync(join(next.workspace, '.env'), `DATABASE_URL=${source}\n`); live.engine.runs.push(next);
  await databases.create(next);
  assert.equal(calls.filter(call => call[2] === 'database.release').length, 1); assert.equal(existsSync(databases.path(run)), false);
});
