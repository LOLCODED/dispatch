import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { digest, git } from './local-tools.mjs';

const sameCommand = (step, command) => JSON.stringify([step.command, ...step.args]) === JSON.stringify(command);

// Whether a failing check already failed before the task decides how its repair is framed. Each one runs on the base once per base and recipe.
export class BaseChecks {
  constructor(live) { this.live = live; }

  async preexisting(run, failures, signal) {
    const found = [];
    for (const failure of failures) {
      if (signal.aborted) break;
      if (await this.failsOnBase(run, failure, signal)) found.push(failure);
    }
    return found;
  }

  async failsOnBase(run, failure, signal) {
    const origin = this.origin(run, failure);
    if (!origin) return false;
    const key = digest({ repository: origin.projectId, baseSha: origin.baseSha, command: failure.command, setup: origin.setup });
    run.baseChecks ??= {};
    const result = run.baseChecks[key] ?? await this.runOnBase(run, origin, failure, signal);
    if (result !== 'unknown') run.baseChecks[key] = result;
    Object.assign(failure, { base: result, baseSha: origin.baseSha });
    if (result === 'failed') this.live.log(run, 'check', `${failure.name} also fails on the base commit ${origin.baseSha.slice(0, 12)} without this task's changes.`);
    return result === 'failed';
  }

  origin(run, failure) {
    const member = failure.linked ? run.linked?.find(item => item.projectId === failure.linked) : null;
    const owner = member ?? run, project = member?.project ?? run.project;
    if (owner.shadow || !owner.baseSha) return null;
    const step = project.validation.find(item => sameCommand(item, failure.command));
    if (!step || step.kind === 'browser-smoke') return null;
    return { projectId: member?.projectId ?? run.projectId, repository: project.repositoryPath, baseSha: owner.baseSha, setup: project.setup ?? [], step };
  }

  async runOnBase(run, origin, failure, signal) {
    const workspace = join(this.live.workspaceRoot, `${run.id}-base-${origin.projectId.slice(0, 8)}`);
    this.live.log(run, 'check', `${failure.name} failed; running it once on the base commit ${origin.baseSha.slice(0, 12)} to see whether it failed before this task.`);
    try {
      await git(origin.repository, ['worktree', 'add', '--detach', '--force', workspace, origin.baseSha], { signal });
      for (const step of origin.setup) {
        const setup = await this.live.execute(run, step, signal, false, null, workspace);
        if (setup.exitCode !== 0 || setup.timedOut || setup.cancelled) return 'unknown';
      }
      const result = await this.live.execute(run, origin.step, signal, false, null, workspace);
      if (signal.aborted || result.cancelled) return 'unknown';
      return result.exitCode === 0 && !result.timedOut ? 'passed' : 'failed';
    } catch { return 'unknown'; }
    finally { await this.remove(origin.repository, workspace); }
  }

  async remove(repository, workspace) {
    try { await git(repository, ['worktree', 'remove', '--force', workspace]); }
    catch { rmSync(workspace, { recursive: true, force: true }); await git(repository, ['worktree', 'prune']).catch(() => {}); }
  }
}

