import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeConnector, validateConnector } from '../src/connectors/contract.mjs';
import { ConnectorRegistry } from '../src/connectors/registry.mjs';
import { globalConnectorSettings, permitted, projectConnectors, updateGlobal } from '../src/connectors/settings.mjs';
import { ConnectorPlugins, connectorEntry, loadConnector } from '../src/connectors/plugins.mjs';
import { ConnectorDisabledError, ConnectorNotPermitted, ConnectorService } from '../src/connectors/service.mjs';
import { connectorApi } from '../src/connectors/api.mjs';
import { exampleOn, exampleTracker, issueUrl, trackerOrigin } from './tracker-double.mjs';
import { forgeDouble } from './forge-double.mjs';
import { builtinFolders } from '../src/connectors/builtin.mjs';

const storeDouble = (state = {}) => ({ state, saves: 0, save() { this.saves++; } });
const minimal = (id, extra = {}) => ({ id, name: `Folder ${id}`, actions: { read: { label: 'Read', access: 'read', hooks: { 'ticket.detect': () => null, 'ticket.read': async ref => ref } } }, ...extra });
const service = (connectors, state = {}) => new ConnectorService({ registry: new ConnectorRegistry(connectors), store: storeDouble(state) });
function folder(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-connector-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) { mkdirSync(join(dir, name, '..'), { recursive: true }); writeFileSync(join(dir, name), text); }
  return dir;
}
const source = id => `export default dispatch => ({ id: '${id}', name: 'Folder ${id}', api: Object.keys(dispatch), actions: { read: { label: 'Read', access: 'read', hooks: { 'ticket.detect': () => null, 'ticket.read': async ref => ref } } } });\n`;

test('the contract validates ids, actions, hooks and settings', () => {
  assert.equal(validateConnector(minimal('plain')).id, 'plain');
  const bad = [null, minimal('text'), minimal('Bad-Id'), { ...minimal('ok'), name: '' }, { ...minimal('ok'), actions: {} },
    minimal('ok', { actions: { read: { label: 'Read', access: 'admin', hooks: { 'ticket.read': () => {} } } } }),
    minimal('ok', { actions: { read: { label: 'Read', access: 'read', hooks: { 'ticket.unknown': () => {} } } } }),
    minimal('ok', { actions: { read: { label: 'Read', access: 'read', hooks: { 'ticket.read': 'yes' } } } }),
    minimal('ok', { actions: { read: { label: 'Read', access: 'read', hooks: { 'ticket.read': () => {} } } } }),
    minimal('ok', { actions: { a: { label: 'A', access: 'read', hooks: { 'run.ready': () => {} } }, b: { label: 'B', access: 'write', hooks: { 'run.ready': () => {} } } } }),
    minimal('ok', { actions: { push: { label: 'PR', access: 'write', hooks: { 'delivery.openPullRequest': () => {} } } } }),
    minimal('ok', { settings: { remote: { label: 'Remote', type: 'number' } } }), minimal('ok', { settings: { remote: { label: 'Remote', type: 'string', pattern: '(' } } })];
  for (const connector of bad) assert.throws(() => validateConnector(connector));
  assert.deepEqual(describeConnector(exampleTracker().connector).actions.map(action => [action.id, action.access]), [['read', 'read'], ['comment', 'write'], ['state', 'write'], ['notify', 'write']]);
  const forge = describeConnector(forgeDouble().connector, { builtIn: true });
  assert.deepEqual([forge.builtIn, forge.delivers, forge.tickets, forge.icon, forge.settings.map(setting => [setting.key, setting.default])], [true, true, false, null, [['remote', 'origin'], ['draft', true]]]);
  assert.equal(describeConnector(minimal('marked', { icon: 'M0 0h24v24H0z' })).icon, 'M0 0h24v24H0z');
  assert.throws(() => validateConnector(minimal('marked', { icon: '<script>' })), /icon/);
});

test('the registry finds hooks by action and protects built-in connectors', () => {
  const tracker = exampleTracker(), registry = new ConnectorRegistry([tracker.connector], { builtIn: [forgeDouble().connector] });
  assert.deepEqual(registry.ids(), ['forge', 'example']);
  assert.equal(registry.hook('example', 'ticket.comment').action, 'comment'); assert.equal(registry.hook('example', 'delivery.push'), null);
  assert.deepEqual(registry.withHook('delivery.push').map(found => found.connector.id), ['forge']);
  assert.throws(() => registry.add(exampleTracker().connector), /already loaded/); assert.throws(() => registry.remove('forge'), /built in/);
  registry.remove('example'); assert.deepEqual(registry.ids(), ['forge']);
});

test('repository settings keep unloaded connectors, drop unknown actions and validate declared settings', () => {
  const registry = new ConnectorRegistry([forgeDouble().connector]);
  assert.deepEqual(projectConnectors({ forge: { enabled: true, actions: { push: true, gone: true }, settings: { remote: 'upstream', draft: false } } }, registry), { forge: { enabled: true, actions: { push: true }, settings: { remote: 'upstream', draft: false } } });
  assert.deepEqual(projectConnectors({ jira: { enabled: true, actions: { read: false }, settings: { site: 'x' } } }, registry).jira, { enabled: true, actions: { read: false }, settings: { site: 'x' } });
  assert.deepEqual(projectConnectors({ forge: {} }, registry).forge, { enabled: false, actions: {}, settings: {} });
  assert.deepEqual(projectConnectors({ forge: true, jira: false }, registry), { forge: { enabled: true, actions: {}, settings: {} }, jira: { enabled: false, actions: {}, settings: {} } });
  for (const value of [null, [], { 'Bad-Key': {} }, { forge: 'yes' }, { forge: { enabled: 'yes' } }, { forge: { settings: { remote: 'a'.repeat(201) } } }, { forge: { settings: { draft: 'no' } } }, { forge: { settings: { other: 'x' } } }, { forge: { extra: 1 } }, { forge: { actions: { push: 'yes' } } }]) assert.throws(() => projectConnectors(value, registry), undefined, JSON.stringify(value));
  const patterned = new ConnectorRegistry([minimal('strict', { settings: { site: { label: 'Site', type: 'string', pattern: '^[a-z]+$' } } })]);
  assert.throws(() => projectConnectors({ strict: { settings: { site: 'A B' } } }, patterned), /Site is not valid/);
});

test('every connector folder shipped with dispatch loads through the same loader as an added one', async t => {
  for (const folder of await builtinFolders()) assert.ok((await loadConnector(folder)).id, folder);
  const root = folder(t, { 'one/package.json': '{}', 'one/index.mjs': source('one'), 'notes/readme.md': 'x' });
  assert.deepEqual(await builtinFolders(root), [join(root, 'one')]);
});

test('actions resolve repository override, then global switch, then reads on and writes off', () => {
  const connector = exampleTracker().connector, project = { connectors: { example: { enabled: true, actions: { read: false } } } };
  assert.equal(permitted({}, {}, connector, 'read'), true); assert.equal(permitted({}, {}, connector, 'comment'), false);
  assert.equal(permitted(project, {}, connector, 'read'), false);
  const global = updateGlobal({}, connector, { actions: { comment: true } });
  assert.equal(permitted({}, global, connector, 'comment'), true); assert.equal(permitted(project, global, connector, 'comment'), true);
  assert.equal(permitted({ connectors: { example: { actions: { comment: false } } } }, global, connector, 'comment'), false);
  assert.equal(permitted({}, global, connector, 'missing'), false);
  assert.throws(() => updateGlobal({}, connector, { actions: { missing: true } }), /no action missing/); assert.throws(() => updateGlobal({}, null, {}), /Unknown/);
  assert.deepEqual(globalConnectorSettings({ forge: true, example: { enabled: false, actions: { comment: true, 'bad key': true } }, 'Bad-Id': true }), { forge: { enabled: true, actions: {} }, example: { enabled: false, actions: { comment: true } } });
});

test('intake detects without I/O, reads only through a repository that uses the connector and remembers per repository', async () => {
  const tracker = exampleTracker(), connectors = service([tracker.connector]), project = { id: 'p', connectors: exampleOn() };
  assert.equal(connectors.detect('EX-4', project), null);
  assert.throws(() => connectors.identify(issueUrl('web', 1), { connectors: {} }), error => error instanceof ConnectorDisabledError && error.tracker === 'example' && error.ref.id === '1');
  assert.throws(() => connectors.identify(issueUrl('web', 1), { connectors: { example: { enabled: true, actions: { read: false } } } }), ConnectorDisabledError);
  assert.throws(() => connectors.detect('https://tracker.example/nope', project), /Example Tracker/);
  assert.deepEqual(connectors.identify('Fix the header', project), { connector: 'text', identity: 'Fix the header', ref: null });
  const ticket = await connectors.intake(issueUrl('web', 12), project);
  assert.deepEqual([ticket.connector, ticket.tracker, ticket.key, ticket.reference, ticket.project, ticket.remember], ['example', 'example', 'example:12', 'EX-12', 'web', { organization: trackerOrigin }]);
  connectors.remember(project, 'example', ticket.remember);
  assert.deepEqual(connectors.detect('EX-4', project).ref, { tracker: 'example', organization: trackerOrigin, project: null, id: '4', sourceUrl: null });
  tracker.read = async () => ({ description: 'no title' });
  await assert.rejects(connectors.intake(issueUrl('web', 13), project), /without a title/);
  assert.equal((await service([]).intake('Pasted text', null)).connector, 'text');
});

test('hooks get settings, memory and a time limit, and refuse when their action is off', async () => {
  const seen = [], connector = minimal('slow', { settings: { site: { label: 'Site', type: 'string', default: 'a' } }, actions: { read: { label: 'Read', access: 'read', hooks: { 'ticket.detect': () => null, 'ticket.read': async (ref, ctx) => { seen.push(ctx); return new Promise(() => {}); } } }, write: { label: 'Write', access: 'write', hooks: { 'ticket.comment': async () => {} } } } });
  const connectors = new ConnectorService({ registry: new ConnectorRegistry([connector]), store: storeDouble(), timeoutMs: 20 }), project = { connectors: { slow: { enabled: true, settings: { site: 'b' } } }, connectorMemory: { slow: { seen: 1 } } };
  await assert.rejects(connectors.invoke(project, 'slow', 'ticket.read', [{}]), /did not answer ticket.read within/);
  assert.deepEqual([seen[0].settings, seen[0].memory], [{ site: 'b' }, { seen: 1 }]);
  await assert.rejects(connectors.invoke(project, 'slow', 'ticket.comment', [{}, 'x']), error => error instanceof ConnectorNotPermitted && /Write is switched off for Folder slow/.test(error.message));
  await assert.rejects(connectors.invoke(project, 'slow', 'ticket.states', []), /cannot ticket.states/);
});

test('status is probed only for connectors in use, fails closed, and the delivery connector is chosen per repository', async () => {
  let probes = 0;
  const tracker = exampleTracker({ status: async () => { probes++; throw new Error('boom'); } });
  const connectors = new ConnectorService({ registry: new ConnectorRegistry([tracker.connector, forgeDouble().connector]), store: storeDouble() });
  assert.equal((await connectors.status([])).example.enabled, false); assert.equal(probes, 0);
  const status = await connectors.status([{ connectors: { example: { enabled: true } } }]);
  assert.equal(status.example.available, false); assert.match(status.example.detail, /boom/); assert.equal(probes, 1);
  assert.deepEqual(await connectors.probe(minimal('plain')), { enabled: true, available: true, authenticated: true, detail: 'Loaded.' });
  assert.equal(connectors.deliveryConnector({}).id, 'forge');
  assert.equal(service([tracker.connector]).deliveryConnector({}), null);
});

test('run events reach only connectors the repository uses with the action switched on, and errors are logged', async () => {
  const tracker = exampleTracker(), logs = [];
  const connectors = new ConnectorService({ registry: new ConnectorRegistry([tracker.connector]), store: storeDouble(), log: (run, message) => logs.push(message) });
  const summary = { event: 'run.ready', run: { id: 'r1', title: 'Fix it' } };
  connectors.emit('run.ready', { project: { connectors: { example: { enabled: true } } } }, summary);
  connectors.emit('run.ready', { project: { connectors: exampleOn() } }, summary);
  connectors.emit('run.queued', { project: { connectors: exampleOn() } }, summary);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(tracker.events, [summary]); assert.notEqual(tracker.events[0], summary);
  tracker.notify = async () => { throw new Error('mail server down'); };
  connectors.emit('run.failed', { project: { connectors: exampleOn() } }, summary);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(logs, ['Example Tracker run.failed did not complete: mail server down']);
});

test('a connector folder loads through its manifest entry with the dispatch API', async t => {
  const dir = folder(t, { 'package.json': JSON.stringify({ dispatch: { connector: './lib/main.mjs' } }), 'lib/main.mjs': source('folder') });
  assert.equal(await connectorEntry(dir), join(dir, 'lib/main.mjs'));
  const connector = await loadConnector(dir);
  assert.equal(connector.id, 'folder'); assert.deepEqual(connector.api, Object.keys(connectorApi()));
  assert.ok((await connectorEntry(folder(t, { 'index.mjs': source('plain') }))).endsWith('index.mjs'));
  await assert.rejects(connectorEntry('relative/path'), /absolute/);
  await assert.rejects(connectorEntry(folder(t, { 'package.json': JSON.stringify({ dispatch: { connector: '../outside.mjs' } }) })), /inside its folder/);
  await assert.rejects(connectorEntry(folder(t, { 'package.json': '{' })), /not valid JSON/);
  await assert.rejects(connectorEntry(folder(t, {})), /No connector entry/);
  await assert.rejects(loadConnector(folder(t, { 'index.mjs': 'export const nope = 1;\n' })), /default createConnector/);
  await assert.rejects(loadConnector(folder(t, { 'index.mjs': "export default () => ({ id: 'x' });\n" })), /id must be/);
});

test('added connectors persist, reload at startup, report failures and remove cleanly', async t => {
  const good = folder(t, { 'index.mjs': source('alpha') }), store = storeDouble(), registry = new ConnectorRegistry();
  const plugins = new ConnectorPlugins(store, registry);
  const added = await plugins.add(good);
  assert.deepEqual([added.path, added.id, added.name, added.loaded, added.error, added.connector.actions.map(action => action.id)], [good, 'alpha', 'Folder alpha', true, null, ['read']]);
  assert.deepEqual(store.state.connectorPlugins, [{ path: good, id: 'alpha' }]); assert.equal(store.saves, 1);
  await assert.rejects(plugins.add(good), /already added/);
  await assert.rejects(plugins.add(folder(t, { 'index.mjs': source('alpha') })), /already loaded/);
  const missing = join(good, 'gone'), restarted = new ConnectorRegistry(), reloaded = new ConnectorPlugins(storeDouble({ connectorPlugins: [{ path: good, id: 'alpha' }, { path: missing }] }), restarted);
  await reloaded.loadAll();
  assert.deepEqual(restarted.ids(), ['alpha']); assert.match(reloaded.list().find(plugin => plugin.path === missing).error, /No connector entry/);
  assert.deepEqual(plugins.remove('alpha'), { path: good, id: 'alpha' });
  assert.deepEqual(registry.ids(), []); assert.deepEqual(store.state.connectorPlugins, []); assert.equal(plugins.remove('alpha'), null);
});

const toolConnector = (runs = []) => ({ id: 'box', name: 'Box', settings: { scope: { label: 'Scope', type: 'string', default: 'all' } }, actions: {
  look: { label: 'Look', access: 'read', tools: { list: { description: 'List things.', inputSchema: { type: 'object', properties: {} }, run: async (args, ctx) => { runs.push([args, ctx]); return { items: [] }; } } } },
  change: { label: 'Change', access: 'write', tools: { reset: { description: 'Reset things.', inputSchema: { type: 'object' }, run: async () => new Promise(() => {}) } } },
} });

test('connector actions may declare agent tools, named after the connector and validated like hooks', () => {
  assert.equal(validateConnector(toolConnector()).id, 'box');
  assert.deepEqual(describeConnector(toolConnector()).actions.map(action => [action.id, action.hooks, action.tools]), [['look', [], ['box_list']], ['change', [], ['box_reset']]]);
  const tool = { description: 'x', inputSchema: { type: 'object' }, run: () => {} };
  const bad = [{ ...toolConnector(), id: 'dispatch' },
    { ...toolConnector(), actions: { a: { label: 'A', access: 'read' } } },
    { ...toolConnector(), actions: { a: { label: 'A', access: 'read', tools: { 'Bad-Name': tool } } } },
    { ...toolConnector(), id: `b${'o'.repeat(30)}`, actions: { a: { label: 'A', access: 'read', tools: { [`t${'x'.repeat(16)}`]: tool } } } },
    { ...toolConnector(), actions: { a: { label: 'A', access: 'read', tools: { t: { ...tool, run: 'no' } } } } },
    { ...toolConnector(), actions: { a: { label: 'A', access: 'read', tools: { t: { ...tool, description: '' } } } } },
    { ...toolConnector(), actions: { a: { label: 'A', access: 'read', tools: { t: { ...tool, inputSchema: { type: 'string' } } } } } },
    { ...toolConnector(), actions: { a: { label: 'A', access: 'read', tools: { t: tool } }, b: { label: 'B', access: 'write', tools: { t: tool } } } }];
  for (const connector of bad) assert.throws(() => validateConnector(connector));
});

test('agent tools reach only repositories that use the connector, honour action switches and read-only turns, and get the workspace', async () => {
  const runs = [], connectors = new ConnectorService({ registry: new ConnectorRegistry([toolConnector(runs)]), store: storeDouble(), timeoutMs: 20 });
  const project = { connectors: { box: { enabled: true, settings: { scope: 'mine' } } } }, writable = { connectors: { box: { enabled: true, actions: { change: true } } } };
  assert.deepEqual(connectors.agentTools({ connectors: {} }), []);
  assert.deepEqual(connectors.agentTools(project).map(tool => [tool.name, tool.kind]), [['box_list', 'connector']]);
  assert.deepEqual(connectors.agentTools(writable).map(tool => tool.name), ['box_list', 'box_reset']);
  assert.deepEqual(connectors.agentTools(writable, { readOnly: true }).map(tool => tool.name), ['box_list']);
  assert.deepEqual(await connectors.callTool(project, 'box_list', { a: 1 }, { workspace: '/w' }), { items: [] });
  assert.deepEqual([runs[0][0], runs[0][1].settings, runs[0][1].workspace], [{ a: 1 }, { scope: 'mine' }, '/w']);
  await assert.rejects(connectors.callTool(project, 'box_reset', {}), ConnectorNotPermitted);
  await assert.rejects(connectors.callTool(writable, 'box_reset', {}, { readOnly: true }), ConnectorNotPermitted);
  await assert.rejects(connectors.callTool(writable, 'box_reset', {}), /did not answer box_reset within/);
  await assert.rejects(connectors.callTool({ connectors: {} }, 'box_list', {}), /No connector tool box_list/);
});
