// Explicit opt-in: creates three private GitHub repositories with gh, dispatches one real ticket
// across them through a running dispatch, opens linked pull requests and lands them. Consumes
// provider usage and needs a signed-in gh. Nothing here enables a provider or a connector.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const run = promisify(execFile);
const { values } = parseArgs({ options: { owner: { type: 'string' }, url: { type: 'string', default: 'http://127.0.0.1:4327' }, root: { type: 'string', default: join(homedir(), 'code') }, prefix: { type: 'string', default: 'dispatch-mr' }, provider: { type: 'string', default: 'claude' }, model: { type: 'string' }, keep: { type: 'boolean', default: false }, agent: { type: 'boolean', default: false } } });
const base = values.url.replace(/\/$/, '');
const terminal = new Set(['ready', 'blocked', 'failed', 'cancelled', 'interrupted']);
const fail = message => { throw new Error(`FAIL: ${message}`); };
const expect = (condition, message) => { if (!condition) fail(message); };

async function api(path, data) {
  const response = await fetch(`${base}${path}`, data ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) } : undefined);
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${value.error ?? response.status}${value.question ? ` (${value.question.text})` : ''}`);
  return value;
}
const gh = async (args, cwd) => (await run('gh', args, { cwd, env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' } })).stdout.trim();
const git = async (cwd, args) => (await run('git', args, { cwd })).stdout.trim();

const fixtures = {
  api: {
    'users.mjs': `export const users = () => [{ id: 1, name: 'Ada Lovelace' }, { id: 2, name: 'Grace Hopper' }];\n`,
    'server.mjs': `import { createServer } from 'node:http';\nimport { users } from './users.mjs';\ncreateServer((request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(request.url === '/users' ? users() : { error: 'not found' })); }).listen(Number(process.env.PORT) || 3000, '127.0.0.1');\n`,
    'users.test.mjs': `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { users } from './users.mjs';\ntest('every user carries the name field the frontend and the service read', () => { for (const user of users()) assert.equal(typeof user.name, 'string'); });\n`,
    'README.md': `# ${'${name}'}\n\nA tiny users API. GET /users returns [{ id, name }]. The frontend renders the name field and the service greets by it; the three repositories must agree on that field name.\n`,
  },
  frontend: {
    'render.mjs': `export const renderUser = user => \`<li>\${user.name}</li>\`;\nexport const renderUsers = users => \`<ul>\${users.map(renderUser).join('')}</ul>\`;\n`,
    'render.test.mjs': `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { renderUser } from './render.mjs';\ntest('renders the name field from the API payload', () => { assert.equal(renderUser({ id: 1, name: 'Ada Lovelace' }), '<li>Ada Lovelace</li>'); });\n`,
    'README.md': `# ${'${name}'}\n\nRenders the users the API returns. Reads the name field of each user; releases go to the staging branch first.\n`,
  },
  service: {
    'consumer.mjs': `export const greeting = user => \`Hello, \${user.name}!\`;\nexport const greetAll = users => users.map(greeting);\n`,
    'consumer.test.mjs': `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greeting } from './consumer.mjs';\ntest('greets by the name field from the API payload', () => { assert.equal(greeting({ id: 1, name: 'Ada Lovelace' }), 'Hello, Ada Lovelace!'); });\n`,
    'README.md': `# ${'${name}'}\n\nA notification service that greets users from the API payload by their name field.\n`,
  },
};
const ticket = 'Rename the user field "name" to "fullName" everywhere: the API response in api (users.mjs and its test), the greeting in service (consumer.mjs and its test) and the list item in frontend (render.mjs and its test). Keep each repository\'s README accurate. All three must agree on the new field name.';

async function createRepository(name, dir, { staging = false } = {}) {
  expect(!existsSync(dir), `${dir} already exists; remove it or pass --prefix.`);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(fixtures[name])) writeFileSync(join(dir, file), content.replace('${name}', `${values.prefix}-${name}`));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `${values.prefix}-${name}`, private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  await git(dir, ['init', '-b', 'main']); await git(dir, ['add', '.']); await git(dir, ['commit', '-q', '-m', 'Initial']);
  if (staging) { await git(dir, ['branch', 'staging', 'main']); }
  const full = `${values.owner}/${values.prefix}-${name}`;
  await gh(['repo', 'create', full, '--private', '--source', dir, '--remote', 'origin', '--push'], dir);
  if (staging) await git(dir, ['push', '-q', 'origin', 'staging']);
  console.log(`Created https://github.com/${full}${staging ? ' (main and staging)' : ''}`);
  return full;
}

async function preflight() {
  values.owner ??= await gh(['api', 'user', '--jq', '.login']);
  const state = await api('/api/state').catch(() => fail(`dispatch is not answering at ${base}; start it with npm run dev.`));
  const enabled = state.providerSettings?.[values.provider] ?? values.provider === 'codex';
  expect(enabled, `${values.provider} is not enabled in this dispatch. Enable it in Settings → Providers (explicit consent), then run again.`);
  for (const name of Object.keys(fixtures)) expect(!state.projects.some(project => project.name === `${values.prefix}-${name}`), `${values.prefix}-${name} is already registered; remove it in Settings → Repositories or pass --prefix.`);
  const catalog = (await api('/api/models/refresh', {})).models ?? state.modelCatalog?.models ?? [];
  const model = catalog.find(item => item.provider === values.provider && (!values.model || item.model === values.model)) ?? fail(`No ${values.provider} model in the catalog; refresh models in Settings.`);
  return { model: { provider: model.provider, model: model.model, effort: model.defaultReasoningEffort ?? model.supportedReasoningEfforts?.at(-1)?.reasoningEffort ?? null } };
}

// Opening the pull requests is this smoke's explicit purpose, so each test repository allows the delivery connector's writes.
async function deliveryWrites() {
  const connector = (await api('/api/connectors')).find(item => item.delivers);
  if (!connector) fail('No connector that opens pull requests is loaded.');
  return { [connector.id]: { actions: Object.fromEntries(connector.actions.filter(action => action.access === 'write').map(action => [action.id, true])) } };
}

async function register(name, dir, baseBranch) {
  return api('/api/projects', { name: `${values.prefix}-${name}`, repositoryPath: dir, baseBranch, confirmed: true, validation: [{ id: 'test', command: 'npm', args: ['test'] }], trackRemote: true, connectors: await deliveryWrites() });
}

async function watch(id) {
  let seen = 0, run;
  do {
    await sleep(2000);
    run = (await api(`/api/runs/${id}/export`)).run;
    for (const event of run.events.slice(seen)) console.log(`  ${run.ticketId} ${event.kind}: ${event.message.slice(0, 220).replace(/\n/g, ' ')}`);
    seen = run.events.length;
  } while (!terminal.has(run.status) || run.events.at(-1)?.kind !== run.status && run.status === 'ready' && !run.headSha && !run.answered);
  return run;
}

async function remoteHeads(full) {
  const heads = {};
  for (const branch of ['main', 'staging']) heads[branch] = await gh(['api', `repos/${full}/branches/${branch}`, '--jq', '.commit.sha']).catch(() => null);
  return heads;
}

function report(run, projects) {
  const committed = run.linked.filter(member => member.headSha && member.headSha !== member.baseSha);
  console.log(`Run ${run.id}: ${run.status}; primary ${projects.api.name} ${run.headSha === run.baseSha ? 'unchanged' : `committed ${run.headSha.slice(0, 12)}`}; linked commits: ${committed.map(member => `${member.name} ${member.headSha.slice(0, 12)} (${member.changedPaths.length} files)`).join(', ') || 'none'}.`);
  console.log(`Checks: ${run.checks.map(check => `${check.name} ${check.status}`).join(', ')}.`);
  console.log(`Timings (ms): ${JSON.stringify(run.timings)}; usage: ${JSON.stringify(run.usage)}; elapsed: ${run.insights?.totalMs ?? 'unknown'} ms.`);
}

async function verifyPullRequests(run, projects, fulls) {
  const views = [{ name: projects.api.name, branch: run.branch, delivery: run.delivery, full: fulls.api }, ...run.linked.filter(member => member.delivery).map(member => ({ name: member.name, branch: member.branch, delivery: member.delivery, full: fulls[member.name.slice(values.prefix.length + 1)] }))];
  const urls = views.map(view => view.delivery?.pr?.url).filter(Boolean);
  expect(urls.length === 3, `Expected three pull requests, got ${JSON.stringify(views.map(view => view.delivery))}.`);
  for (const view of views) {
    const pr = JSON.parse(await gh(['pr', 'view', view.delivery.pr.url, '--json', 'baseRefName,body,url,isDraft']));
    const expectedBase = view.name.endsWith('-frontend') ? 'staging' : 'main';
    expect(pr.baseRefName === expectedBase, `${view.name}: pull request base is ${pr.baseRefName}, expected ${expectedBase}.`);
    const others = urls.filter(url => url !== pr.url);
    expect(others.every(url => pr.body.includes(url)), `${view.name}: body does not link the other pull requests.`);
    console.log(`${view.name}: draft=${pr.isDraft} ${pr.url} → ${pr.baseRefName}, links ${others.length} related pull requests.`);
  }
}

async function land(run, projects, dirs, fulls) {
  const before = { api: await git(dirs.api, ['rev-parse', 'main']), service: await git(dirs.service, ['rev-parse', 'main']), frontend: await git(dirs.frontend, ['rev-parse', 'staging']), remote: await remoteHeads(fulls.frontend) };
  const landing = await api('/api/landings', { runIds: [run.id], target: 'main', targets: { [projects.frontend.id]: 'staging' }, strategy: 'squash' });
  const done = await watch(landing.id);
  expect(done.status === 'ready', `landing ended ${done.status}: ${done.events.at(-1)?.message}`);
  expect(await git(dirs.api, ['rev-parse', 'main']) !== before.api && await git(dirs.service, ['rev-parse', 'main']) !== before.service && await git(dirs.frontend, ['rev-parse', 'staging']) !== before.frontend, 'A target branch did not move.');
  expect(await git(dirs.frontend, ['rev-parse', 'main']) === await git(dirs.frontend, ['rev-parse', 'origin/main']), 'frontend main moved although staging was the target.');
  const after = await remoteHeads(fulls.frontend);
  expect(after.staging === before.remote.staging, 'The landing pushed to the remote; it must only move local branches.');
  console.log(`Landing ${landing.id}: ${done.events.at(-1).message}`);
}

async function cleanup(dirs, fulls, projects) {
  if (values.keep) { console.log(`Kept ${Object.values(dirs).join(', ')} and ${Object.values(fulls).join(', ')}.`); return; }
  for (const full of Object.values(fulls)) await gh(['repo', 'delete', full, '--yes']).catch(error => console.log(`Could not delete ${full}: ${error.message.split('\n')[0]} (needs the delete_repo scope: gh auth refresh -h github.com -s delete_repo)`));
  for (const dir of Object.values(dirs)) rmSync(dir, { recursive: true, force: true });
  console.log(`Removed the local repositories. The dispatch projects ${Object.values(projects).map(project => project.name).join(', ')} stay registered; remove them in Settings → Repositories.`);
}

async function main() {
  const { model } = await preflight();
  const dirs = Object.fromEntries(Object.keys(fixtures).map(name => [name, resolve(values.root, `${values.prefix}-${name}`)]));
  const fulls = {}, projects = {};
  try {
    for (const name of Object.keys(fixtures)) fulls[name] = await createRepository(name, dirs[name], { staging: name === 'frontend' });
    for (const name of Object.keys(fixtures)) projects[name] = await register(name, dirs[name], name === 'frontend' ? 'staging' : 'main');
    const selection = values.agent ? { projectIds: 'all' } : { projectIds: [projects.api.id, projects.frontend.id, projects.service.id] };
    console.log(`Dispatching with ${model.provider} ${model.model} (${model.effort ?? 'default effort'}), ${values.agent ? 'agent decides' : 'three repositories ticked'}…`);
    const started = Date.now(), created = await api('/api/runs', { ...selection, input: ticket, execution: model, mode: 'live' });
    const run = await watch(created.id);
    console.log(`Wall clock to a terminal state: ${Math.round((Date.now() - started) / 1000)} s.`);
    report(run, projects);
    expect(run.status === 'ready', `run ended ${run.status}: ${run.events.at(-1)?.message}`);
    expect(run.linked.filter(member => member.headSha && member.headSha !== member.baseSha).length === 2 && run.headSha !== run.baseSha, 'Expected a commit in every repository.');
    const opened = (await api('/api/pull-requests', { runIds: [run.id], bases: { [projects.frontend.id]: 'staging' } })).runs[0];
    await verifyPullRequests(opened, projects, fulls);
    await land(opened, projects, dirs, fulls);
    console.log('PASS: three repositories, three checks, three linked draft pull requests, landed on main/staging/main.');
  } finally { await cleanup(dirs, fulls, projects); }
}

await main();
