// Explicit opt-in: replays a finished ticket with your signed-in agent CLI against throwaway clones of its repositories.
// Usage: node scripts/ticket-replay.mjs --ticket <link or text> --repo <path>@<commit> [--repo …] --out <dir>
//   [--tracker <connector folder>] [--project <overrides.json>] [--provider claude|codex] [--max-followups 6] [--keep] [--as-written]
// The ticket is read as it stood before the work (shipped PRs, commits and "Done:" notes removed) unless --as-written.
// Nothing leaves the machine: every connector write action is off, the agent has no network hosts, no env files are copied.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { runInsights } from '../src/analytics.mjs';
import { terminal } from '../src/catalog.mjs';
import { Engine } from '../src/engine.mjs';
import { LiveService } from '../src/live.mjs';
import { git } from '../src/local-tools.mjs';
import { repositoryInput } from '../src/repository-setup.mjs';
import { contamination, interactionAnswers, nextMove } from './replay-operator.mjs';
import { readPreWork } from './replay-ticket.mjs';

const replayBranch = 'replay-base';

// A fresh repository fetching only the base commit holds no object, ref, tag, remote or reflog from after it,
// so the agent cannot find the change that later shipped.
export async function sandboxRepository(source, commit, directory) {
  const target = join(directory, basename(resolve(source)));
  mkdirSync(directory, { recursive: true });
  await git(directory, ['init', '--quiet', target]);
  const local = await git(resolve(source), ['cat-file', '-e', `${commit}^{commit}`]).then(() => true, () => false);
  const from = local ? pathToFileURL(resolve(source)).href : await git(resolve(source), ['remote', 'get-url', 'origin']);
  await git(target, ['fetch', '--quiet', '--no-tags', from, commit]);
  await git(target, ['checkout', '--quiet', '-b', replayBranch, commit]);
  rmSync(join(target, '.git', 'FETCH_HEAD'), { force: true });
  await assertNoLaterHistory(target, commit);
  return target;
}

export async function assertNoLaterHistory(target, commit) {
  const refs = (await git(target, ['for-each-ref', '--format=%(refname)'])).split('\n').filter(Boolean);
  const reachable = Number(await git(target, ['rev-list', '--all', '--reflog', '--count'])), base = Number(await git(target, ['rev-list', '--count', commit]));
  if (refs.join() !== `refs/heads/${replayBranch}` || reachable !== base || await git(target, ['remote'])) throw new Error(`${target} holds history beyond ${commit}.`);
}

function connectorSettings(registry, tracker) {
  const entries = registry.ids().map(id => [id, { enabled: false, actions: offActions(registry.get(id)) }]);
  const settings = Object.fromEntries(entries);
  if (tracker) settings[tracker] = { enabled: true, actions: { ...offActions(registry.get(tracker)), ...readHooks(registry.get(tracker)) } };
  return settings;
}
const offActions = connector => Object.fromEntries(Object.keys(connector.actions).map(key => [key, false]));
const readHooks = connector => Object.fromEntries(Object.entries(connector.actions).filter(([, action]) => Object.keys(action.hooks ?? {}).some(hook => hook.startsWith('ticket.') && action.access === 'read')).map(([key]) => [key, true]));

export function sandboxInput(info, overrides, connectors) {
  const input = { ...repositoryInput(info), ...overrides };
  return { ...input, connectors, network: { hosts: [], localPorts: false }, databases: [], services: [], localFiles: [], linkedEnv: {}, trackRemote: false, baseBranch: replayBranch, confirmed: true };
}

export function assertSandboxed(live, projects) {
  for (const project of projects) {
    for (const id of live.registry.ids()) {
      const connector = live.registry.get(id);
      const writes = Object.entries(connector.actions).filter(([, action]) => action.access !== 'read').map(([key]) => key);
      if (live.connectors.active(project, id) && writes.some(key => project.connectors?.[id]?.actions?.[key] !== false)) throw new Error(`${project.name}: ${id} has a write action on.`);
    }
    if (project.network?.hosts?.length || project.network?.localPorts || project.databases?.length || project.trackRemote) throw new Error(`${project.name} can reach something outside the sandbox.`);
  }
}

async function setup(args, directory) {
  const engine = new Engine({ dataDir: join(directory, 'data') }), live = new LiveService(engine);
  live.providers.setEnabled(args.provider, true);
  for (const id of live.providers.enabledIds()) if (id !== args.provider) live.providers.setEnabled(id, false);
  for (const failure of await live.loadConnectors()) console.error(`connector ${failure.path}: ${failure.error}`);
  const tracker = args.tracker ? (await live.connectorPlugins.add(resolve(args.tracker))).id : null, strippedFromTicket = [];
  if (tracker && !args['as-written']) readPreWork(live.registry.get(tracker), strippedFromTicket);
  const overrides = args.project ? JSON.parse(readFileSync(args.project, 'utf8')) : {};
  const projects = [];
  for (const spec of args.repo) {
    const [path, commit] = spec.split('@');
    const clone = await sandboxRepository(path, commit, join(directory, 'repos'));
    const info = await live.inspect(clone);
    projects.push(await live.saveProject(sandboxInput(info, overrides[basename(resolve(path))] ?? overrides['*'] ?? {}, connectorSettings(live.registry, tracker))));
  }
  assertSandboxed(live, projects);
  return { engine, live, projects, strippedFromTicket };
}

async function workspaceTree(live, run) {
  const spaces = [run.workspace, ...(run.linked ?? []).map(member => member.workspace)];
  try { return (await Promise.all(spaces.map(space => live.tree(run, AbortSignal.timeout(60_000), space)))).join(':'); } catch { return null; }
}

function record(run, tree, previousTree, started) {
  const insights = runInsights(run);
  return {
    id: run.id, status: run.status, asIs: run.asIs === true, question: run.question ?? null, summary: run.summary?.slice(0, 4000) ?? null,
    changedFiles: tree !== null && tree === previousTree ? 0 : null, tree, tokens: insights.tokens, elapsedMs: insights.elapsedMs, repairs: insights.repairs,
    checks: (run.checks ?? []).map(check => ({ name: check.name, status: check.status, base: check.base ?? null, revision: check.revision?.slice(0, 12) ?? null })),
    events: run.events.map(event => `${event.kind}: ${event.message}`.slice(0, 400)), sinceStartMs: Date.now() - started,
  };
}

const shownEvents = new Map();
function echo(run) {
  const from = shownEvents.get(run.id) ?? 0;
  for (const event of run.events.slice(from)) console.log(`${run.id.slice(0, 8)} ${event.kind}: ${event.message.replace(/\s+/g, ' ').slice(0, 240)}`);
  shownEvents.set(run.id, run.events.length);
}

async function settle(live, run, friction) {
  while (!terminal.has(run.status) || live.engine.active.has(run.id)) {
    echo(run);
    const pending = live.interactions.pending.get(run.id);
    if (pending?.request.status === 'pending') {
      const { answers, notes } = interactionAnswers(pending.request);
      friction.push(...notes.map(note => ({ runId: run.id, kind: 'interaction', ...note })));
      try { live.interactions.answer(run.id, { requestId: pending.request.id, answers }); } catch (error) { console.error(`answer failed: ${error.message}`); }
    }
    await sleep(1000);
  }
  echo(run);
}

async function act(live, run, move) {
  if (move.kind === 'accept-preexisting') return live.acceptPreexisting(run.id);
  if (move.kind === 'finish-as-is') return live.finishAsIs(run.id);
  return live.followup(run.id, { input: move.input });
}

async function drive(live, first, { maxFollowups }) {
  const started = Date.now(), friction = [], runs = [], moves = [];
  let run = first, previousTree = null;
  for (;;) {
    await settle(live, run, friction);
    const tree = await workspaceTree(live, run);
    runs.push(record(run, tree, previousTree, started)); previousTree = tree;
    console.log(`${run.id.slice(0, 8)} ${run.status}${run.question ? `: ${run.question.split('\n')[0].slice(0, 200)}` : ''}`);
    const move = nextMove(run);
    if (move.kind === 'done') break;
    if (move.kind === 'outage') { moves.push(move); break; }
    if (moves.length >= maxFollowups) { moves.push({ kind: 'cap' }); break; }
    if (run.question) friction.push({ runId: run.id, kind: 'blocked', header: 'Blocked question', question: run.question, answer: move.input ?? move.kind });
    moves.push(move);
    try { run = await act(live, run, move); } catch (error) { moves.push({ kind: 'refused', error: error.message }); break; }
  }
  return { runs, moves, friction, last: run, wallMs: Date.now() - started };
}

async function finalDiff(run) {
  const parts = [];
  for (const space of [{ workspace: run.workspace, baseSha: run.baseSha, name: 'primary' }, ...(run.linked ?? [])]) {
    if (!space.workspace || !space.baseSha) continue;
    try {
      await git(space.workspace, ['add', '--intent-to-add', '--all']);
      parts.push(`# ${space.name ?? space.projectId}\n${await git(space.workspace, ['diff', '--no-ext-diff', space.baseSha, '--'], { maxOutput: 5_000_000 })}`);
    } catch (error) { parts.push(`# ${space.name ?? space.projectId}: diff failed: ${error.message.split('\n')[0]}`); }
  }
  return parts.join('\n');
}

function summarize(result, ticket, outsideRoots) {
  const questions = result.friction.map(item => `${item.header ?? ''} ${item.question}`.trim());
  const repeated = questions.filter((question, index) => questions.indexOf(question) !== index);
  const tokens = result.runs.reduce((sum, run) => ({ input: sum.input + (run.tokens.input ?? 0), cachedInput: sum.cachedInput + (run.tokens.cachedInput ?? 0), output: sum.output + (run.tokens.output ?? 0) }), { input: 0, cachedInput: 0, output: 0 });
  const last = result.runs.at(-1), checks = last?.checks ?? [];
  return {
    ticket, status: last?.status ?? 'none', outage: result.moves.some(move => move.kind === 'outage'), loop: result.moves.some(move => move.kind === 'cap'), turns: result.runs.length, followups: result.moves.filter(move => !['cap', 'outage'].includes(move.kind)).length,
    questions: result.friction.length, repeatedQuestions: [...new Set(repeated)], turnsWithoutChanges: result.runs.filter(run => run.changedFiles === 0).length,
    tokens, wallMs: result.wallMs, checksRun: checks.length, checksPassed: checks.filter(check => check.status === 'passed').length,
    contamination: contamination(result.runs, outsideRoots, result.friction),
  };
}

const options = { ticket: { type: 'string' }, repo: { type: 'string', multiple: true }, out: { type: 'string' }, tracker: { type: 'string' }, project: { type: 'string' }, provider: { type: 'string', default: 'claude' }, 'max-followups': { type: 'string', default: '6' }, keep: { type: 'boolean', default: false }, 'as-written': { type: 'boolean', default: false } };

async function main() {
  const { values: args } = parseArgs({ options });
  if (!args.ticket || !args.repo?.length || !args.out) throw new Error('Give --ticket, at least one --repo <path>@<commit>, and --out.');
  const directory = mkdtempSync(join(tmpdir(), 'dispatch-replay-')), out = resolve(args.out);
  mkdirSync(out, { recursive: true });
  const { engine, live, projects, strippedFromTicket } = await setup(args, directory);
  const stop = async () => { await engine.shutdown(); if (!args.keep) rmSync(directory, { recursive: true, force: true }); process.exit(1); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    const input = { input: args.ticket, execution: 'auto', ...(projects.length > 1 ? { projectIds: projects.map(project => project.id) } : { projectId: projects[0].id }) };
    const result = await drive(live, await live.create(input), { maxFollowups: Number(args['max-followups']) });
    writeFileSync(join(out, 'diff.patch'), await finalDiff(result.last));
    const summary = summarize(result, args.ticket, [...new Set(args.repo.map(spec => dirname(resolve(spec.split('@')[0]))))]);
    writeFileSync(join(out, 'replay.json'), JSON.stringify({ summary, strippedFromTicket: [...new Set(strippedFromTicket)], ...result, last: undefined }, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await engine.shutdown();
    if (!args.keep) rmSync(directory, { recursive: true, force: true }); else console.log(`kept ${directory}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error); process.exitCode = 1; });
