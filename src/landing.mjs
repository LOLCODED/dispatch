import { join } from 'node:path';
import { InputError } from './engine.mjs';
import { labels, terminal } from './catalog.mjs';
import { latestRun, rootOf } from './conversations.mjs';
import { safeBranch } from './branch.mjs';
import { digest, git } from './local-tools.mjs';
import { isPlain } from './plain-folder.mjs';
import { commitMessage } from './conventional-commit.mjs';
import { coAuthored, commitIdentity } from './commit-identity.mjs';
import { committed, committedMember, deliverable, memberRecipe, memberWorkspace } from './linked-repositories.mjs';

export const strategies = ['squash', 'rebase', 'merge'];
const maxTasks = 20;
const succeeds = promise => promise.then(() => true, () => false);
const short = sha => sha.slice(0, 12);

export const landable = run => run.mode === 'live' && run.kind === 'change' && run.status === 'ready' && (deliverable(run) || (run.linked ?? []).some(committedMember)) && !run.answered && !run.landed && !run.supersededBy && !run.worktreeRemovedAt;

export const checkFailurePrompt = (target, check, merged, repository = null) => `${repository ? `In the linked repository ${repository.name} (worktree ${repository.workspace}): ` : ''}dispatch is landing this task on ${target}, and check ${check.name} failed on the combined result.${merged ? ` dispatch merged ${target} (at ${short(merged)}) into this branch without committing so you can fix it on top of the latest ${target}; keep the changes already on ${target}, and do not commit, abort the merge or run other Git commands that change history.` : ''} Fix the cause without changing the validation recipe, and make sure ${check.name} runs on your result.\n${JSON.stringify(check.command)}\n${String(check.output ?? '').slice(-16000)}`;

export const conflictPrompt = (target, sha, files, repository = null) => `${repository ? `In the linked repository ${repository.name} (worktree ${repository.workspace}): ` : ''}dispatch is landing this task on ${target} and merged ${target} (at ${short(sha)}) into this branch without committing. ${files.length ? `These files conflict: ${files.join(', ')}.` : 'Git could not apply this task on top of it.'} Resolve every conflict so both this task's change and the changes already on ${target} are kept, and remove all conflict markers. Do not commit, abort the merge or run other Git commands that change history; dispatch commits the merge after the checks pass.`;

export async function checkoutOf(root, branch, signal) {
  const blocks = (await git(root, ['worktree', 'list', '--porcelain'], { signal })).split('\n\n');
  const block = blocks.find(entry => entry.split('\n').includes(`branch refs/heads/${branch}`));
  return block?.match(/^worktree (.+)$/m)?.[1] ?? null;
}

async function targetHead(root, target, signal) {
  if (!safeBranch(target)) throw new InputError('Choose a valid target branch.');
  try { return await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${target}^{commit}`], { signal }); }
  catch { throw new InputError(`Branch ${target} does not exist in this repository.`); }
}

const changedPaths = (cwd, range, signal) => git(cwd, ['diff', '--name-only', '--no-renames', '-z', ...range], { signal }).then(output => output.split('\0').filter(Boolean));
const listed = files => `${files.slice(0, 5).join(', ')}${files.length > 5 ? ` and ${files.length - 5} more` : ''}`;

// Git keeps uncommitted edits through a fast-forward unless the landing changes the same files, so only those block it.
async function checkoutConflicts(root, target, touched, signal) {
  const path = await checkoutOf(root, target, signal);
  const files = path ? (await changedPaths(path, ['HEAD'], signal)).filter(file => touched.has(file)) : [];
  return { path, files };
}

function landingTargets(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(branch => !safeBranch(branch))) throw new InputError('Choose a valid target branch for each repository.');
  return value;
}

async function restore(workspace, sha, signal) {
  for (const args of [['merge', '--abort'], ['cherry-pick', '--abort']]) await git(workspace, args, { signal }).catch(() => {});
  await git(workspace, ['reset', '--hard', sha], { signal });
  await git(workspace, ['clean', '-fd'], { signal });
}

async function integrate(workspace, strategy, head, message, identity, signal) {
  const run = args => git(workspace, [...identity, ...args], { signal });
  if (strategy === 'merge') return run(['merge', '--no-ff', '-m', message, head]);
  if (strategy === 'rebase') {
    const base = await git(workspace, ['merge-base', 'HEAD', head], { signal });
    if (base !== head) await run(['cherry-pick', '--empty=drop', `${base}..${head}`]);
    return;
  }
  await run(['merge', '--squash', head]);
  if (!await succeeds(git(workspace, ['diff', '--cached', '--quiet'], { signal }))) await run(['commit', '-m', message]);
}

async function moveTarget({ root, target, head, baseSha, touched }, signal) {
  const { path, files } = await checkoutConflicts(root, target, touched, signal);
  if (files.length) throw new Error(`${target} has uncommitted changes to ${listed(files)} at ${path}.`);
  if (path) await git(path, ['merge', '--ff-only', head], { signal });
  else await git(root, ['update-ref', `refs/heads/${target}`, head, baseSha], { signal });
}

// A lane is one repository the landing moves: the task's own, or one of its linked repositories (run.linked).
const lanes = run => [...(run.landing.target ? [{ lane: null, label: run.landing.target, root: run.project.repositoryPath, target: run.landing.target, workspace: run.workspace, baseSha: run.baseSha }] : []),
  ...(run.linked ?? []).map(lane => ({ lane, label: `${lane.name} ${lane.baseBranch}`, root: lane.project.repositoryPath, target: lane.baseBranch, workspace: lane.workspace, baseSha: lane.baseSha }))];

// A landing is its own run: the engine queues, cancels and recovers it like any other, and no target branch moves until the combined result passes every repository's checks.
export class Landings {
  constructor(live) { this.live = live; this.engine = live.engine; }

  targetsOf(run) { return lanes(run).map(lane => `${lane.root}\0${lane.target}`); }

  tasks(runIds) {
    if (!Array.isArray(runIds) || !runIds.length || runIds.length > maxTasks || new Set(runIds).size !== runIds.length) throw new InputError(`Choose 1 to ${maxTasks} ready tasks to land.`);
    const runs = this.engine.runs, byId = new Map(runs.map(run => [run.id, run]));
    const tasks = runIds.map(id => latestRun(runs, this.engine.get(id)));
    for (const task of tasks) if (!landable(task)) throw new InputError(`"${task.title}" has no tested commit ready to land.`, 409);
    if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new InputError('Choose each task once.');
    if (new Set(tasks.map(task => task.projectId)).size !== 1) throw new InputError('Land tasks from one repository at a time.');
    const landing = tasks.map(task => this.landingOf(task)).find(Boolean);
    if (landing) throw new InputError(`A task is already being landed by "${landing.title}".`, 409);
    return tasks.sort((a, b) => Date.parse(rootOf(a, byId).createdAt) - Date.parse(rootOf(b, byId).createdAt));
  }

  landingOf(task) {
    return this.engine.runs.find(run => run.kind === 'landing' && !terminal.has(run.status) && run.landing.items.some(item => task.shadow ? item.runId === task.id : task.workspace === item.workspace)) ?? null;
  }

  async linkedLanes(tasks, targets, runId) {
    const members = tasks.flatMap(task => (task.linked ?? []).filter(committedMember)), ids = [...new Set(members.map(member => member.projectId))], taken = new Set();
    return Promise.all(ids.map(async id => {
      const project = structuredClone(this.live.projects.find(item => item.id === id) ?? members.find(member => member.projectId === id).project), target = targets[id] ?? project.baseBranch;
      const workspace = memberWorkspace(this.live.workspaceRoot, runId, project, taken);
      await targetHead(project.repositoryPath, target);
      return { projectId: id, name: project.name, project, baseBranch: target, branch: null, baseSha: null, workspace };
    }));
  }

  async create(input) {
    if (this.engine.stopping) throw new InputError('Server is stopping', 503);
    const strategy = input.strategy ?? 'squash';
    if (!strategies.includes(strategy)) throw new InputError(`Land by ${strategies.join(', ')}.`);
    const tasks = this.tasks(input.runIds), project = this.live.projects.find(item => item.id === tasks[0].projectId);
    if (!project) throw new InputError('Project not found', 404);
    const target = isPlain(project) || !tasks.some(deliverable) ? null : input.target ?? project.baseBranch;
    if (target) await targetHead(project.repositoryPath, target);
    const title = `Land ${tasks.length === 1 ? `"${tasks[0].title.slice(0, 80)}"` : `${tasks.length} tasks`}${target ? ` on ${target}` : ''}`;
    const ticket = { key: `landing:${digest(tasks.map(task => task.shadow ? task.id : task.workspace).sort())}`, title, description: tasks.map(task => `- ${task.ticketId}: ${task.title}`).join('\n'), acceptance: '', sourceUrl: null };
    this.live.exclude(ticket.key, project.id, null);
    const run = this.live.newRun(project, ticket, title), linked = await this.linkedLanes(tasks, landingTargets(input.targets), run.id);
    const items = tasks.map(task => ({ runId: task.id, ticketId: task.ticketId, title: task.title, branch: task.branch, workspace: task.workspace, message: commitMessage(task), status: 'pending' }));
    // A landing never touches a plain folder: its own workspace is a worktree path even when the primary repository is a folder, and only Git lanes move.
    Object.assign(run, { kind: 'landing', branch: null, baseBranch: target, landing: { target, strategy, items }, linked, workspace: join(this.live.workspaceRoot, run.id), shadow: null });
    this.engine.runs.unshift(run);
    const where = [...(target ? [target] : []), ...linked.map(lane => `${lane.name} on ${lane.baseBranch}`)];
    this.engine.event(run, 'queued', `Landing ${tasks.length} task${tasks.length === 1 ? '' : 's'} on ${where.join(', ')} by ${strategy}, oldest first.`);
    queueMicrotask(() => this.engine.pump());
    return run;
  }

  async branches(projectId, { remote = false } = {}) {
    const project = this.live.projects.find(item => item.id === projectId);
    if (!project) throw new InputError('Project not found', 404);
    if (isPlain(project)) return { base: null, branches: [] };
    const owned = new Set(this.engine.runs.map(run => run.branch).filter(Boolean));
    const list = (depth, ref) => git(project.repositoryPath, ['for-each-ref', `--format=%(refname:lstrip=${depth})`, ref]).then(output => output.split('\n'));
    const names = [...await list(2, 'refs/heads'), ...(remote ? await list(3, `refs/remotes/origin`) : [])];
    const available = [...new Set(names)].filter(branch => branch && branch !== 'HEAD' && !owned.has(branch));
    const preferred = [project.baseBranch, ...(project.targetBranches ?? [])].filter(branch => available.includes(branch));
    return { base: project.baseBranch, branches: [...preferred, ...available.filter(branch => !preferred.includes(branch))] };
  }

  async work(run, signal) {
    run.startedAt = new Date().toISOString();
    try {
      if (!await this.prepare(run, signal)) return;
      if (!await this.combine(run, signal)) return;
      if (!await this.check(run, signal)) return;
      await this.advance(run, signal);
    } catch (error) { if (!signal.aborted) this.engine.transition(run, 'failed', `${error.message.split('\n')[0]} Nothing landed.`); }
    finally { await this.live.stopDevServer(run); this.engine.store.save(); }
  }

  async prepare(run, signal) {
    const all = lanes(run);
    this.engine.transition(run, 'preparing', `Starting a landing worktree from ${all.map(lane => lane.label).join(', ')}.`);
    for (const lane of all) {
      const { path, files } = await checkoutConflicts(lane.root, lane.target, await this.taskPaths(run, lane, signal), signal);
      if (files.length) { this.engine.transition(run, 'blocked', `${lane.lane ? `${lane.lane.name}: ` : ''}${lane.target} is checked out at ${path} with uncommitted changes to ${listed(files)}, which this landing also changes. Commit or stash them, then land again. Nothing landed.`); return false; }
    }
    if (run.landing.target) {
      run.baseSha = await targetHead(run.project.repositoryPath, run.landing.target, signal);
      await git(run.project.repositoryPath, ['worktree', 'add', '--detach', run.workspace, run.baseSha], { signal });
      await this.live.copyLocalFiles(run, run.project, run.workspace, signal);
    }
    for (const lane of run.linked ?? []) {
      lane.baseSha = await targetHead(lane.project.repositoryPath, lane.baseBranch, signal);
      await git(lane.project.repositoryPath, ['worktree', 'add', '--detach', lane.workspace, lane.baseSha], { signal });
      await this.live.copyLocalFiles(run, lane.project, lane.workspace, signal, `${lane.name ?? lane.project.name}: `);
    }
    this.engine.store.save(); return true;
  }

  async taskPaths(run, lane, signal) {
    const tasks = run.landing.items.map(item => this.engine.get(item.runId));
    const heads = tasks.map(task => lane.lane ? this.memberOf(task, lane.lane)?.headSha : task.headSha).filter(Boolean);
    return new Set((await Promise.all(heads.map(head => changedPaths(lane.root, [`${lane.target}...${head}`], signal)))).flat());
  }

  async combine(run, signal) {
    for (const item of run.landing.items) if (!await this.landItem(run, item, signal)) return false;
    return true;
  }

  async landItem(run, item, signal) {
    for (const lane of [...(run.landing.target ? [null] : []), ...run.linked ?? []]) if (!await this.landLane(run, item, lane, signal)) return false;
    return true;
  }

  async landLane(run, item, lane, signal) {
    const where = lane ? `${lane.baseBranch} in ${lane.name}` : run.landing.target;
    if (lane && !this.memberOf(this.engine.get(item.runId), lane)) return true;
    this.engine.transition(run, 'landing', `Applying ${item.ticketId} onto ${where}.`);
    if (await this.apply(run, item, this.engine.get(item.runId), lane, signal)) return true;
    if (signal.aborted) return false;
    const resolved = await this.resolve(run, item, lane, signal);
    if (!resolved) return false;
    if (await this.apply(run, item, resolved, lane, signal)) return true;
    if (!signal.aborted) this.engine.transition(run, 'failed', `${item.ticketId} still conflicts with ${where} after its agent resolved it. Nothing landed.`);
    return false;
  }

  memberOf(task, lane) { return task.linked?.find(member => member.projectId === lane.projectId && committedMember(member)) ?? null; }

  async apply(run, item, task, lane, signal) {
    const workspace = lane?.workspace ?? run.workspace, head = lane ? this.memberOf(task, lane).headSha : task.headSha;
    const before = await git(workspace, ['rev-parse', 'HEAD'], { signal });
    const merges = Number(await git(workspace, ['rev-list', '--merges', '--count', `${before}..${head}`], { signal }));
    const strategy = run.landing.strategy === 'rebase' && merges ? 'squash' : run.landing.strategy;
    const identity = await commitIdentity(workspace, { signal }), message = coAuthored(item.message ?? commitMessage(task), lane?.project ?? run.project);
    const record = lane ? ((item.linked ??= {})[lane.projectId] ??= {}) : item;
    if (await succeeds(integrate(workspace, strategy, head, message, identity, signal))) {
      Object.assign(record, { status: 'applied', landedAs: strategy, commit: await git(workspace, ['rev-parse', 'HEAD'], { signal }) });
      item.runId = task.id;
      this.live.log(run, 'landing', `${item.ticketId} applied${lane ? ` in ${lane.name}` : ''} by ${strategy}${strategy === run.landing.strategy ? '' : ' (its history holds a conflict-resolution merge, so it lands as one commit)'}.`);
      this.engine.store.save(); return true;
    }
    record.conflicts = (await git(workspace, ['diff', '--name-only', '--diff-filter=U'], { signal }).catch(() => '')).split('\n').filter(Boolean);
    await restore(workspace, before, signal);
    return false;
  }

  async resolve(run, item, lane, signal) {
    const target = lane?.baseBranch ?? run.landing.target, head = await git(lane?.workspace ?? run.workspace, ['rev-parse', 'HEAD'], { signal });
    const conflicts = (lane ? item.linked[lane.projectId] : item).conflicts, task = this.engine.get(item.runId);
    this.live.log(run, 'landing', `${item.ticketId} conflicts with ${target}${lane ? ` in ${lane.name}` : ''}${conflicts.length ? ` in ${conflicts.join(', ')}` : ''}. Its agent resolves them in its own session.`);
    return this.handBack(run, item, lane, { input: conflictPrompt(target, head, conflicts, lane && this.memberOf(task, lane)), mergeIn: head, purpose: 'conflict resolution', record: 'resolutionRunId' }, signal);
  }

  // The task's own session gets the work back; the landing waits for it and continues only from a ready, committed result.
  async handBack(run, item, lane, { input, mergeIn, purpose, record }, signal) {
    let next = null;
    try {
      next = await this.live.followup(item.runId, { input }, { mergeIn, mergeInto: mergeIn ? lane?.projectId : undefined, byLanding: true });
      this.engine.startNow(next.id);
    } catch (error) {
      if (next && !terminal.has(next.status)) this.engine.cancel(next.id, `Landing could not start the ${purpose}.`);
      this.engine.transition(run, 'blocked', `${item.ticketId} could not go back to its agent for the ${purpose}: ${error.message} Nothing landed.`); return null;
    }
    item[record] = next.id; this.engine.store.save();
    await this.settle(next, signal);
    if (signal.aborted) return null;
    if (next.status === 'ready' && next.headSha && (!lane || this.memberOf(next, lane))) return next;
    this.engine.transition(run, 'blocked', `${item.ticketId}: the ${purpose} ended as ${labels[next.status] ?? next.status}. Open it to continue, then land again. Nothing landed.`);
    return null;
  }

  async settle(next, signal) {
    const abort = () => { if (!terminal.has(next.status)) this.engine.cancel(next.id, 'Landing cancelled. The merge is left uncommitted in the worktree.'); };
    signal.addEventListener('abort', abort, { once: true });
    try { await this.engine.active.get(next.id)?.promise; } finally { signal.removeEventListener('abort', abort); }
  }

  // A single task whose combined result fails a check goes back to its own session once; with several tasks dispatch cannot tell which one broke it.
  async check(run, signal) {
    for (run.attempt = 1; ; run.attempt++) {
      const failure = await this.failure(run, signal);
      if (!failure) return failure === null;
      if (run.attempt > 1 || run.landing.items.length > 1) { this.fail(run, failure); return false; }
      if (!await this.repair(run, failure, signal) || !await this.restart(run, signal)) return false;
    }
  }

  // Resolves to null when every check passed, false when the landing stopped, or the failed check.
  async failure(run, signal) {
    const own = await this.checkOwn(run, signal);
    return own === null ? this.checkLinked(run, signal) : own;
  }

  async repair(run, failure, signal) {
    const [item] = run.landing.items, task = this.engine.get(item.runId);
    const lane = failure.linked ? run.linked.find(entry => entry.projectId === failure.linked) : null, target = lane?.baseBranch ?? run.landing.target;
    const base = lane?.baseSha ?? run.baseSha, head = lane ? this.memberOf(task, lane).headSha : task.headSha;
    const mergeIn = await succeeds(git(lane?.workspace ?? run.workspace, ['merge-base', '--is-ancestor', base, head], { signal })) ? null : base;
    this.engine.transition(run, 'landing', `Check ${failure.name} failed on the combined result. ${item.ticketId} goes back to its agent to fix it in its own session.`);
    const input = checkFailurePrompt(target, failure, mergeIn, lane && this.memberOf(task, lane));
    const next = await this.handBack(run, item, lane, { input, mergeIn, purpose: 'check repair', record: 'repairRunId' }, signal);
    if (next) item.runId = next.id;
    return Boolean(next);
  }

  async restart(run, signal) {
    for (const lane of lanes(run)) await restore(lane.workspace, lane.baseSha, signal);
    this.engine.transition(run, 'landing', 'Applying the repaired task again and rechecking the combined result.');
    return this.combine(run, signal);
  }

  fail(run, failure) {
    const several = run.landing.items.length > 1;
    this.engine.transition(run, 'failed', `Check ${failure.name} failed on the combined result${several ? '' : ' after its agent repaired it'}, so ${run.linked?.length ? 'no branch moved' : `${run.landing.target} did not move`}. ${several ? 'Land the tasks one at a time so a failure goes back to the task that caused it.' : 'Open the task to continue, then land again.'}`);
  }

  async checkOwn(run, signal) {
    if (!run.landing.target) return null;
    if (!await this.live.setup(run, signal)) return false;
    const head = await git(run.workspace, ['rev-parse', 'HEAD^{tree}'], { signal });
    run.revision = await this.live.tree(run, signal);
    if (run.revision !== head) { this.engine.transition(run, 'failed', 'Repository setup changed tracked files in the landing worktree, so the combined result could not be checked. Nothing landed.'); return false; }
    run.changedPaths = (await git(run.workspace, ['diff', '--name-only', '-z', run.baseSha, run.revision], { signal })).split('\0').filter(Boolean);
    if (!run.changedPaths.length) return null;
    run.protectedDigest = this.live.protectedRecipe(run);
    const files = this.live.steps.append(run, { kind: 'files', paths: run.changedPaths, revision: run.revision });
    await this.live.savePatch(run, files.id, signal);
    return this.verdict(run, await this.ownFailure(run, signal), signal);
  }

  // A check a landed task accepted as failing before it passes the landing too, but only while it also fails on the
  // base the landing targets; without an acceptance the landing stops at the first failure as before.
  async ownFailure(run, signal) {
    const accepted = new Set(run.landing.items.flatMap(item => this.engine.get(item.runId)?.acceptedFailures ?? []).map(item => item.name));
    if (!accepted.size) return this.live.validate(run, signal);
    const from = run.checks.length;
    if (!await this.live.validate(run, signal, { all: true })) return null;
    for (const check of run.checks.slice(from).filter(item => item.status === 'failed')) {
      if (signal.aborted || !accepted.has(check.name) || !await this.live.baseChecks.failsOnBase(run, check, signal)) return check;
      check.accepted = { by: 'operator', at: new Date().toISOString() };
      this.live.steps.append(run, { kind: 'check.accepted', name: check.name, revision: check.revision });
      this.live.log(run, 'check', `${check.name} failed as it does on ${run.landing.target}; a landed task accepted it as failing before the change.`);
    }
    return null;
  }

  async checkLinked(run, signal) {
    if (!run.linked?.length) return null;
    if (!await this.live.linked.setup(run, signal)) return false;
    for (const lane of run.linked) {
      const head = await git(lane.workspace, ['rev-parse', 'HEAD^{tree}'], { signal });
      lane.revision = await this.live.tree(run, signal, lane.workspace);
      if (lane.revision !== head) { this.engine.transition(run, 'failed', `Repository setup changed tracked files in the ${lane.name} landing worktree, so the combined result could not be checked. Nothing landed.`); return false; }
      lane.changedPaths = (await git(lane.workspace, ['diff', '--name-only', '-z', lane.baseSha, lane.revision], { signal })).split('\0').filter(Boolean);
      lane.protectedDigest = memberRecipe(lane);
    }
    return this.verdict(run, await this.live.linked.validate(run, signal), signal);
  }

  verdict(run, failure, signal) {
    if (signal.aborted || run.status === 'blocked') return false;
    return failure ?? null;
  }

  async advance(run, signal) {
    const all = lanes(run);
    for (const lane of all) {
      lane.head = await git(lane.workspace, ['rev-parse', 'HEAD'], { signal });
      lane.touched = new Set(await changedPaths(lane.workspace, [lane.baseSha, lane.head], signal));
    }
    const moving = all.filter(lane => lane.head !== lane.baseSha);
    this.engine.transition(run, 'landing', moving.length ? `Moving ${moving.map(lane => `${lane.label} from ${short(lane.baseSha)} to ${short(lane.head)}`).join('; ')}.` : `${run.landing.target} already holds these changes.`);
    for (const lane of moving) {
      const { path, files } = await checkoutConflicts(lane.root, lane.target, lane.touched, signal);
      if (files.length) { this.engine.transition(run, 'failed', `${lane.label} could not move to ${short(lane.head)}: ${lane.target} has uncommitted changes to ${listed(files)} at ${path}. The combined commit stays in the landing worktree. Nothing landed.`); return; }
    }
    const moved = [];
    for (const lane of moving) {
      try { await moveTarget(lane, signal); moved.push(`${lane.label} at ${short(lane.head)}`); }
      catch (error) { this.engine.transition(run, 'failed', `${lane.label} could not move to ${short(lane.head)}: ${error.message.split('\n')[0]} The combined commit stays in the landing worktree. ${moved.length ? `Already landed: ${moved.join(', ')}; move ${lane.label} by hand or land again.` : 'Nothing landed.'}`); return; }
    }
    run.headSha = run.landing.target ? all[0].head : null; run.landing.head = run.headSha; run.landing.landedAt = new Date().toISOString();
    for (const lane of all.filter(lane => lane.lane)) lane.lane.headSha = lane.head;
    await this.finish(run);
  }

  async finish(run) {
    const { items, target, strategy } = run.landing, linked = (run.linked ?? []).filter(lane => lane.headSha !== lane.baseSha).map(lane => ({ projectId: lane.projectId, name: lane.name, target: lane.baseBranch, commit: lane.headSha }));
    for (const item of items) {
      const task = this.engine.get(item.runId);
      item.status = 'landed'; task.landed = { runId: run.id, target, commit: run.headSha, at: run.landing.landedAt, ...(linked.length ? { linked } : {}) };
      try { if (task.shadow) await this.live.linked.remove(task, { landed: true }); else await this.live.removeWorktree(item.runId, { landed: true }); } catch (error) { this.live.log(run, 'landing', `${item.ticketId} kept its worktree: ${error.message}`); }
    }
    for (const lane of lanes(run)) await git(lane.root, ['worktree', 'remove', '--force', lane.workspace]).catch(error => this.live.log(run, 'landing', `Landing worktree kept: ${error.message.split('\n')[0]}`));
    run.worktreeRemovedAt = new Date().toISOString();
    const own = target ? `${target} at ${short(run.headSha)}` : '', others = linked.map(lane => `${lane.name} on ${lane.target} at ${short(lane.commit)}`).join(', ');
    this.engine.transition(run, 'ready', `Landed ${items.length} task${items.length === 1 ? '' : 's'} on ${own && others ? `${own}, and ${others}` : own || others} by ${strategy}. Task worktrees and branches removed; nothing pushed.`);
  }
}
