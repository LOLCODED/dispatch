import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { Engine } from '../src/engine.mjs';
import { createServer, acquireLock } from '../src/server.mjs';
import { git } from '../src/local-tools.mjs';
import { liveFixture, models, waitsForAbort } from './live-double.mjs';
import { exampleTracker } from './tracker-double.mjs';
import { forgeDouble } from './forge-double.mjs';
async function setup(t, options) {
  const fixture = await liveFixture(t, options);
  const server = createServer(fixture.engine); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { ...fixture, base: `http://127.0.0.1:${server.address().port}`, dataDir: fixture.engine.dataDir };
}
test('serves local state and frontend with restrictive headers', async t => {
  const { base } = await setup(t); const response = await fetch(base); assert.equal(response.status, 200); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  const state = await (await fetch(`${base}/api/state`)).json(); assert.equal(state.mode, 'local'); assert.deepEqual(state.runs, []); assert.equal(state.labels.ready, 'Ready for review'); assert.equal(state.tickets, undefined);
});
test('a duplicate ticket returns 409 over HTTP', async t => {
  const { base, project } = await setup(t, { behavior: waitsForAbort }), options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id, input: 'Change it' }) };
  const response = await fetch(`${base}/api/runs`, options); assert.equal(response.status, 201);
  assert.equal((await fetch(`${base}/api/runs`, options)).status, 409);
});
test('rejects foreign origin, foreign host, invalid JSON and non-JSON writes', async t => {
  const { base } = await setup(t);
  assert.equal((await fetch(`${base}/api/runs`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => { http.get(base, { headers: { host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(`${base}/api/runs`, { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not-json' })).status, 400);
});
test('the queue hold names working runs over HTTP, validates its length, and releases', async t => {
  const { base, engine, project } = await setup(t, { behavior: waitsForAbort }), post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await fetch(`${base}/api/runs`, post({ projectId: project.id, input: 'Long change' }));
  const held = await (await fetch(`${base}/api/queue/hold`, post({ seconds: 60 }))).json();
  assert.deepEqual(held.working, ['Long change']); assert.ok(engine.queueHold);
  assert.equal((await fetch(`${base}/api/queue/hold`, post({ seconds: 'soon' }))).status, 400);
  assert.equal((await fetch(`${base}/api/queue/release`, post({}))).status, 200); assert.equal(engine.queueHold, null);
});
test('unknown and filesystem paths are not exposed', async t => {
  const { base } = await setup(t);
  for (const path of ['/src/server.mjs', '/.env', '/api/runs/abc/artifacts/0', '/api/runs/abc/export', '/assets/missing.js', '/assets/../server.mjs', '/admin/projects/private.json', '/api/account-usage', '/browser', '/browser.js', '/styles.css']) assert.equal((await fetch(`${base}${path}`)).status, 404);
});
test('data directory lock excludes another server and can be released', async t => {
  const { dataDir } = await setup(t), unlock = acquireLock(dataDir);
  try { assert.throws(() => acquireLock(dataDir), /in use/); } finally { unlock(); }
  acquireLock(dataDir)();
});
test('analytics starts empty and reads nothing from providers', async t => {
  const { base } = await setup(t);
  const analytics = await (await fetch(`${base}/api/analytics`)).json(); assert.equal(analytics.totalRuns, 0);
});

test('serves the built application on direct page routes and restricts assets', async t => {
  const { base } = await setup(t);
  for (const route of ['/setup', '/setup/keyboard', '/admin', '/admin/projects', '/admin/projects/new', '/runs/abcd-1234']) {
    const response = await fetch(base + route); assert.equal(response.status, 200); assert.match(await response.text(), /id="root"/);
  }
  const html = await (await fetch(base)).text(), asset = html.match(/src="(\/assets\/[^"]+\.js)"/)[1];
  const response = await fetch(base + asset); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /javascript/);
});

test('local folder browser lists directories without exposing files or bypassing origin checks', async t => {
  const { base, dataDir } = await setup(t);
  mkdirSync(join(dataDir, 'folder with spaces'));
  mkdirSync(join(dataDir, '.hidden'));
  writeFileSync(join(dataDir, 'private.txt'), 'not exposed');
  const endpoint = `${base}/api/folders?path=${encodeURIComponent(dataDir)}`;
  const response = await fetch(endpoint); assert.equal(response.status, 200);
  const listing = await response.json();
  assert.ok(listing.folders.some(folder => folder.name === 'folder with spaces'));
  assert.ok(listing.folders.every(folder => !folder.name.startsWith('.') && folder.name !== 'private.txt'));
  assert.equal((await fetch(endpoint, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${base}/api/folders?path=${encodeURIComponent(join(dataDir, 'private.txt'))}`)).status, 400);
  assert.equal((await fetch(`${base}/api/folders?path=%00`)).status, 400);
});

test('workspace summaries omit evidence payloads and history loads only the requested chain', async t => {
  const { base, engine } = await setup(t);
  const first = { id: 'abcd-1111', mode: 'live', status: 'ready', title: 'First', project: { name: 'Example' }, events: [{ message: 'x'.repeat(100000) }], checks: [{ output: 'private output' }], artifacts: [], usage: {} };
  const next = { ...first, id: 'abcd-2222', previousRunId: first.id, title: 'Next' };
  engine.runs.push(first, next, { ...first, id: 'abcd-3333', title: 'Unrelated' });
  const response = await fetch(`${base}/api/workspace`), serialized = await response.text(), state = JSON.parse(serialized);
  const fullBytes = Buffer.byteLength(await (await fetch(`${base}/api/state`)).text());
  const compactBytes = Buffer.byteLength(serialized);
  t.diagnostic(`Workspace payload: ${compactBytes} bytes; full state: ${fullBytes} bytes (${(100 * (1 - compactBytes / fullBytes)).toFixed(1)}% smaller on this fixture).`);
  assert.equal(state.runs.length, 3); assert.ok(compactBytes < 5000);
  for (const run of state.runs) { assert.equal(run.events, undefined); assert.equal(run.checks, undefined); assert.equal(run.artifacts, undefined); }
  const history = await (await fetch(`${base}/api/runs/${next.id}/history`)).json();
  assert.deepEqual(history.map(run => run.id), [first.id]); assert.equal(history[0].checks[0].output, 'private output');
  first.previousRunId = next.id;
  assert.equal((await (await fetch(`${base}/api/runs/${next.id}/history`)).json()).length, 1);
});

test('workspace summaries carry the worker summary and a bounded request for search', async t => {
  const { base, engine } = await setup(t);
  const shared = { mode: 'live', status: 'ready', title: 'typed', project: { name: 'Example' }, events: [], checks: [], artifacts: [], usage: {} };
  engine.runs.push({ ...shared, id: 'abcd-5555', input: `typed\n${'x'.repeat(5000)}`, commitSubject: 'feat(board): show worker summaries as task names' }, { ...shared, id: 'abcd-6666', input: 'question only' });
  const { runs } = await (await fetch(`${base}/api/workspace`)).json(), byId = Object.fromEntries(runs.map(run => [run.id, run]));
  assert.equal(byId['abcd-5555'].summary, 'show worker summaries as task names');
  assert.equal(byId['abcd-5555'].request.length, 1000);
  assert.deepEqual([byId['abcd-6666'].summary, byId['abcd-6666'].request], [null, 'question only']);
});

test('model discovery is explicit and origin protected; explicit choices are validated against enabled providers', async t => {
  const { base, engine, project } = await setup(t); let reads = 0;
  engine.live.adapter.models = async () => { reads++; return { available: true, models }; };
  await fetch(`${base}/setup`); await fetch(`${base}/api/state`); assert.equal(reads, 0);
  const post = (path, input, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(input) });
  assert.equal((await post('/api/models/refresh', {}, { origin: 'https://evil.example' })).status, 403); assert.equal(reads, 0);
  assert.equal((await post('/api/models/refresh', {})).status, 200); assert.equal(reads, 1);
  const task = { projectId: project.id, input: 'Change it' };
  assert.equal((await post('/api/tasks', { ...task, execution: { provider: 'claude', model: 'test-sol' } })).status, 400);
  assert.equal((await post('/api/tasks', { ...task, execution: { provider: 'codex', model: 'test-sol', effort: 'medium' } })).status, 400);
  const choice = { provider: 'codex', model: 'test-sol', effort: 'high' };
  assert.deepEqual((await (await post('/api/tasks', { ...task, execution: choice })).json()).execution, choice);
  assert.equal((await post('/api/model-routing', { general: choice })).status, 404);
  const state = await (await fetch(`${base}/api/state`)).json(); assert.equal(state.modelCatalog.models[0].model, 'test-sol'); assert.equal(state.modelRouting, undefined); assert.equal(reads, 1);
  const restarted = new Engine({ dataDir: engine.dataDir }); t.after(() => restarted.shutdown()); assert.equal(restarted.store.state.modelCatalog.models[0].model, 'test-sol');
});

test('provider consent is an explicit, origin-protected setting that persists across restart', async t => {
  const { base, engine } = await setup(t);
  const post = (input, headers = {}) => fetch(`${base}/api/providers`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(input) });
  assert.deepEqual((await (await fetch(`${base}/api/workspace`)).json()).providerSettings, { codex: true, claude: false, cursor: false, opencode: false, pi: false, 'local-models': false });
  assert.equal((await post({ id: 'claude', enabled: true }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ id: 'claude', enabled: 'true' })).status, 400);
  for (const id of ['unknown', 'local']) assert.equal((await post({ id, enabled: true })).status, 400);
  const saved = await (await post({ id: 'claude', enabled: true })).json();
  assert.equal(saved.providerSettings.claude, true);
  const restarted = new Engine({ dataDir: engine.dataDir }); t.after(() => restarted.shutdown());
  assert.equal(restarted.store.state.providerSettings.claude, true);
});

test('local endpoints are an origin-protected, validated setting that persists across restart', async t => {
  const { base, engine } = await setup(t);
  const post = (input, headers = {}) => fetch(`${base}/api/local-endpoints`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(input) });
  assert.deepEqual((await (await fetch(`${base}/api/workspace`)).json()).localEndpoints.map(endpoint => endpoint.kind), ['ollama']);
  const endpoints = [{ name: 'GPU box', kind: 'server', url: 'http://10.0.0.5:1234' }];
  assert.equal((await post({ endpoints }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ endpoints: [{ ...endpoints[0], url: 'http://user:secret@10.0.0.5' }] })).status, 400);
  assert.deepEqual((await (await post({ endpoints })).json()).localEndpoints, [{ id: 'gpu-box', ...endpoints[0] }]);
  const restarted = new Engine({ dataDir: engine.dataDir }); t.after(() => restarted.shutdown());
  assert.equal(restarted.store.state.localEndpoints[0].id, 'gpu-box');
});

test('recipe continuation route requires JSON and a stopped live run', async t => {
  const { base, project } = await setup(t, { behavior: waitsForAbort }), post = (path, body, headers = { 'content-type': 'application/json' }) => fetch(`${base}${path}`, { method: 'POST', headers, body });
  const running = await (await post('/api/runs', JSON.stringify({ projectId: project.id, input: 'Change it' }))).json();
  const validation = JSON.stringify({ validation: [{ id: 'unit', command: 'node', args: ['--version'] }] });
  assert.equal((await post(`/api/runs/${running.id}/recipe`, validation, {})).status, 415);
  assert.equal((await post(`/api/runs/${running.id}/recipe`, validation)).status, 409);
  assert.equal((await post('/api/runs/00000000-0000-0000-0000-000000000000/recipe', validation)).status, 404);
});

test('a delivery connector is probed only when a repository uses it, and delivery refresh is explicit and bound to the recorded SHA', async t => {
  const forge = forgeDouble({ checks: [] }), probes = [];
  const status = forge.connector.status; forge.connector.status = async () => { probes.push('status'); return status(); };
  const { base, engine, dataDir } = await setup(t, { services: { connectors: [forge.connector] } });
  assert.equal((await (await fetch(`${base}/api/connections`)).json()).connectors.forge.enabled, false); assert.equal(probes.length, 0);
  const repo = join(dataDir, 'repo'); mkdirSync(repo); writeFileSync(join(repo, 'a.txt'), 'a');
  await git(repo, ['init', '-b', 'main']); await git(repo, ['add', '.']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
  const post = (path, data) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const saved = await (await post('/api/projects', { repositoryPath: repo, baseBranch: 'main', confirmed: true, validation: [{ id: 'unit', command: 'true', args: [] }], connectors: { forge: { enabled: true, actions: { push: true, openPullRequest: true } } } })).json();
  assert.deepEqual(saved.connectors, { forge: { enabled: true, actions: { push: true, openPullRequest: true }, settings: {} } });
  const connections = await (await fetch(`${base}/api/connections`)).json();
  assert.equal(connections.connectors.forge.authenticated, true); assert.deepEqual(probes, ['status']);
  assert.equal((await post('/api/runs/abcd-0000/delivery/refresh', {})).status, 404);
  const run = { id: 'abcd-1111', mode: 'live', status: 'ready', projectId: saved.id, project: saved, branch: 'dispatch/abcd-1111', baseBranch: 'main', headSha: 'head1', workspace: repo, events: [], checks: [], artifacts: [], usage: {}, delivery: null };
  engine.runs.push(run);
  assert.equal((await post(`/api/runs/${run.id}/delivery/refresh`, {})).status, 409);
  run.delivery = { branch: run.branch, remote: 'origin', headSha: 'head1', pushedAt: 'earlier', pr: null, ci: null, error: null, tracker: null };
  run.headSha = 'moved';
  assert.equal((await fetch(`${base}/api/runs/${run.id}/delivery/refresh`, { method: 'POST', body: '{}' })).status, 415);
  const refreshed = await (await post(`/api/runs/${run.id}/delivery/refresh`, {})).json();
  assert.equal(refreshed.error, null, JSON.stringify(refreshed.error)); assert.equal(refreshed.ci.state, 'unknown'); assert.equal(refreshed.ci.sha, 'head1'); assert.equal(refreshed.error, null);
  assert.deepEqual(forge.calls.map(call => [call.hook, call.sha]), [['findPullRequest', undefined], ['checks', 'head1']]);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).runs.find(item => item.id === run.id).delivery.ci.sha, 'head1');
});
test('project memory is a read-only GET of notes and recent task summaries', async t => {
  const { base, live, dataDir } = await setup(t), repo = join(dataDir, 'repo'); mkdirSync(repo);
  writeFileSync(join(repo, 'value.txt'), 'original'); await git(repo, ['init', '-b', 'main']); await git(repo, ['add', '.']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
  const project = await live.saveProject({ repositoryPath: repo, baseBranch: 'main', confirmed: true, validation: [{ id: 'unit', command: 'npm', args: ['run', 'test'] }] });
  assert.equal(project.memory, true);
  live.memory.record({ id: 'r1', projectId: project.id, project, status: 'ready', finishedAt: '2026-09-29T00:00:00.000Z', title: 'Seed', ticket: { key: 'k' }, checks: [], changedPaths: [], summary: 'Notes for next time:\n- Seeded note' });
  const response = await fetch(`${base}/api/projects/${project.id}/memory`), memory = await response.json();
  assert.equal(response.status, 200); assert.equal(memory.enabled, true); assert.match(memory.notes, /- Seeded note/); assert.equal(memory.tasks.length, 1); assert.equal(memory.path, join(dataDir, 'memory', project.id));
  assert.equal((await fetch(`${base}/api/projects/0000-missing/memory`)).status, 404);
  assert.equal((await fetch(`${base}/api/projects/${project.id}/memory`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
});
test('board routes require JSON, file tasks into folders and surface agent questions in the workspace', async t => {
  const { base, project, engine } = await setup(t, { behavior: waitsForAbort });
  const post = (path, data) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await fetch(`${base}/api/board/folders`, { method: 'POST', body: '{}' })).status, 415);
  const folder = await (await post('/api/board/folders', { name: 'Sprint 42' })).json();
  const run = await (await post('/api/runs', { projectId: project.id, input: 'Change it' })).json();
  assert.equal((await post(`/api/board/items/${run.id}`, { folderId: folder.id })).status, 200);
  assert.equal((await post(`/api/board/items/${run.id}`, { archived: true })).status, 409);
  await post(`/api/runs/${run.id}/cancel`, {});
  engine.get(run.id).question = `Which one?\n${'x'.repeat(3000)}`;
  const workspace = await (await fetch(`${base}/api/workspace`)).json();
  assert.deepEqual(workspace.board.folders.map(item => item.name), ['Sprint 42']);
  assert.equal(workspace.board.items[run.id].folderId, folder.id);
  assert.equal(workspace.runs[0].question.length, 2000); assert.equal(workspace.runs[0].pendingRequest, undefined);
  assert.equal((await post('/api/board/items/missing-key/pause', {})).status, 404);
});
test('new repositories are created through HTTP inside the allowed root and checks can be appended', async t => {
  const { base, project, live, dir } = await setup(t); live.createRoot = dir;
  const post = (path, data) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const created = await post('/api/projects/create', { repositoryPath: join(dir, 'fresh-app'), confirmed: true, access: 'full' });
  assert.equal(created.status, 201); const saved = await created.json(); assert.equal(saved.validation[0].kind, 'browser-smoke'); assert.equal(saved.access, 'full');
  assert.equal((await post('/api/projects/create', { repositoryPath: join(dir, 'fresh-app'), confirmed: true })).status, 400);
  assert.equal((await post('/api/projects/create', { repositoryPath: '/definitely/outside', confirmed: true })).status, 400);
  const appended = await post(`/api/projects/${project.id}/checks`, { validation: [{ id: 'lint', command: 'npm', args: ['run', 'lint'] }], setup: [{ id: 'install', command: 'npm', args: ['ci'] }] });
  assert.equal(appended.status, 200); const updated = await appended.json(); assert.deepEqual(updated.validation.map(step => step.id), ['unit', 'lint']); assert.deepEqual(updated.setup.map(step => step.id), ['install']);
  assert.equal((await post(`/api/projects/${project.id}/checks`, { validation: [{ id: 'lint', command: 'npm', args: ['run', 'lint'] }] })).status, 400);
});

test('remembered instructions are saved per repository', async t => {
  const { base, project, live } = await setup(t);
  const post = body => fetch(`${base}/api/projects/${project.id}/instructions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const saved = await (await post({ text: 'Prefer staging.' })).json();
  assert.deepEqual(saved.instructions, ['Prefer staging.']); assert.deepEqual(live.projects[0].instructions, ['Prefer staging.']);
  assert.equal((await post({ text: '' })).status, 400);
});

test('brain routes list, toggle, delete and forget memory; connectors toggle through the project', async t => {
  const { base, project, live } = await setup(t, { services: { connectors: [exampleTracker().connector] } });
  await live.addInstruction(project.id, { text: 'Never use Prisma' });
  const list = await (await fetch(`${base}/api/brain?projectId=${project.id}`)).json();
  const rule = list.entries.find(entry => entry.kind === 'rule');
  assert.equal(rule.text, 'Never use Prisma'); assert.equal(list.ladder.auto, 4);
  assert.deepEqual(list.entries.filter(entry => entry.kind === 'connector').map(entry => [entry.key, entry.enabled]), [['connector.example', false]]);
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await (await post(`/api/brain/${rule.id}`, { enabled: false })).json()).enabled, false);
  assert.deepEqual(live.projects[0].instructions, []);
  const connector = await (await post(`/api/brain/connector:${project.id}:example`, { enabled: true })).json();
  assert.equal(connector.enabled, true); assert.equal(live.projects[0].connectors.example.enabled, true);
  const forget = await (await post('/api/brain/forget', { text: 'prisma' })).json();
  assert.deepEqual(forget.matches.map(entry => entry.id), [rule.id]);
  assert.equal((await post(`/api/brain/${rule.id}/delete`, {})).status, 200);
  assert.equal((await (await fetch(`${base}/api/brain?kind=rule`)).json()).entries.length, 0);
  assert.equal((await post('/api/brain/missing-id', { enabled: true })).status, 404);
  assert.equal((await fetch(`${base}/brain`)).status, 200);
});

test('steps page over the run log, zip export bundles evidence, and provider contracts are exposed for enabled providers only', async t => {
  const { base, project, live } = await setup(t);
  const workspace = await (await fetch(`${base}/api/workspace`)).json();
  assert.deepEqual(Object.keys(workspace.providerContracts), ['codex']); assert.equal(workspace.providerContracts.codex.questions, 'none');
  const run = await live.create({ projectId: project.id, input: 'Change it' });
  await new Promise(resolve => { const timer = setInterval(() => { if (run.status === 'ready') { clearInterval(timer); resolve(); } }, 20); });
  const page = await (await fetch(`${base}/api/runs/${run.id}/steps?limit=2`)).json();
  assert.equal(page.steps.length, 2); assert.equal(page.next, 2); assert.equal(page.total, run.stepCount);
  const rest = await (await fetch(`${base}/api/runs/${run.id}/steps?after=2&limit=1000`)).json();
  assert.equal(rest.steps.length, run.stepCount - 2); assert.equal(rest.next, null);
  assert.equal((await fetch(`${base}/api/runs/abc/steps`)).status, 404);
  const zip = await fetch(`${base}/api/runs/${run.id}/export?format=zip`);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  const { readZipDirectory } = await import('../src/zip.mjs');
  const names = readZipDirectory(Buffer.from(await zip.arrayBuffer())).map(entry => entry.name);
  assert.ok(names.includes('run.json') && names.includes('steps.jsonl') && names.includes('artifacts.json') && names.includes('live-log.jsonl'));
  assert.ok(names.some(name => name.startsWith('artifacts/') && name.endsWith('.patch')));
  const patch = run.artifacts.find(item => item.check === 'patch');
  const inline = await fetch(`${base}/api/runs/${run.id}/artifacts/${patch.id}?inline`);
  assert.match(inline.headers.get('content-type'), /text\/x-patch/); assert.match(inline.headers.get('content-disposition'), /^inline/);
});

test('the trace viewer is served same-origin from Playwright’s files and never reaches outside them', async t => {
  const { base } = await setup(t);
  const workspace = await (await fetch(`${base}/api/workspace`)).json();
  assert.equal(workspace.traceViewer, true);
  const index = await fetch(`${base}/trace-viewer/index.html`); assert.equal(index.status, 200); assert.match(index.headers.get('content-type'), /text\/html/);
  for (const path of ['/trace-viewer/../server.mjs', '/trace-viewer/assets/../../package.json', '/trace-viewer/missing.js', '/trace-viewer/']) assert.equal((await fetch(`${base}${path}`)).status, 404);
});
