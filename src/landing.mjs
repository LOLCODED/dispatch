import { join } from 'node:path';
import { InputError } from './engine.mjs';
import { labels, terminal } from './catalog.mjs';
import { latestRun, rootOf } from './conversations.mjs';
import { safeBranch } from './branch.mjs';
import { digest, git } from './local-tools.mjs';
import { isPlain } from './plain-folder.mjs';
import { commitMessage } from './conventional-commit.mjs';
import { coAuthored, commitIdentity } from './commit-identity.mjs';
import { committedMember, memberRecipe, memberWorkspace } from './linked-repositories.mjs';

export const strategies = ['squash', 'rebase', 'merge'];
const maxTasks = 20;
const succeeds = promise => promise.then(() => true, () => false);
const short = sha => sha.slice(0, 12);

export const landable = run => run.mode === 'live' && run.kind === 'change' && run.status === 'ready' && (Boolean(run.headSha) || (run.linked ?? []).some(committedMember)) && !run.answered && !run.landed && !run.supersededBy && !run.worktreeRemovedAt;

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

async function dirtyCheckout(root, target, signal) {
  const path = await checkoutOf(root, target, signal);
  return path && await git(path, ['status', '--porcelain', '--untracked-files=no'], { signal }) ? path : null;
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

async function moveTarget({ root, target, head, baseSha }, signal) {
  const path = await checkoutOf(root, target, signal);
  if (path && await dirtyCheckout(root, target, signal)) throw new Error(`${target} has uncommitted changes at ${path}.`);
  if (path) await git(path, ['merge', '--ff-only', head], { signal });
  else await git(root, ['update-ref', `refs/heads/${target}`, head, baseSha], { signal });
}

// A lane is one repository the landing moves: the task's own, or one of its linked repositories (run.linked).
const lanes = run => [...(run.landing.target ? [{ lane: null, label: run.landing.target, root: run.project.repositoryPath, target: run.landing.target, workspace: run.workspace, baseSha: run.baseSha }] : []),
  ...(run.linked ?? []).map(lane => ({ lane, label: `${lane.name} ${lane.baseBranch}`, root: lane.project.repositoryPath, target: lane.baseBranch, workspace: lane.workspace, baseSha: lane.baseSha }))];

// A landing is its own run: the engine queues, cancels and recovers it like any other, and no target branch moves until the combined result passes every repository's checks.
export class Landings {
  constructor(live) { this.live = live; this.engine = live.engine; }

  tasks(runIds) {
    if (!Array.isArray(runIds) || !runIds.length || runIds.length > maxTasks || new Set(runIds).size !== runIds.length) throw new InputError(`Choose 1 to ${maxTasks} ready tasks to land.`);
    const runs = this.engine.runs, byId = new Map(runs.map(run => [run.id, run]));
    const tasks = runIds.map(id => latestRun(runs, this.engine.get(id)));
    for (const task of tasks) if (!landable(task)) throw new InputError(`"${task.title}" has no tested commit ready to land.`, 409);
    if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new InputError('Choose each task once.');
    if (new Set(tasks.map(task => task.projectId)).size !== 1) throw new InputError('Land tasks from one repository at a time.');
    const landing = runs.find(run => run.kind === 'landing' && !terminal.has(run.status) && run.landing.items.some(item => tasks.some(task => task.shadow ? item.runId === task.id : task.workspace === item.workspace)));
    if (landing) throw new InputError(`A task is already being landed by "${landing.title}".`, 409);
    return tasks.sort((a, b) => Date.parse(rootOf(a, byId).createdAt) - Date.parse(rootOf(b, byId).createdAt));
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
    const target = isPlain(project) ? null : input.target ?? project.baseBranch;
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
    return { base: project.baseBranch, branches: [...new Set(names)].filter(branch => branch && branch !== 'HEAD' && !owned.has(branch)) };
  }

  async work(run, signal) {
    run.startedAt = new Date().toISOString();
    try {
      if (!await this.prepare(run, signal)) return;
      for (const item of run.landing.items) if (!await this.landItem(run, item, signal)) return;
      if (!await this.check(run, signal)) return;
      await this.advance(run, signal);
    } catch (error) { if (!signal.aborted) this.engine.transition(run, 'failed', `${error.message.split('\n')[0]} Nothing landed.`); }
    finally { await this.live.stopDevServer(run); this.engine.store.save(); }
  }

  async prepare(run, signal) {
    const all = lanes(run);
    this.engine.transition(run, 'preparing', `Starting a landing worktree from ${all.map(lane => lane.label).join(', ')}.`);
    for (const lane of all) {
      const dirty = await dirtyCheckout(lane.root, lane.target, signal);
      if (dirty) { this.engine.transition(run, 'blocked', `${lane.lane ? `${lane.lane.name}: ` : ''}${lane.target} is checked out at ${dirty} with uncommitted changes. Commit or stash them, then land again. Nothing landed.`); return false; }
    }
    if (run.landing.target) {
      run.baseSha = await targetHead(run.project.repositoryPath, run.landing.target, signal);
      await git(run.project.repositoryPath, ['worktree', 'add', '--detach', run.workspace, run.baseSha], { signal });
    }
    for (const lane of run.linked ?? []) {
      lane.baseSha = await targetHead(lane.project.repositoryPath, lane.baseBranch, signal);
      await git(lane.project.repositoryPath, ['worktree', 'add', '--detach', lane.workspace, lane.baseSha], { signal });
    }
    this.engine.store.save(); return true;
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
    let next = null;
    try {
      next = await this.live.followup(item.runId, { input: conflictPrompt(target, head, conflicts, lane && this.memberOf(task, lane)) }, { mergeIn: head, mergeInto: lane?.projectId });
      this.engine.startNow(next.id);
    } catch (error) {
      if (next && !terminal.has(next.status)) this.engine.cancel(next.id, 'Landing could not start the conflict resolution.');
      this.engine.transition(run, 'blocked', `${item.ticketId} conflicts with ${target} and could not go back to its agent: ${error.message} Nothing landed.`); return null;
    }
    item.resolutionRunId = next.id; this.engine.store.save();
    await this.settle(next, signal);
    if (signal.aborted) return null;
    if (next.status === 'ready' && next.headSha && (!lane || this.memberOf(next, lane))) return next;
    this.engine.transition(run, 'blocked', `${item.ticketId}: the conflict resolution ended as ${labels[next.status] ?? next.status}. Open it to continue, then land again. Nothing landed.`);
    return null;
  }

  async settle(next, signal) {
    const abort = () => { if (!terminal.has(next.status)) this.engine.cancel(next.id, 'Landing cancelled. The merge is left uncommitted in the worktree.'); };
    signal.addEventListener('abort', abort, { once: true });
    try { await this.engine.active.get(next.id)?.promise; } finally { signal.removeEventListener('abort', abort); }
  }

  async check(run, signal) {
    run.attempt = 1;
    return await this.checkOwn(run, signal) && await this.checkLinked(run, signal);
  }

  async checkOwn(run, signal) {
    if (!run.landing.target) return true;
    if (!await this.live.setup(run, signal)) return false;
    const head = await git(run.workspace, ['rev-parse', 'HEAD^{tree}'], { signal });
    run.revision = await this.live.tree(run, signal);
    if (run.revision !== head) { this.engine.transition(run, 'failed', 'Repository setup changed tracked files in the landing worktree, so the combined result could not be checked. Nothing landed.'); return false; }
    run.changedPaths = (await git(run.workspace, ['diff', '--name-only', '-z', run.baseSha, run.revision], { signal })).split('\0').filter(Boolean);
    if (!run.changedPaths.length) return true;
    run.protectedDigest = this.live.protectedRecipe(run);
    const files = this.live.steps.append(run, { kind: 'files', paths: run.changedPaths, revision: run.revision });
    await this.live.savePatch(run, files.id, signal);
    return this.verdict(run, await this.live.validate(run, signal), signal);
  }

  async checkLinked(run, signal) {
    if (!run.linked?.length) return true;
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
    if (!failure) return true;
    this.engine.transition(run, 'failed', `Check ${failure.name} failed on the combined result, so ${run.linked?.length ? 'no branch moved' : `${run.landing.target} did not move`}. Land fewer tasks or follow up on the one that broke it.`);
    return false;
  }

  async advance(run, signal) {
    const all = lanes(run);
    for (const lane of all) lane.head = await git(lane.workspace, ['rev-parse', 'HEAD'], { signal });
    const moving = all.filter(lane => lane.head !== lane.baseSha);
    this.engine.transition(run, 'landing', moving.length ? `Moving ${moving.map(lane => `${lane.label} from ${short(lane.baseSha)} to ${short(lane.head)}`).join('; ')}.` : `${run.landing.target} already holds these changes.`);
    for (const lane of moving) {
      const path = await checkoutOf(lane.root, lane.target, signal);
      if (path && await dirtyCheckout(lane.root, lane.target, signal)) { this.engine.transition(run, 'failed', `${lane.label} could not move to ${short(lane.head)}: ${lane.target} has uncommitted changes at ${path}. The combined commit stays in the landing worktree. Nothing landed.`); return; }
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
