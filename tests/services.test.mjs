import test from 'node:test';
import assert from 'node:assert/strict';
import { Services, serviceSettings } from '../src/services.mjs';
import { DispatchToolCalls } from '../src/tool-calls.mjs';
import { toolNames } from '../src/dispatch-tools.mjs';

const textOf = result => result.content[0].text;

function fakeProcess() {
  const started = [];
  const execute = (command, args, options) => {
    let finish; const exited = new Promise(resolve => { finish = resolve; });
    options.signal.addEventListener('abort', () => finish({ exitCode: 143 }), { once: true });
    started.push({ command, args, options });
    return exited;
  };
  return { started, execute };
}

test('services are short ids with a command, never app, and unique', () => {
  assert.deepEqual(serviceSettings([{ id: 'worker', command: 'npm', args: ['run', 'worker'] }]), [{ id: 'worker', command: 'npm', args: ['run', 'worker'] }]);
  for (const value of [[{ id: 'app', command: 'x' }], [{ id: 'Bad', command: 'x' }], [{ id: 'w', command: '' }], [{ id: 'w', command: 'x' }, { id: 'w', command: 'y' }], 'x']) assert.throws(() => serviceSettings(value), JSON.stringify(value));
});

test('a declared service starts outside the sandbox, streams its logs, and stops with the run', async () => {
  const { started, execute } = fakeProcess(), logged = [];
  const live = { log: (run, kind, message) => logged.push(message), devServerFor: async () => ({ logs: () => 'GET /api 500 boom' }), linked: { appTarget: () => ({ member: null }) } };
  const services = new Services(live, { execute });
  const run = { id: 'run-1', workspace: '/work', project: { services: [{ id: 'worker', command: 'npm', args: ['run', 'worker'] }] }, linked: [{ name: 'api', workspace: '/work-api', project: { services: [{ id: 'queue', command: 'node', args: ['queue.js'] }] } }] };
  assert.match(textOf(await services.call(run, { action: 'list' })), /worker: npm run worker \(stopped\)\napi:queue: node queue\.js \(stopped\)/);
  assert.match(textOf(await services.call(run, { action: 'start', service: 'worker' })), /Started worker/);
  assert.equal(started[0].options.cwd, '/work'); assert.equal(started[0].options.inheritEnv, false);
  started[0].options.onStdout('listening on 4000\n'); started[0].options.onStderr('warning: slow\n');
  assert.equal(textOf(await services.call(run, { action: 'logs', service: 'worker' })), 'listening on 4000\nwarning: slow\n');
  assert.match(textOf(await services.call(run, { action: 'start', service: 'worker' })), /already running/);
  await services.call(run, { action: 'start', service: 'api:queue' }); assert.equal(started[1].options.cwd, '/work-api');
  assert.equal(textOf(await services.call(run, { action: 'logs', service: 'app' })), 'GET /api 500 boom');
  await assert.rejects(services.call(run, { action: 'start', service: 'nope' }), /No service called nope/);
  await services.stopAll(run);
  assert.ok(started.every(item => item.options.signal.aborted));
  assert.match(textOf(await services.call(run, { action: 'logs', service: 'worker' })), /not running/);
});

test('dispatch_service is attached when the task has services or an app, never for answers', () => {
  const calls = new DispatchToolCalls({ services: {} });
  assert.equal(toolNames(calls.tools({ project: { memory: false } }, { questions: 'native' })).includes('dispatch_service'), false);
  assert.deepEqual(toolNames(calls.tools({ project: { memory: false, services: [{ id: 'w', command: 'x', args: [] }] } }, { questions: 'native' })), ['dispatch_service']);
  assert.deepEqual(toolNames(calls.tools({ kind: 'answer', project: { memory: false, services: [{ id: 'w', command: 'x', args: [] }] } }, { questions: 'native' })), []);
});

test('the form writes services as id: command lines', async () => {
  const { servicesPayload, serviceLine } = await import('../web/lib/project-form.mjs');
  assert.deepEqual(servicesPayload(['worker: npm run worker', '', '  mock:node mock.js --port 4001 ']), [{ id: 'worker', command: 'npm', args: ['run', 'worker'] }, { id: 'mock', command: 'node', args: ['mock.js', '--port', '4001'] }]);
  assert.equal(serviceLine({ id: 'worker', command: 'npm', args: ['run', 'worker'] }), 'worker: npm run worker');
});

test('a service of the task’s repository takes a snapshot when it starts and shows the task database’s changes when it stops', async () => {
  const { execute } = fakeProcess(), snapshots = [];
  const changes = { supported: () => true, baseline: async (run, since) => { snapshots.push(since); return true; }, changes: async () => ({ since: 'worker started', tables: [{ name: 'orders', inserted: 0, updated: 2, deleted: 0, columnsAdded: [], columnsRemoved: [], key: ['id'], columns: ['id'], rows: [] }] }) };
  const live = { log: () => {}, databaseChanges: changes, taskDatabases: { saved: () => ({ task: { id: 't' } }), env: () => ({}) } };
  const services = new Services(live, { execute });
  const run = { id: 'run-1', workspace: '/work', project: { services: [{ id: 'worker', command: 'npm', args: ['run', 'worker'] }] }, linked: [{ name: 'api', workspace: '/work-api', project: { services: [{ id: 'queue', command: 'node', args: ['queue.js'] }] } }] };
  assert.match(textOf(await services.call(run, { action: 'start', service: 'worker' })), /Stopping it shows what it changed/);
  await services.call(run, { action: 'start', service: 'api:queue' });
  assert.deepEqual(snapshots, ['worker started']);
  const stopped = await services.call(run, { action: 'stop', service: 'worker' });
  assert.match(textOf(stopped), /^Stopped worker\.[\s\S]*Database changes since worker started:\norders: ~2$/);
  assert.deepEqual([stopped.view.type, stopped.view.label, stopped.view.title], ['changes', 'Service', 'worker · stop']);
  assert.equal((await services.call(run, { action: 'stop', service: 'api:queue' })).view.type, 'log');
  changes.changes = async () => { throw new Error('psql missing'); };
  await services.call(run, { action: 'start', service: 'worker' });
  assert.match(textOf(await services.call(run, { action: 'stop', service: 'worker' })), /Could not read the task database's changes: psql missing/);
});
