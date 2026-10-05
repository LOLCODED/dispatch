import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from './engine.mjs';
import { digest, git } from './local-tools.mjs';
import { checkScope, recipeChange, recipeDiffers, savedRecipe } from './check-scope.mjs';
import { changeFlags } from './flags.mjs';
import { coAuthored, commitIdentity } from './commit-identity.mjs';
import { commitMessage } from './conventional-commit.mjs';
import { ensureShadow, isPlain, shadowDir, workspaceGit } from './plain-folder.mjs';

export const maxLinked = 4;

export function workspaceScripts(workspace) {
  const file = join(workspace, 'package.json');
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')).scripts ?? {}; } catch { return {}; }
}

export function linkedSettings(value, projects, selfId) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxLinked || value.some(id => typeof id !== 'string')) throw new InputError(`Link at most ${maxLinked} other saved repositories.`);
  const ids = [...new Set(value)];
  if (ids.some(id => id === selfId || !projects.some(project => project.id === id))) throw new InputError('Linked repositories must be other saved repositories.');
  return ids;
}

const urlVariable = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const reservedVariables = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'PORT', 'HOST', 'BROWSER', 'CI', 'NODE_OPTIONS']);

export function linkedEnvSettings(value, linked) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new InputError('Linked URL variables must map repository ids to variable names.');
  const entries = Object.entries(value).filter(([id, name]) => linked.includes(id) && name !== '');
  if (entries.some(([, name]) => typeof name !== 'string' || !urlVariable.test(name) || reservedVariables.has(name.toUpperCase()))) throw new InputError('A linked URL variable must be a name like VITE_API_URL, and not one dispatch sets itself (PORT, HOST, PATH…).');
  return Object.fromEntries(entries);
}

export const appName = name => name.toLowerCase().replace(/[^\w.-]+/g, '-');

export function memberWorkspace(root, runId, project, taken = new Set()) {
  const name = appName(project.name), suffix = name && !taken.has(name) ? name : project.id.slice(0, 8);
  taken.add(suffix);
  return join(root, `${runId}-${suffix}`);
}

export const changedMembers = run => (run.linked ?? []).filter(member => member.changedPaths?.length);
export const committed = repository => Boolean(repository.headSha) && repository.headSha !== repository.baseSha;
export const committedMember = committed;
export const memberRecipe = member => digest({ setup: member.project.setup, checks: member.project.validation, scripts: workspaceScripts(member.workspace) });

export async function commitTested({ workspace, revision, identity, message, tree, signal }) {
  await git(workspace, ['add', '-A', '--', '.'], { signal });
  if (await git(workspace, ['write-tree'], { signal }) !== revision) throw new Error('Index differs from tested revision.');
  if (await git(workspace, ['rev-parse', 'HEAD^{tree}'], { signal }) !== revision) await git(workspace, [...await identity(), 'commit', '-m', message], { signal });
  const head = await git(workspace, ['rev-parse', 'HEAD'], { signal });
  if (await git(workspace, ['rev-parse', 'HEAD^{tree}'], { signal }) !== revision || await tree() !== revision) throw new Error('Final commit differs from tested revision.');
  return head;
}

// A task's linked repositories ride along with its primary repository: one agent edits all of them, and each keeps its own worktree, checks, commit and pull request.
export class LinkedRepositories {
  constructor(live) { this.live = live; this.engine = live.engine; }

  snapshot(project, runId, ids = project.linked ?? [], { setup = 'before' } = {}) {
    const taken = new Set();
    return ids.map(id => this.live.projects.find(item => item.id === id)).filter(Boolean).map(item => ({
      projectId: item.id, name: item.name, project: structuredClone(item), baseBranch: isPlain(item) ? null : item.baseBranch, branch: null, baseSha: null,
      workspace: isPlain(item) ? item.repositoryPath : memberWorkspace(this.live.workspaceRoot, runId, item, taken), shadow: isPlain(item) ? shadowDir(this.live.shadowRoot, item.id) : null, urlEnv: project.linkedEnv?.[item.id] ?? null, setup,
    }));
  }

  appTarget(run, url) {
    const [, name, rest] = url.match(/^app:([\w.-]*)(.*)$/i) ?? [];
    if (!name) return { member: null, path: url.replace(/^app:\/?/i, '/') };
    const member = run.linked?.find(item => appName(item.name) === name.toLowerCase());
    if (!member) throw new Error(`No linked repository is called "${name}". Use app:/ for this worktree's app${run.linked?.length ? ` or one of ${run.linked.map(item => `app:${appName(item.name)}/`).join(', ')}` : ''}.`);
    return { member, path: rest || '/' };
  }

  // A linked app the primary app reads by URL must be up first; without it the page would look broken, so the primary app is not started.
  async appEnv(run, signal) {
    const env = {};
    for (const member of (run.linked ?? []).filter(item => item.urlEnv)) {
      let server; try { server = await this.live.devServerFor(run, signal, member); }
      catch (error) { throw new Error(`${error.message}\nThis app reads ${member.urlEnv} for ${member.name}, so it was not started without it. Fix the cause if it is within the task; otherwise tell the operator why the browser cannot show the app.`); }
      env[member.urlEnv] = server.url.replace(/\/$/, '');
    }
    return env;
  }

  continued(previous) {
    return structuredClone(previous.linked ?? []).map(member => ({ ...member, delivery: null }));
  }

  // Repositories the operator approved adding during a turn join the task when it continues.
  joining(previous) {
    const present = new Set([previous.projectId, ...(previous.linked ?? []).map(member => member.projectId)]);
    return [...new Set(previous.linkRequests ?? [])].filter(id => !present.has(id)).map(id => this.live.projects.find(item => item.id === id)).filter(Boolean);
  }

  async create(run, signal) {
    for (const member of (run.linked ?? []).filter(item => !item.baseSha)) await (member.shadow ? this.snapshotMember(run, member, signal) : this.createMember(run, member, signal));
    this.engine.store.save();
  }

  async createMember(run, member, signal) {
    const root = member.project.repositoryPath, base = await this.live.resolveBase(run, signal, member);
    member.branch = await this.live.uniqueBranch(root, run.branch ?? this.live.branchFor(member.project, run.ticket, run.id), signal);
    await git(root, ['worktree', 'add', '-b', member.branch, member.workspace, base.sha], { signal });
    Object.assign(member, { baseSha: base.sha, baseSource: base.source, protectedDigest: memberRecipe(member) });
    this.live.log(run, 'worktree', `Linked repository ${member.name}: worktree on ${member.branch} from ${base.sha.slice(0, 12)}.`);
  }

  async snapshotMember(run, member, signal) {
    await ensureShadow(member.shadow, member.workspace);
    Object.assign(member, { baseSha: await this.live.tree(run, signal, member.workspace), baseSource: 'folder', protectedDigest: memberRecipe(member) });
    this.live.log(run, 'worktree', `Linked folder ${member.name}: working in place in ${member.workspace}; snapshot ${member.baseSha.slice(0, 12)}.`);
  }

  // Deferred setup (agent-decides runs) installs only the repositories the turn changed, right before their checks.
  pendingSetup(run, deferred) {
    return (run.linked ?? []).filter(member => !member.setupComplete && (deferred ? member.setup === 'deferred' && member.changedPaths?.length : member.setup !== 'deferred'));
  }

  async setup(run, signal, { deferred = false } = {}) {
    for (const member of this.pendingSetup(run, deferred)) {
      for (const step of member.project.setup) {
        this.live.log(run, 'setup', `${member.name}: running ${step.command} ${step.args.join(' ')}`);
        const result = await this.live.execute(run, step, signal, false, null, member.workspace);
        this.live.log(run, 'setup', result.output);
        if (signal.aborted) return false;
        if (result.exitCode !== 0 || result.timedOut) { this.engine.transition(run, 'blocked', `Setup failed in linked repository ${member.name}. Inspect the setup output and its saved commands.`); return false; }
      }
      member.setupComplete = true;
      if (deferred && !await this.observeMember(run, member, signal)) return false;
    }
    this.engine.store.save(); return true;
  }

  async observeMember(run, member, signal) {
    if (memberRecipe(member) !== member.protectedDigest) {
      if (!member.project.allowSensitiveFiles) { member.scriptsChanged = true; this.engine.transition(run, 'blocked', `Validation scripts changed in linked repository ${member.name}. Review its package.json, then continue the run to accept the new scripts.`); return false; }
      this.acceptScripts(run, member, 'it allows writing sensitive files');
    }
    const git = workspaceGit(run, member.workspace);
    if (!member.shadow && await git(['branch', '--show-current'], { signal }) !== member.branch) throw new Error(`Worker changed the branch of linked repository ${member.name}.`);
    if (!member.shadow) await git(['merge-base', '--is-ancestor', member.baseSha, 'HEAD'], { signal });
    member.revision = await this.live.tree(run, signal, member.workspace);
    member.changedPaths = (await git(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', member.baseSha, member.revision, '--'], { signal })).split('\0').filter(Boolean);
    return true;
  }

  acceptScripts(run, member, reason) {
    member.protectedDigest = memberRecipe(member); delete member.scriptsChanged;
    this.live.log(run, 'check', `Package scripts changed in linked repository ${member.name} and ${reason}, so they are now its protected baseline for this run and its follow-ups.`);
  }

  acceptContinued(run) {
    for (const member of (run.linked ?? []).filter(item => item.scriptsChanged)) this.acceptScripts(run, member, 'you continued the run');
  }

  // Unaccepted script drift keeps the old recipe so the next observation still blocks on it.
  refreshRecipes(run) {
    for (const member of run.linked ?? []) {
      const saved = this.live.projects.find(item => item.id === member.projectId);
      if (!saved || !recipeDiffers(member.project, saved) || memberRecipe(member) !== member.protectedDigest) continue;
      const before = savedRecipe(member.project), after = structuredClone(savedRecipe(saved));
      Object.assign(member.project, after);
      member.protectedDigest = memberRecipe(member);
      if (digest(before.setup) !== digest(after.setup)) member.setupComplete = false;
      this.live.log(run, 'check', recipeChange(member.name, before, after));
    }
  }

  async observe(run, signal) {
    for (const member of run.linked ?? []) {
      if (!await this.observeMember(run, member, signal)) return false;
      if (member.changedPaths.length) this.live.log(run, 'files', `${member.name}: ${member.changedPaths.length} file${member.changedPaths.length === 1 ? '' : 's'} changed.`);
    }
    return true;
  }

  target(run, member) {
    return { workspace: member.workspace, revision: member.revision, recipeDigest: member.protectedDigest, linked: member.projectId, label: member.name,
      current: async signal => await this.live.tree(run, signal, member.workspace) === member.revision && memberRecipe(member) === member.protectedDigest };
  }

  async current(run, signal) {
    for (const member of changedMembers(run)) if (!await this.target(run, member).current(signal)) return false;
    return true;
  }

  async validate(run, signal, { all = false } = {}) {
    if (!await this.setup(run, signal, { deferred: true })) return null;
    let failure = null;
    for (const member of changedMembers(run)) {
      const scope = checkScope(member.project, member.changedPaths);
      this.engine.transition(run, 'validating', `Running ${member.name} checks (${scope.steps.map(step => step.id).join(', ') || 'none required'}) against tree ${member.revision.slice(0, 12)}, per its repository rules.`);
      for (const step of scope.steps) {
        const record = await this.live.runCheck(run, step, signal, this.target(run, member));
        if (!record) return null;
        if (record.status !== 'passed') { failure ??= record; if (!all) return failure; }
      }
    }
    return failure;
  }

  async publish(run, signal) {
    for (const member of changedMembers(run).filter(member => !member.shadow)) {
      if (await git(member.workspace, ['branch', '--show-current'], { signal }) !== member.branch) throw new Error(`Linked repository ${member.name} changed branch during checks.`);
      member.headSha = await commitTested({ workspace: member.workspace, revision: member.revision, message: coAuthored(commitMessage(run), member.project), signal,
        identity: () => commitIdentity(member.workspace, { signal }), tree: () => this.live.tree(run, signal, member.workspace) });
    }
    this.engine.store.save();
  }

  view(run, member) {
    return { ...run, projectId: member.projectId, project: member.project, workspace: member.workspace, branch: member.branch, baseBranch: member.baseBranch, baseSha: member.baseSha, headSha: member.headSha, revision: member.revision,
      changedPaths: member.changedPaths ?? [], flags: changeFlags(member.changedPaths ?? [], member.project.protectedPaths), sqlToRun: null, handoff: { head: member.branch }, delivery: member.delivery ?? null };
  }

  views(run) { return (run.linked ?? []).filter(committedMember).map(member => this.view(run, member)); }

  async deliver(run, { signal, bases, automatic = false } = {}) {
    const members = (run.linked ?? []).filter(member => committedMember(member) && (!automatic || this.live.autoDelivery(member)));
    for (const member of members) {
      const view = this.view(run, member);
      const summary = await this.live.delivery.deliver(view, member.project, { signal, base: bases?.[member.projectId] });
      member.delivery = view.delivery;
      this.live.log(run, 'delivery', `${member.name}: ${summary}`);
    }
    this.engine.store.save();
  }

  async branchKept(member) {
    const root = member.project.repositoryPath;
    let head; try { head = await git(root, ['rev-parse', '--verify', `refs/heads/${member.branch}^{commit}`]); } catch { return false; }
    if (member.delivery?.pushedAt && member.delivery.headSha === head) return false;
    try { await git(root, ['merge-base', '--is-ancestor', head, member.baseBranch]); return false; } catch { return true; }
  }

  async remove(run, { landed = false } = {}) {
    const kept = [];
    for (const member of (run.linked ?? []).filter(item => item.branch)) {
      const root = member.project.repositoryPath;
      if (existsSync(member.workspace)) await git(root, ['worktree', 'remove', '--force', member.workspace]);
      if (!landed && await this.branchKept(member)) kept.push(`${member.name} ${member.branch}`);
      else await git(root, ['branch', '-D', member.branch]).catch(() => {});
    }
    return kept;
  }

  async diff(run) {
    const parts = [];
    for (const member of (run.linked ?? []).filter(item => item.baseSha && existsSync(item.workspace))) {
      const tree = await this.live.tree(run, undefined, member.workspace);
      parts.push(await workspaceGit(run, member.workspace)(['diff', '--no-ext-diff', '--no-textconv', `--src-prefix=a/${member.name}/`, `--dst-prefix=b/${member.name}/`, '--patch', member.baseSha, tree, '--'], { maxOutput: 200000 }));
    }
    return parts.filter(Boolean).join('\n');
  }
}
