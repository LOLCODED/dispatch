// Shared with the UI. These are ordinal estimates, not calibrated probabilities.
export const riskLevels = ['low', 'medium', 'high'];
export function riskLevel(likelihood, impact) {
  const score = (riskLevels.indexOf(likelihood) + 1) * (riskLevels.indexOf(impact) + 1);
  if (!riskLevels.includes(likelihood) || !riskLevels.includes(impact)) throw new Error('Likelihood and impact must be low, medium or high.');
  return score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low';
}

export function riskSettings(value, validation) {
  if (value === undefined) return { mode: 'off', minimumChecks: { low: [], medium: [], high: [] }, guidance: '' };
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['off', 'agent', 'ask'].includes(value.mode)) throw new Error('Risk mode must be off, agent or ask.');
  const ids = new Set(validation.map(step => step.id));
  const minimumChecks = Object.fromEntries(riskLevels.map(level => {
    const checks = value.minimumChecks?.[level] ?? [];
    if (!Array.isArray(checks) || checks.some(id => typeof id !== 'string' || !ids.has(id))) throw new Error('Risk rules must name configured checks. Remove their risk rules before removing a check.');
    return [level, [...new Set(checks)]];
  }));
  const guidance = value.guidance ?? '';
  if (typeof guidance !== 'string' || guidance.length > 2000) throw new Error('Risk guidance must be text under 2,000 characters.');
  const landing = value.landingChecks ?? null;
  if (landing !== null && (!Array.isArray(landing) || landing.some(id => typeof id !== 'string' || !ids.has(id)))) throw new Error('Landing checks must name configured checks. Remove them from landing before removing a check.');
  return { mode: value.mode, minimumChecks, guidance: guidance.trim(), ...(landing ? { landingChecks: [...new Set(landing)] } : {}) };
}

export const landingChecks = (policy, ids) => policy?.landingChecks?.filter(id => ids.includes(id)) ?? ids;

export function minimumChecks(policy, level) {
  return [...new Set(riskLevels.slice(0, riskLevels.indexOf(level) + 1).flatMap(item => policy.minimumChecks?.[item] ?? []))];
}

export const riskEnabled = project => ['agent', 'ask'].includes(project?.risk?.mode) && project.validation?.length !== 0;

export const optionalChecks = (policy, ids) => ids.filter(id => !policy?.minimumChecks?.low?.includes(id));

export const riskPrompt = `The operator enabled risk-based check selection for this repository. Use this configured policy to choose checks, including its non-skippable minimums. Before finishing a change, call dispatch_risk inspect on the final worktree. Review the actual diff and shared dependencies, then submit a likelihood/impact estimate, confidence, affected workflows, reasons for both chosen and omitted checks, and configured check IDs. Estimates are not measured failure probabilities. Prefer targeted commands already approved in the repository. Do not assume unchanged workflows are unaffected by shared code. Request human review when unsure or when required coverage is missing. Browser observations supplement automated checks; never claim they passed a test command. After any further edit, inspect and submit again. A missing or stale assessment runs every configured check: every turn needs its own, including a follow-up that changes nothing, so submit again rather than relying on an earlier turn's plan.`;
