// First, so an outdated Node.js stops with its version before any later module can fail obscurely.
import './node-version.mjs';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, openSync, writeFileSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analytics, runInsights } from './analytics.mjs';
import { Tasks } from './tasks.mjs';
import { Board } from './board.mjs';
import { Storage } from './storage.mjs';
import { snapshotAppAssets, root } from './app-assets.mjs';
import { LiveService } from './live.mjs';
import { listFolders } from './folders.mjs';
import { pickFolder } from './folder-picker.mjs';
import { Engine, InputError } from './engine.mjs';
import { labels, maxConcurrency } from './catalog.mjs';
import { evidenceRoute, snapshotTraceViewer } from './server-routes.mjs';
import { contextImageLimits } from './context-images.mjs';
import { contextFileLimits } from './context-files.mjs';
import { landable } from './landing.mjs';
import { publishable } from './pull-requests.mjs';
import { failingChecks } from './delivery.mjs';
import { committedMember, deliverable } from './linked-repositories.mjs';
import { changelog } from './changelog.mjs';
import { parseSubject } from './conventional-commit.mjs';
import { completeSetup, setupNeeded } from './onboarding.mjs';
import { Updates } from './updates.mjs';

const appVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const releaseVersion = /^\d+\.\d+\.\d+$/;
const runBodyLimit = 65536 + contextImageLimits.count * Math.ceil(contextImageLimits.bytes / 3) * 4 + contextFileLimits.count * Math.ceil(contextFileLimits.bytes / 3) * 4;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
async function body(req, limit = 16384) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > limit) throw new InputError('Request is too large', 413); }
  try { const value = JSON.parse(text); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; } catch { throw new InputError('Expected a JSON object'); }
}
async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
  return body(req);
}
const cap = (text, length) => typeof text === 'string' ? text.slice(0, length) : undefined;
const requestLength = 1000;
const workerSummary = run => run.commitSubject ? parseSubject(run.commitSubject).description || null : null;
function pendingRequest(run) {
  const request = run.interactions?.find(interaction => interaction.status === 'pending');
  return request && { id: request.id, questions: (request.questions ?? []).slice(0, 3).map(({ id, question, options }) => ({ id, question: cap(question, 2000), options: options?.slice(0, 6) })) };
}
function deliveryView(delivery) {
  if (!delivery?.pr) return null;
  const { pr, ci } = delivery;
  return {
    pushedAt: delivery.pushedAt, submittedAt: delivery.submittedAt ?? null, headSha: delivery.headSha,
    pr: { number: pr.number, url: pr.url, state: pr.state, baseRefName: pr.baseRefName ?? null, reviewDecision: pr.reviewDecision ?? null, mergeable: pr.mergeable ?? null, changesRequestedAt: pr.changesRequestedAt ?? null },
    ci: ci ? { sha: ci.sha, state: ci.state, failing: failingChecks(ci).slice(0, 5).map(check => cap(check.name, 120)) } : null,
  };
}
const handoffOf = (run, live) => live.openingPullRequests.has(run.id) ? 'publishing' : run.status === 'ready' && live.landings.landingOf(run) ? 'landing' : null;
function handoffView(run, live) {
  const handingOff = handoffOf(run, live);
  return { handingOff, landable: !handingOff && landable(run), publishable: !handingOff && publishable(run, live.autoDelivery(run)) };
}
function runSummary(run, live) {
  return {
    id: run.id, mode: run.mode, kind: run.kind ?? 'change', title: run.title, summary: workerSummary(run), request: cap(run.input, requestLength), status: run.status, projectId: run.projectId, project: { name: run.project?.name },
    ticketId: run.ticketId, taskId: run.taskId, createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt, previousRunId: run.previousRunId, supersededBy: run.supersededBy,
    resumable: Boolean(run.sessionId), question: cap(run.question, 2000), plan: run.plan === true, remaining: run.remaining && { items: run.remaining.items.slice(0, 12), resolution: run.remaining.resolution ?? null }, pendingRequest: pendingRequest(run),
    reason: cap(run.events?.findLast(event => event.kind === run.status)?.message, 240), insights: runInsights(run), ...handoffView(run, live), worktreeRemovedAt: run.worktreeRemovedAt, delivery: deliveryView(run.delivery),
    repositories: repositoriesView(run), landedRunIds: run.landing?.items.map(item => item.runId), resolvesConflicts: Boolean(run.mergeIn),
  };
}
// The primary when it has a tested commit, then every linked repository with one: what a landing or pull request will touch.
const repositoriesView = run => [...(run.baseBranch && deliverable(run) ? [{ projectId: run.projectId, name: run.project?.name, baseBranch: run.baseBranch, primary: true }] : []), ...(run.linked ?? []).filter(committedMember).map(member => ({ projectId: member.projectId, name: member.name, baseBranch: member.baseBranch, primary: false }))];
const editDraft = ({ projectId, projectIds, title, input, execution }) => ({ projectId, projectIds: projectIds ?? null, title, input, execution: execution && execution !== 'auto' && execution.mode !== 'auto' ? { provider: execution.provider, model: execution.model, effort: execution.effort } : null });
async function editRoute({ tasks, live }, req, kind, id) {
  if (req.method === 'GET') return [200, editDraft(kind === 'tasks' ? tasks.editable(id) : live.editable(id))];
  if (req.method !== 'POST') return;
  const input = await jsonBody(req);
  return [200, editDraft(kind === 'tasks' ? tasks.update(id, input) : await live.edit(id, input))];
}
async function boardRoute(board, req, path) {
  if (req.method !== 'POST') return;
  if (path === '/api/board/folders') return [201, board.createFolder(await jsonBody(req))];
  const folder = path.match(/^\/api\/board\/folders\/([a-f0-9-]+)(\/delete)?$/);
  if (folder) { const input = await jsonBody(req); return [200, folder[2] ? board.deleteFolder(folder[1]) : board.renameFolder(folder[1], input)]; }
  const item = path.match(/^\/api\/board\/items\/([a-f0-9-]+)(?:\/(pause|resume))?$/);
  if (!item) return;
  const input = await jsonBody(req);
  return [200, item[2] ? await board[item[2]](item[1]) : board.update(item[1], input)];
}
async function brainRoute(live, req, path, url) {
  if (req.method === 'GET' && path === '/api/brain') return [200, live.brainCatalog({ projectId: url.searchParams.get('projectId') ?? undefined, kind: url.searchParams.get('kind') ?? undefined, match: url.searchParams.get('match') ?? undefined })];
  if (req.method !== 'POST') return;
  if (path === '/api/brain') return [201, live.addBrainEntry(await jsonBody(req))];
  if (path === '/api/brain/forget') return [200, live.forget(await jsonBody(req))];
  const entry = path.match(/^\/api\/brain\/([A-Za-z0-9:_-]+)(\/delete)?$/);
  if (!entry) return;
  const input = await jsonBody(req);
  return [200, entry[2] ? live.removeBrainEntry(entry[1]) : live.updateBrainEntry(entry[1], input)];
}
async function storageRoute(storage, req, path) {
  if (req.method === 'GET' && path === '/api/storage') return [200, await storage.usage()];
  if (req.method !== 'POST') return;
  if (path === '/api/storage/purge') return [200, await storage.purge(await jsonBody(req))];
  if (path === '/api/storage/browser-profiles/clear') { await jsonBody(req); return [200, await storage.clearBrowserProfiles()]; }
  const task = path.match(/^\/api\/storage\/tasks\/([a-f0-9-]+)\/delete$/);
  if (task) { await jsonBody(req); return [200, await storage.deleteTask(task[1])]; }
}
async function connectorPluginRoute(live, req, path) {
  if (req.method === 'GET' && path === '/api/connectors/plugins') return [200, live.connectorPlugins.list()];
  if (req.method === 'POST' && path === '/api/connectors/plugins') {
    const input = await jsonBody(req);
    try { return [201, await live.connectorPlugins.add(input.path)]; } catch (error) { throw new InputError(error.message); }
  }
  const plugin = path.match(/^\/api\/connectors\/plugins\/([a-z][a-z0-9]{1,30})\/remove$/);
  if (req.method === 'POST' && plugin) {
    await jsonBody(req);
    const removed = live.connectorPlugins.remove(plugin[1]);
    if (!removed) throw new InputError('No connector with that id was added.', 404);
    return [200, removed];
  }
}
export function createServer(engine, { assetRoot = root, devFraming = false, updates = new Updates({ root, version: appVersion, installed: false }) } = {}) {
  const live = engine.live ?? new LiveService(engine);
  const tasks = new Tasks(live), board = new Board(live), storage = new Storage(live), appAssets = snapshotAppAssets(assetRoot), traceViewer = snapshotTraceViewer();
  const viewRun = run => ({ ...run, ...(run.mode === 'live' ? { insights: runInsights(run), ...handoffView(run, live), repositories: repositoriesView(run), linkOffer: live.router.offerFor(run) } : {}) });
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Worktree previews are embedded by dispatch on a different loopback port.
    const ancestors = devFraming ? "'self' http://127.0.0.1:* http://localhost:*" : "'self'";
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src http://127.0.0.1:*; frame-ancestors ${ancestors}; base-uri 'none'; form-action 'self'`);
    try {
      // Loopback only. Reject foreign host/origin requests, including DNS rebinding.
      const authority = `127.0.0.1:${serverPort(res)}`;
      if (![authority, `localhost:${serverPort(res)}`].includes(req.headers.host)) throw new InputError('Untrusted host', 403);
      if (req.headers.origin && ![`http://${authority}`, `http://localhost:${serverPort(res)}`].includes(req.headers.origin)) throw new InputError('Untrusted origin', 403);
      const url = new URL(req.url, `http://${authority}`), path = url.pathname;
      if (req.method === 'POST' && path === '/api/queue/hold') return json(res, 200, engine.holdQueue((await jsonBody(req)).seconds));
      if (req.method === 'POST' && path === '/api/queue/release') { await jsonBody(req); return json(res, 200, engine.releaseQueue()); }
      if (req.method === 'GET' && path === '/api/workspace') { live.reconcileWorktrees(); live.pullRequests.watch(); }
      if (req.method === 'GET' && path === '/api/workspace') return json(res, 200, { mode: 'local', modelCatalog: live.modelCatalog, autoTiers: live.autoTiers, modelSuggestions: live.modelSuggestions(), providerSettings: live.providers.settings, localEndpoints: live.localEndpoints, localAgent: live.localAgent, connectors: live.connectorList.map(({ id, name, delivers, tickets }) => ({ id, name, delivers, tickets })), providerContracts: live.providers.contracts(), preferences: live.settingsRegistry.preferences(), traceViewer: traceViewer.size > 0, accessMode: live.accessMode, branchNaming: live.branchNaming, homeProjectId: live.homeProject()?.id ?? null, setupNeeded: setupNeeded(engine.store.state), concurrency: engine.concurrency, tasks: tasks.list().map(({ input, ...task }) => ({ ...task, request: cap(input, requestLength) })), labels, projects: live.projects, linkSuggestions: live.router.suggestions(), board: engine.store.state.board, runs: engine.runs.filter(run => run.mode === 'live').map(run => runSummary(run, live)) });
      if (path.startsWith('/api/board/')) { const result = await boardRoute(board, req, path); if (result) return json(res, ...result); }
      const respondPath = path.match(/^\/api\/runs\/([a-f0-9-]+)\/respond$/);
      if (respondPath && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 200, live.interactions.answer(respondPath[1], await body(req, runBodyLimit)));
      }
      if (req.method === 'GET' && path === '/api/state') return json(res, 200, { mode: 'local', modelCatalog: live.modelCatalog, autoTiers: live.autoTiers, providerSettings: live.providers.settings, accessMode: live.accessMode, branchNaming: live.branchNaming, homeProjectId: live.homeProject()?.id ?? null, labels, concurrency: engine.concurrency, runs: engine.runs.map(viewRun), projects: live.projects });
      if (req.method === 'GET' && path === '/api/tasks') return json(res, 200, tasks.list());
      if (req.method === 'POST' && path === '/api/tasks') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        const input = await body(req, runBodyLimit); await live.prepareRepositories(input);
        return json(res, 201, tasks.save(input));
      }
      const remainingPath = path.match(/^\/api\/runs\/([a-f0-9-]+)\/remaining$/);
      if (req.method === 'POST' && remainingPath) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 200, viewRun(tasks.settleRemaining(remainingPath[1], await body(req))));
      }
      const taskImage = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/images\/([1-9])$/);
      if (req.method === 'GET' && taskImage) {
        const { mimeType, bytes } = tasks.image(taskImage[1], Number(taskImage[2]));
        res.writeHead(200, { 'Content-Type': mimeType, 'Content-Length': bytes.length, 'Cache-Control': 'private, max-age=3600' });
        res.end(bytes); return;
      }
      const taskStart = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/start$/);
      if (req.method === 'POST' && taskStart) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        await body(req);
        return json(res, 201, await tasks.start(taskStart[1]));
      }
      const editPath = path.match(/^\/api\/(tasks|runs)\/([a-f0-9-]+)\/edit$/);
      if (editPath) { const result = await editRoute({ tasks, live }, req, editPath[1], editPath[2]); if (result) return json(res, ...result); }
      if (req.method === 'GET' && path === '/api/analytics') return json(res, 200, analytics(engine.runs));
      if (req.method === 'GET' && path === '/api/update') return json(res, 200, await updates.fresh());
      if (req.method === 'POST' && path === '/api/update/check') { await jsonBody(req); return json(res, 200, await updates.check()); }
      if (req.method === 'GET' && path === '/api/changelog') return json(res, 200, await changelog(root, { version: appVersion, since: releaseVersion.test(url.searchParams.get('since') ?? '') ? url.searchParams.get('since') : null, all: url.searchParams.get('all') === '1' }));
      if (req.method === 'POST' && path === '/api/runs') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 201, await live.create(await body(req, runBodyLimit)));
      }
      if (req.method === 'GET' && path === '/api/provider-limits') return json(res, 200, await live.providerLimits());
      if (req.method === 'GET' && path === '/api/editors') return json(res, 200, live.editors());
      if (req.method === 'GET' && path === '/api/connections') return json(res, 200, await live.connections());
      if (req.method === 'POST' && path === '/api/providers') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 200, live.setProvider(await body(req)));
      }
      if (req.method === 'POST' && path === '/api/local-endpoints') return json(res, 200, live.setLocalEndpoints(await jsonBody(req)));
      if (req.method === 'POST' && path === '/api/local-agent') return json(res, 200, live.setLocalAgent(await jsonBody(req)));
      if (req.method === 'GET' && path === '/api/connectors') return json(res, 200, live.connectorList);
      if (req.method === 'POST' && path === '/api/connectors') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 200, live.setGlobalConnector(await body(req)));
      }
      if (path.startsWith('/api/connectors/plugins')) { const result = await connectorPluginRoute(live, req, path); if (result) return json(res, ...result); }
      if (req.method === 'POST' && path === '/api/setup/complete') { await jsonBody(req); return json(res, 200, completeSetup(engine.store)); }
      if (req.method === 'GET' && path === '/api/settings') { const repository = url.searchParams.get('repository'); return json(res, 200, live.settingsRegistry.describe(repository ? { repository } : {})); }
      if (req.method === 'POST' && path === '/api/settings') { const input = await jsonBody(req); return json(res, 200, await live.settingsRegistry.set(input.key, input.value, input.repository ? { repository: input.repository } : {})); }
      if (req.method === 'POST' && path === '/api/access') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 200, live.setAccess(await body(req)));
      }
      if (req.method === 'POST' && path === '/api/branch-naming') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 200, live.setBranchNaming(await body(req)));
      }
      if (req.method === 'POST' && path === '/api/concurrency') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 200, { concurrency: engine.setConcurrency((await body(req)).concurrency) });
      }
      if (req.method === 'POST' && path === '/api/models/refresh') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        await body(req);
        return json(res, 200, await live.refreshModels());
      }
      if (req.method === 'POST' && path === '/api/models/tiers') return json(res, 200, live.setAutoTiers(await jsonBody(req)));
      if (req.method === 'POST' && path === '/api/models/enabled') return json(res, 200, live.setModelEnabled(await jsonBody(req)));
      const modelPath = path.match(/^\/api\/runs\/([a-f0-9-]+)\/model$/);
      if (req.method === 'POST' && modelPath) return json(res, 200, viewRun(live.switchModel(modelPath[1], await jsonBody(req))));
      if (req.method === 'GET' && path === '/api/projects') return json(res, 200, live.projects);
      if (req.method === 'GET' && path === '/api/folders') return json(res, 200, await listFolders(url.searchParams.get('path') ?? '~'));
      if (req.method === 'POST' && path === '/api/folders/pick') { const input = await jsonBody(req); return json(res, 200, await pickFolder({ multiple: input?.multiple === true })); }
      if (req.method === 'POST' && path === '/api/routing/preview') return json(res, 200, await live.router.preview(await jsonBody(req)));
      if (req.method === 'POST' && path === '/api/routing/link') return json(res, 200, live.router.link((await jsonBody(req)).ids));
      if (req.method === 'POST' && path === '/api/routing/dismiss') return json(res, 200, live.router.dismiss((await jsonBody(req)).ids));
      if (req.method === 'POST' && path === '/api/projects/inspect') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 200, await live.inspect((await body(req)).repositoryPath));
      }
      if (req.method === 'POST' && path === '/api/projects/add') {
        const input = await jsonBody(req);
        if (input.confirmed !== true) throw new InputError('Confirm the repository and trusted commands before enabling live execution.');
        const added = await live.repositories.add(input);
        return json(res, added.created ? 201 : 200, added);
      }
      if (req.method === 'POST' && path === '/api/projects/create') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 201, await live.createRepository(await body(req)));
      }
      const checksPath = path.match(/^\/api\/projects\/([a-f0-9-]+)\/checks$/);
      if (req.method === 'POST' && checksPath) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 200, live.addRecipeSteps(checksPath[1], await body(req)));
      }
      const instructionPath = path.match(/^\/api\/projects\/([a-f0-9-]+)\/instructions$/);
      if (req.method === 'POST' && instructionPath) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 200, live.addInstruction(instructionPath[1], await body(req)));
      }
      if (path.startsWith('/api/storage')) { const result = await storageRoute(storage, req, path); if (result) return json(res, ...result); }
      if (path.startsWith('/api/brain')) { const result = await brainRoute(live, req, path, url); if (result) return json(res, ...result); }
      const connectorPath = path.match(/^\/api\/projects\/([a-f0-9-]+)\/connectors$/);
      if (req.method === 'POST' && connectorPath) return json(res, 200, live.setConnector(connectorPath[1], await jsonBody(req)));
      const branchesPath = path.match(/^\/api\/projects\/([a-f0-9-]+)\/branches$/);
      if (req.method === 'GET' && branchesPath) return json(res, 200, await live.landings.branches(branchesPath[1], { remote: url.searchParams.get('remote') === '1' }));
      if (req.method === 'POST' && path === '/api/pull-requests') return json(res, 200, { runs: (await live.pullRequests.open(await jsonBody(req))).map(viewRun) });
      if (req.method === 'POST' && path === '/api/landings') return json(res, 201, viewRun(await live.landings.create(await jsonBody(req))));
      const memoryPath = path.match(/^\/api\/projects\/([a-f0-9-]+)\/memory$/);
      if (req.method === 'GET' && memoryPath) return json(res, 200, live.projectMemory(memoryPath[1]));
      const projectPath = path.match(/^\/api\/projects(?:\/([a-f0-9-]+))?$/);
      if (req.method === 'POST' && projectPath) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 200, await live.saveProject(await body(req), projectPath[1]));
      }
      const historyPath = path.match(/^\/api\/runs\/([a-f0-9-]+)\/history$/);
      if (req.method === 'GET' && historyPath) {
        const current = engine.get(historyPath[1]), runs = [], seen = new Set([current.id]);
        let previous = current.previousRunId;
        while (previous && !seen.has(previous)) {
          const run = engine.runs.find(item => item.id === previous);
          if (!run) break;
          runs.push(viewRun(run)); seen.add(previous); previous = run.previousRunId;
        }
        return json(res, 200, runs);
      }
      const livePath = path.match(/^\/api\/runs\/([a-f0-9-]+)\/(diff|followup|interrupt|recipe|events)$/);
      if (livePath && req.method === 'POST' && ['followup', 'interrupt', 'recipe'].includes(livePath[2])) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        const input = await body(req, runBodyLimit);
        const action = { recipe: 'continueWithRecipe', interrupt: 'interrupt', followup: 'followup' }[livePath[2]];
        return json(res, 201, await live[action](livePath[1], input));
      }
      if (livePath && req.method === 'GET' && livePath[2] === 'diff') return json(res, 200, await live.diff(livePath[1]));
      if (livePath && req.method === 'GET' && livePath[2] === 'events') {
        engine.get(livePath[1]);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        let previous = '';
        const send = () => { const run = engine.get(livePath[1]), snapshot = JSON.stringify(run); if (snapshot !== previous) { previous = snapshot; res.write(`data: ${JSON.stringify(viewRun(run))}\n\n`); } };
        send(); const timer = setInterval(send, 500);
        const close = () => { clearInterval(timer); live.clients.delete(close); res.end(); };
        live.clients.add(close); req.on('close', close); return;
      }
      const offerPath = path.match(/^\/api\/runs\/([a-f0-9-]+)\/offers\/([a-f0-9-]+)(\/undo)?$/);
      if (req.method === 'POST' && offerPath) { const input = await jsonBody(req); return json(res, 200, offerPath[3] ? await live.undoOffer(offerPath[1], offerPath[2]) : await live.answerOffer(offerPath[1], offerPath[2], input)); }
      const worktreePath = path.match(/^\/api\/runs\/([a-f0-9-]+)\/worktree\/remove$/);
      if (req.method === 'POST' && worktreePath) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        await body(req);
        return json(res, 200, viewRun(await live.removeWorktree(worktreePath[1])));
      }
      const openPath = path.match(/^\/api\/runs\/([a-f0-9-]+)\/open$/);
      if (req.method === 'POST' && openPath) { const input = await jsonBody(req); return json(res, 200, await live.openWorkspace(openPath[1], input.target, input.editor)); }
      const stoppedRunPath = path.match(/^\/api\/runs\/([a-f0-9-]+)\/(accept-preexisting|finish-as-is)$/);
      if (req.method === 'POST' && stoppedRunPath) {
        await jsonBody(req);
        const action = { 'accept-preexisting': 'acceptPreexisting', 'finish-as-is': 'finishAsIs' }[stoppedRunPath[2]];
        return json(res, 201, viewRun(await live[action](stoppedRunPath[1])));
      }
      const deliveryRepair = path.match(/^\/api\/runs\/([a-f0-9-]+)\/delivery\/repair$/);
      if (req.method === 'POST' && deliveryRepair) { const input = await jsonBody(req); return json(res, 201, await live.pullRequests.repair(deliveryRepair[1], input.reason ?? 'ci')); }
      const pullRequest = path.match(/^\/api\/runs\/([a-f0-9-]+)\/delivery\/pull-request$/);
      if (req.method === 'POST' && pullRequest) { const input = await jsonBody(req); return json(res, 200, viewRun(await live.openPullRequest(pullRequest[1], { base: input.base }))); }
      const deliveryRefresh = path.match(/^\/api\/runs\/([a-f0-9-]+)\/delivery\/refresh$/);
      if (req.method === 'POST' && deliveryRefresh) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        await body(req);
        return json(res, 200, await live.refreshDelivery(deliveryRefresh[1]));
      }
      const startNow = path.match(/^\/api\/runs\/([a-f0-9-]+)\/start$/);
      if (req.method === 'POST' && startNow) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        await body(req);
        return json(res, 200, engine.startNow(startNow[1]));
      }
      const cancel = path.match(/^\/api\/runs\/([a-f0-9-]+)\/cancel$/);
      if (req.method === 'POST' && cancel) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('Use application/json', 415);
        return json(res, 200, engine.cancel(cancel[1]));
      }
      if (await evidenceRoute({ live, engine, viewRun, traceViewer }, req, res, url, path)) return;
      const clientRoute = /^\/(?:setup(?:\/keyboard|\/integrations)?|brain|admin(?:\/projects(?:\/(?:new|[a-f0-9-]+))?)?|runs\/[a-f0-9-]+)?$/.test(path);
      const clientAsset = /^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(path);
      if (req.method === 'GET' && (clientRoute || clientAsset)) {
        const name = clientRoute ? 'index.html' : path, content = appAssets.get(name);
        if (!content) throw new InputError(clientRoute ? 'Frontend unavailable. Build and restart dispatch.' : 'Asset not found', clientRoute ? 503 : 404);
        res.writeHead(200, { 'Content-Type': types[extname(name)] }); res.end(content); return;
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      json(res, error.status ?? 500, { error: error.status ? error.message : 'Unexpected server error. Inspect server logs.', ...(error.question ? { question: error.question } : {}) });
      if (!error.status) console.error(error);
    }
  });
}
function serverPort(res) { return res.socket.localPort; }

// One local process owns each store. Crash recovery removes a stale PID lock.
export function acquireLock(directory) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'server.lock');
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid server.lock; inspect it before removing it.');
    try { process.kill(pid, 0); throw new Error(`dispatch data directory is in use by PID ${pid}`); }
    catch (error) { if (error.code !== 'ESRCH') throw error; unlinkSync(path); }
  }
  const fd = openSync(path, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
  return () => { if (existsSync(path) && readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path); };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dataDir = resolve(process.env.DISPATCH_DATA_DIR ?? join(root, '.dispatch'));
  const concurrency = Number(process.env.DISPATCH_CONCURRENCY ?? 1), port = Number(process.env.PORT ?? 4317);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > maxConcurrency) throw new Error(`DISPATCH_CONCURRENCY must be 1–${maxConcurrency}`);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const unlock = acquireLock(dataDir);
  let engine;
  try { engine = new Engine({ dataDir, concurrency }); } catch (error) { unlock(); throw error; }
  const updates = new Updates({ root, version: appVersion });
  const server = createServer(engine, { devFraming: process.env.DISPATCH_DEV_FRAMING === '1', updates });
  const stopChecking = updates.schedule();
  for (const failure of await engine.live.loadConnectors()) console.error(`dispatch: connector ${failure.path} did not load: ${failure.error}`);
  server.on('error', error => { unlock(); console.error(error); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => { console.log(`dispatch: http://127.0.0.1:${server.address().port}`); engine.pump(); });
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    stopChecking(); server.close(); await engine.shutdown(); unlock();
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
