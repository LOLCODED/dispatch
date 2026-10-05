import { InputError } from './engine.mjs';
import { safeBranch } from './branch.mjs';
import { terminal } from './catalog.mjs';
import { pullRequestState } from './board-state.mjs';
import { fetchBase, pullRequestConflictPrompt, reviewRepairPrompt } from './delivery.mjs';
import { committedMember, deliverable } from './linked-repositories.mjs';

const maxRuns = 20, loopback = new Set(['127.0.0.1', 'localhost', '[::1]']), watchIntervalMs = 5 * 60_000;
const stateNotes = {
  merged: pr => `Pull request #${pr.number ?? '?'} was merged.`,
  closed: pr => `Pull request #${pr.number ?? '?'} was closed without merging.`,
  conflicts: pr => `Pull request #${pr.number ?? '?'} conflicts with ${pr.baseRefName ?? 'its base branch'}.`,
  changes: pr => `Changes were requested on pull request #${pr.number ?? '?'}.`,
  ci: pr => `CI failed on pull request #${pr.number ?? '?'}.`,
};

export const publishable = (run, autoDelivers = false) => run.mode === 'live' && run.kind !== 'answer' && run.kind !== 'landing' && run.status === 'ready' && (deliverable(run) || (run.linked ?? []).some(committedMember)) && !run.answered && !run.supersededBy && !run.worktreeRemovedAt && !run.delivery?.pr && !run.linked?.some(member => member.delivery?.pr) && !autoDelivers;

function appPage(url) {
  try { const parsed = new URL(url); return loopback.has(parsed.hostname) ? `${parsed.pathname}${parsed.search}` : null; } catch { return null; }
}

// Only pages on the run's own dev server say where to test; external sites the agent read are research.
export async function reviewPages(steps, runId) {
  const pages = new Set();
  for (let after = 0; after !== null;) {
    const page = await steps.read(runId, { after, limit: 500 });
    for (const step of page.steps) { const path = step.kind === 'browser.step' && !step.error && step.url ? appPage(step.url) : null; if (path) pages.add(path); }
    after = page.next;
  }
  return [...pages];
}

// Each task keeps its own pull request; tasks opened together link to each other, including across repositories.
export class PullRequests {
  constructor(live) { this.live = live; this.engine = live.engine; }

  runs(runIds) {
    if (!Array.isArray(runIds) || !runIds.length || runIds.length > maxRuns || new Set(runIds).size !== runIds.length) throw new InputError(`Choose 1 to ${maxRuns} ready tasks.`);
    const runs = runIds.map(id => this.engine.get(id));
    for (const run of runs) if (!publishable(run, this.live.autoDelivery(run))) throw new InputError(`"${run.title}" has no tested commit ready for a pull request.`, 409);
    return runs;
  }

  base(run, bases) {
    if (!deliverable(run)) return null;
    const base = bases?.[run.projectId] ?? run.baseBranch;
    if (!safeBranch(base)) throw new InputError(`Choose a valid base branch for ${run.project?.name ?? 'this repository'}.`);
    return base;
  }

  async open({ runIds, bases } = {}) {
    const runs = this.runs(runIds), targets = new Map(runs.map(run => [run.id, this.base(run, bases)]));
    for (const run of runs) await this.live.openPullRequest(run.id, { base: targets.get(run.id), bases });
    if (runs.length > 1) await this.link(runs);
    return runs;
  }

  watched() {
    return this.engine.runs.filter(run => run.mode === 'live' && !run.supersededBy && !run.worktreeRemovedAt && run.delivery?.pushedAt && run.delivery.pr?.state === 'OPEN' && terminal.has(run.status) && !this.engine.active.has(run.id));
  }

  // Open pull requests are re-read while the board is in use, so merges and requested changes reach the task without opening it.
  watch(now = Date.now()) {
    if (this.watching || now - (this.watchedAt ?? 0) < watchIntervalMs) return;
    this.watchedAt = now;
    const runs = this.watched();
    this.watching = (async () => { for (const run of runs) if (!this.engine.stopping) await this.live.refreshDelivery(run.id).catch(() => {}); })().finally(() => { this.watching = null; });
  }

  note(run, before) {
    const after = pullRequestState(run);
    if (after !== before && stateNotes[after]) this.live.log(run, 'delivery', stateNotes[after](run.delivery.pr));
  }

  async repair(id, reason = 'ci') {
    if (reason === 'ci') return this.live.repairFromCi(id);
    const run = this.engine.get(id), project = this.live.deliverable(run), pr = run.delivery?.pr;
    if (!['review', 'conflicts'].includes(reason)) throw new InputError('Choose ci, review or conflicts.');
    if (pullRequestState(run) !== (reason === 'review' ? 'changes' : 'conflicts')) throw new InputError(`Refresh the delivery first; the pull request has no ${reason === 'review' ? 'requested changes since the last push' : 'merge conflicts'}.`, 409);
    if (reason === 'review') {
      let feedback; try { feedback = await this.live.delivery.reviewFeedback(run, project); } catch (error) { throw new InputError(error.message, 409); }
      const next = await this.live.followup(id, { input: reviewRepairPrompt(pr, feedback) });
      this.live.log(next, 'delivery', `Addressing ${feedback.length} review comment${feedback.length === 1 ? '' : 's'} from pull request #${pr.number ?? '?'} in the same session.`);
      return next;
    }
    const base = pr.baseRefName ?? run.baseBranch;
    if (!safeBranch(base)) throw new InputError('The pull request targets a branch dispatch cannot fetch.', 409);
    const sha = await fetchBase(run, run.delivery.remote ?? 'origin', base);
    const next = await this.live.followup(id, { input: pullRequestConflictPrompt(base, sha) }, { mergeIn: sha });
    this.live.log(next, 'delivery', `Resolving conflicts between ${run.branch} and ${base} at ${sha.slice(0, 12)} in the same session.`);
    return next;
  }

  async link(runs) {
    const opened = runs.flatMap(run => [run, ...this.live.linked.views(run)]).filter(run => run.delivery?.pr?.url);
    if (opened.length < 2) return;
    for (const run of opened.filter(item => !item.delivery.pr.reused)) {
      const related = opened.filter(other => other !== run).map(other => ({ url: other.delivery.pr.url, title: other.title }));
      try { await this.live.delivery.describe(run, run.project, { pages: await reviewPages(this.live.steps, run.id), related }); this.live.log(run, 'delivery', `Linked ${related.length} related pull request${related.length === 1 ? '' : 's'}.`); }
      catch (error) { this.live.log(run, 'delivery', `Related pull requests were not linked: ${error.message}`); }
    }
    this.engine.store.save();
  }
}
