import { randomUUID } from 'node:crypto';
import { digest } from './local-tools.mjs';
import { workspaceGit } from './plain-folder.mjs';
import { checkScope } from './check-scope.mjs';
import { changeFlags } from './flags.mjs';
import { riskEnabled, riskLevel, minimumChecks, landingChecks } from './risk-policy.mjs';
import { usesBrowser } from './linked-repositories.mjs';

const approvedByOperator = new Set(['operator', 'all-checks']), approved = new Set(['agent', ...approvedByOperator]);
const text = (value, name, limit = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${name} needs 1–${limit} characters.`);
  return value.trim();
};
const policyDigest = run => digest({ risk: run.project.risk, scopes: run.project.checkScopes });
const previewUrl = run => run.devServer && !run.devServer.stoppedAt ? run.devServer.url : null;

export class RiskChecks {
  constructor(live) { this.live = live; this.busy = new Map(); }
  required(run, level) {
    return [...new Set([...minimumChecks(run.project.risk, level), ...run.checks.filter(check => check.status === 'failed').map(check => check.name)])];
  }
  estimate(run, ids) {
    if (!ids.length) return 'Estimated checks: under 1 minute.';
    let total = 0;
    for (const id of ids) {
      const step = run.project.validation.find(item => item.id === id);
      const samples = (this.live.engine.runs ?? []).filter(item => item.projectId === run.projectId)
        .flatMap(item => item.checks ?? []).filter(check => check.name === id && check.status === 'passed' && !check.reusedFrom
          && Number.isFinite(check.durationMs) && check.durationMs > 0
          && JSON.stringify(check.command) === JSON.stringify([step.command, ...step.args]));
      if (!samples.length) return 'Estimated checks: unavailable until all selected checks have recorded durations.';
      const durations = samples.map(check => check.durationMs).sort((a, b) => a - b);
      total += durations[Math.floor(durations.length / 2)];
    }
    return `Estimated checks: ${total < 60000 ? 'under 1 minute' : `about ${Math.ceil(total / 60000)} minutes`} (historical durations; excludes review and repairs).`;
  }
  async snapshot(run, signal) {
    const revision = await this.live.tree(run, signal);
    const paths = (await workspaceGit(run)(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', run.baseSha, revision, '--'], { signal })).split('\0').filter(Boolean);
    return { revision, paths, recipeDigest: this.live.protectedRecipe(run), policyDigest: policyDigest(run) };
  }
  async call(run, args, { signal }) {
    if (!riskEnabled(run.project) || !['implementing', 'repairing'].includes(run.status)) throw new Error('Risk assessment is unavailable for this turn.');
    if (this.busy.has(run.id)) throw new Error('Finish the pending risk assessment first.');
    const assessment = this.assess(run, args, signal);
    this.busy.set(run.id, assessment);
    try { return await assessment; } finally { this.busy.delete(run.id); }
  }
  async assess(run, args, signal) {
    const snapshot = await this.snapshot(run, signal);
    if (args.action === 'inspect') {
      const scope = checkScope(run.project, snapshot.paths);
      return { ...snapshot, paths: snapshot.paths.slice(0, 200), totalPaths: snapshot.paths.length,
        summary: await workspaceGit(run)(['diff', '--no-ext-diff', '--no-textconv', '--stat', run.baseSha, snapshot.revision, '--'], { signal, maxOutput: 4000 }),
        signals: Object.fromEntries(Object.entries(changeFlags(snapshot.paths, run.project.protectedPaths)).map(([key, paths]) => [key, paths.slice(0, 20)])), policy: run.project.risk,
        scopeSuggestion: scope.steps.map(step => step.id), availableChecks: run.project.validation,
        browserAvailable: usesBrowser(run),
        previewUrl: previewUrl(run),
        matrix: 'Low=1, medium=2, high=3. Likelihood × impact: 1–2 low risk, 3–4 medium risk, 6–9 high risk.',
        instructions: 'Read the diff in this worktree; path hints are not a probability estimate. Submit this revision after choosing checks. Missing coverage or uncertainty requires asking the operator. Only configured commands can be selected; ask the operator to configure missing commands. Manual review is a separate observation.' };
    }
    if (args.action !== 'submit') throw new Error('Use inspect or submit.');
    if (!snapshot.paths.length || args.revision !== snapshot.revision) throw new Error('The worktree changed or is empty. Inspect and assess the current revision.');
    if ((run.riskAssessments?.length ?? 0) >= 20) throw new Error('Risk assessment limit reached for this run.');
    const level = riskLevel(args.likelihood, args.impact);
    if (!['confident', 'uncertain'].includes(args.confidence)) throw new Error('Confidence must be confident or uncertain.');
    const known = new Set(run.project.validation.map(step => step.id));
    if (!Array.isArray(args.checks) || args.checks.some(id => !known.has(id))) throw new Error('Select configured check IDs only.');
    const reason = text(args.reason, 'Assessment reason'), workflows = text(args.workflows, 'Affected workflows');
    const manualReview = args.manualReview ? text(args.manualReview, 'Manual review instructions') : null;
    const observations = args.observations ? text(args.observations, 'Browser or other observations') : null;
    const requiredChecks = this.required(run, level), checks = [...new Set([...args.checks, ...requiredChecks])];
    const priorRejection = run.riskAssessments?.some(item => item.status === 'rejected');
    const record = { id: randomUUID(), ...snapshot, attempt: run.attempt, likelihood: args.likelihood, impact: args.impact, level, confidence: args.confidence,
      reason, workflows, proposedChecks: [...new Set(args.checks)], requiredChecks, checks, manualReview, observations, mode: run.project.risk.mode,
      status: 'proposed', createdAt: new Date().toISOString() };
    (run.riskAssessments ??= []).push(record); this.save(run, record);
    try {
      const asks = record.mode === 'ask' || record.confidence === 'uncertain' || manualReview || priorRejection;
      const earlier = asks && !priorRejection ? this.approvedEarlier(run, record) : null;
      if (earlier) this.reuse(run, record, earlier);
      else if (asks) await this.askOperator(run, record, known, signal);
      else record.status = 'agent';
      const current = await this.snapshot(run, signal);
      if (approved.has(record.status) && (current.revision !== record.revision || current.recipeDigest !== record.recipeDigest || current.policyDigest !== record.policyDigest)) record.status = 'stale';
      if (signal.aborted) record.status = 'cancelled';
    } catch (error) { record.status = signal.aborted ? 'cancelled' : 'rejected'; record.reasonForRejection = error.message; throw error; }
    finally { this.save(run, record); }
    return { status: record.status, level, checks: record.checks, revision: record.revision, message: approved.has(record.status) ? `Plan recorded${record.reusedFrom ? ' without asking: the operator already approved a plan for this exact revision' : ''}. Dispatch will execute the selected checks on this exact revision after your turn.` : 'Plan not accepted. Address the operator’s response and submit again, or finish blocked.', answer: record.answer };
  }
  // Every turn submits its own plan, so an unchanged follow-up would otherwise re-ask the operator about a tree they already approved.
  approvedEarlier(run, record) {
    if (record.mode === 'ask') return null;
    const covers = earlier => approvedByOperator.has(earlier.status) && earlier.revision === record.revision && earlier.recipeDigest === record.recipeDigest
      && earlier.policyDigest === record.policyDigest && record.checks.every(id => earlier.checks.includes(id)) && (!record.manualReview || earlier.manualReviewPassed);
    for (const current of this.live.workspaceHistory(run)) {
      const earlier = current.riskAssessments?.findLast(item => item !== record && covers(item));
      if (earlier) return { earlier, runId: current.id };
    }
    return null;
  }
  reuse(run, record, { earlier, runId }) {
    Object.assign(record, { status: earlier.status, checks: [...earlier.checks], reusedFrom: { assessmentId: earlier.id, runId }, answer: earlier.answer, ...(earlier.manualReviewPassed && { manualReviewPassed: true }) });
    this.live.log(run, 'check', `Testing plan for tree ${record.revision.slice(0, 12)} reused: you approved it ${runId === run.id ? 'earlier in this run' : `in run ${runId.slice(0, 8)}`} and nothing changed since.${record.manualReview ? ` The agent also noted: ${record.manualReview}` : ''}`);
  }
  async askOperator(run, record, known, signal) {
    const { level, workflows, reason, manualReview, checks } = record;
    const accept = manualReview ? 'Review passed; use suggested checks' : 'Use suggested checks';
    const result = await this.live.interactions.request(run, { kind: 'question', source: 'risk', riskAssessmentId: record.id, questions: [{ id: 'risk', header: 'Testing plan',
      question: `**${level[0].toUpperCase() + level.slice(1)} risk** · ${record.likelihood} likelihood / ${record.impact} impact. Estimates are judgments, not measured probabilities.\n\n**Proposed checks:** ${checks.join(', ') || 'none'} (repository minimums included).\n\n${manualReview ? `**Required review:** ${manualReview}${previewUrl(run) ? `\n\n[Open live preview](${previewUrl(run)})` : ''}` : 'Select a verification plan.'}`,
      details: `**Affected workflows:** ${workflows}\n\n${reason}`,
      options: [{ label: `${accept} (Recommended)`, description: `${manualReview ? 'Confirm review and approve selected checks.' : 'Approve selected checks.'} ${this.estimate(run, checks)}` },
        { label: manualReview ? 'Review passed; run all checks' : 'Run all configured checks', description: `${manualReview ? 'Confirm review and run every configured check.' : 'Run every configured check.'} ${this.estimate(run, [...known])}` },
        { label: 'Revise the plan', description: 'Request a revised assessment. Estimated time depends on the requested changes.' }] }] }, signal);
    // The provider-facing answer can include appended attachment paths. The saved answer is the operator's exact choice.
    const answer = run.interactions?.find(item => item.riskAssessmentId === record.id)?.answers?.risk ?? result.answers?.risk?.answers?.[0];
    record.answer = String(answer ?? '').slice(0, 4000);
    if (answer === `${accept} (Recommended)`) { record.status = 'operator'; if (manualReview) record.manualReviewPassed = true; }
    else if (answer === (manualReview ? 'Review passed; run all checks' : 'Run all configured checks')) { record.status = 'all-checks'; record.checks = [...known]; if (manualReview) record.manualReviewPassed = true; }
    else { record.status = 'rejected'; record.reasonForRejection = record.answer; }
  }
  // A CLI can end its turn while a submit still waits on the operator (Codex 0.159 does); checks wait for that decision.
  async decided(run, signal) {
    await this.busy.get(run.id)?.catch(() => {});
    signal.throwIfAborted();
  }
  save(run, record) {
    this.live.steps.append(run, { kind: 'risk', assessmentId: record.id, revision: record.revision, status: record.status, level: record.level, checks: record.checks });
    this.live.engine.store.saveSoon();
  }
  async selection(run, signal) {
    if (!riskEnabled(run.project)) return null;
    if (run.kind === 'landing') return this.landingSelection(run);
    await this.decided(run, signal);
    const record = run.riskAssessments?.at(-1);
    const current = record && record.attempt === run.attempt && record.revision === run.revision && record.recipeDigest === this.live.protectedRecipe(run) && record.policyDigest === policyDigest(run);
    if (record && ['rejected', 'proposed', 'cancelled'].includes(record.status)) return { blocked: true, reason: record.reasonForRejection || 'Testing plan needs approval.' };
    if (!current || !approved.has(record.status)) {
      const reason = record ? 'Risk assessment is stale; the fallback requires every configured check.' : 'No risk assessment; the fallback requires every configured check.';
      const fallback = { id: `fallback-${run.attempt}`, createdAt: new Date().toISOString(), revision: run.revision, attempt: run.attempt, reason, status: 'fallback', checks: run.project.validation.map(step => step.id) };
      run.riskSelection = fallback; (run.riskFallbacks ??= []).push(fallback);
      if (run.project.risk.mode === 'ask' || record?.manualReview) {
        const refusal = await this.approveFallback(run, record, fallback, signal);
        if (refusal) return refusal;
      }
      fallback.selectedAt = new Date().toISOString();
      return { scoped: false, matched: [], steps: run.project.validation, skipped: [], reason };
    }
    const checks = new Set([...record.checks, ...this.required(run, record.level)]);
    const reason = `Risk plan approved by ${record.status === 'agent' ? 'agent' : 'operator'}: ${record.level} risk. ${record.reason}`;
    record.selectedAt = new Date().toISOString();
    run.riskSelection = { assessmentId: record.id, revision: run.revision, attempt: run.attempt, status: record.status, reason, checks: [...checks] };
    return { scoped: true, matched: [], steps: run.project.validation.filter(step => checks.has(step.id)), skipped: run.project.validation.filter(step => !checks.has(step.id)), reason };
  }
  // A landing has no agent session to assess risk, so it runs the repository's landing checks without asking.
  landingSelection(run) {
    const checks = new Set(landingChecks(run.project.risk, run.project.validation.map(step => step.id)));
    const reason = `Landing runs the repository's landing checks: ${[...checks].join(', ') || 'none'}.`;
    return { scoped: true, matched: [], steps: run.project.validation.filter(step => checks.has(step.id)), skipped: run.project.validation.filter(step => !checks.has(step.id)), reason, skipReason: 'Skipped: not one of the repository\'s landing checks.', skippedBy: 'landing checks' };
  }
  async approveFallback(run, record, fallback, signal) {
    const label = record?.manualReview ? 'Review passed; run all checks (Recommended)' : 'Run all configured checks (Recommended)';
    fallback.approval = 'pending';
    try {
      const result = await this.live.interactions.request(run, { kind: 'question', source: 'risk', riskAssessmentId: fallback.id, questions: [{ id: 'risk', header: 'Testing fallback',
        question: `${fallback.reason}\nChecks: ${fallback.checks.join(', ')}.\n${record?.manualReview ? `Repeat this review on the current revision before approving: ${record.manualReview}${previewUrl(run) ? `\nLive preview: ${previewUrl(run)}` : ''}` : 'Approve the full check list for this revision or ask for a revised plan.'}`,
        options: [{ label, description: `Approve all checks. ${this.estimate(run, fallback.checks)}` },
          { label: 'Revise the plan', description: 'Request a revised assessment. Estimated time depends on the requested changes.' }] }] }, signal);
      const answer = run.interactions?.findLast(item => item.riskAssessmentId === fallback.id)?.answers?.risk ?? result.answers?.risk?.answers?.[0];
      fallback.answer = String(answer ?? '').slice(0, 4000);
      if (answer !== label) { fallback.approval = 'rejected'; return { blocked: true, reason: 'The fallback testing plan was not approved. Submit a new assessment.' }; }
      if (await this.live.tree(run, signal) !== run.revision) { fallback.approval = 'stale'; return { blocked: true, reason: 'The worktree changed during approval. Submit a new assessment.' }; }
      fallback.approval = 'operator';
      if (record?.manualReview) { fallback.manualReview = record.manualReview; fallback.manualReviewPassed = true; }
      return null;
    } catch (error) { fallback.approval = signal.aborted ? 'cancelled' : 'rejected'; throw error; }
    finally { this.live.engine.store.saveSoon(); }
  }
  audit() {
    return this.live.engine.runs.flatMap(run => [...(run.riskAssessments ?? []), ...(run.riskFallbacks ?? [])].map(record => ({ ...record, paths: undefined, runId: run.id, title: run.title, projectId: run.projectId,
      used: Boolean(record.selectedAt), runStatus: run.status })));
  }
}
