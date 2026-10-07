export const freeTextReply = 'Use your best judgment and proceed; finish what you can and list anything only I can do.';

// A replay runs against throwaway copies with nothing reachable, so anything that widens what the run may touch is declined.
const wideningHeaders = new Set(['Change a setting', 'Add a repository']);
const declining = /\b(leave|keep|without|decline|skip|no)\b/i;
const optionLine = /^\s*(?:[-*]\s+)?(\d{1,2})[.)]\s+(.+?)\s*$/;

export function chooseOption(options) {
  const labels = (options ?? []).map(option => typeof option === 'string' ? option : option?.label).filter(Boolean);
  return labels.find(label => /\(recommended\)/i.test(label)) ?? labels[0] ?? null;
}

function declineOption(options) {
  return (options ?? []).find(option => declining.test(`${option.label} ${option.description ?? ''}`) && !/\bchange it\b/i.test(option.label))?.label ?? null;
}

export function interactionAnswers(request) {
  const answers = {}, notes = [];
  for (const question of request.questions ?? []) {
    const widening = wideningHeaders.has(question.header);
    const answer = widening ? declineOption(question.options) ?? 'No. This is a sandbox; keep working without it.' : chooseOption(question.options) ?? freeTextReply;
    answers[question.id] = answer;
    notes.push({ source: request.source ?? 'native', header: question.header ?? null, question: question.question ?? '', answer, declined: widening });
  }
  return { answers, notes };
}

export function numberedOptions(text) {
  return String(text ?? '').split('\n').map(line => optionLine.exec(line)?.[2]).filter(Boolean);
}

export function blockedReply(question) {
  const choice = chooseOption(numberedOptions(question));
  return choice ? `${choice.replace(/\s*\(recommended\)\s*/i, ' ').trim()}. ${freeTextReply}` : freeTextReply;
}

const preexisting = run => {
  const latest = [...new Map((run.checks ?? []).map(check => [check.name, check])).values()];
  return latest.some(check => check.status === 'failed' && check.base === 'failed' && !check.accepted && check.revision === run.revision);
};

// What the simulated operator does once a run has stopped: the same buttons and replies a person has in the run view.
// A provider or network outage is not something a reply fixes; the replay stops so it can be run again.
const outage = /\b(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)\b|can't reach the api server|did not answer [\w.]+ within/i;

export function nextMove(run, { finishAsIsAfter = 2 } = {}) {
  if (run.status === 'ready') return { kind: 'done' };
  if (run.status === 'failed' && outage.test(run.summary ?? run.events?.at(-1)?.message ?? '')) return { kind: 'outage' };
  if (!['blocked', 'failed', 'interrupted'].includes(run.status)) return { kind: 'done' };
  if (preexisting(run) && run.sessionId) return { kind: 'accept-preexisting' };
  const files = (run.blockedTree?.files ?? 0) + (run.blockedTree?.linkedFiles ?? 0);
  if (run.status === 'blocked' && !run.asIs && files && run.blockedTree.repeats >= finishAsIsAfter) return { kind: 'finish-as-is' };
  return { kind: 'followup', input: run.question ? blockedReply(run.question) : freeTextReply };
}

// A replay is only evidence when the agent built the change itself; finding it already shipped, or reading another checkout, spoils it.
const claimsShipped = /\balready (?:merged|on `?(?:main|master|staging)`?|in `?(?:main|master|staging)`?)\b|\bnothing (?:left )?to build\b|\b(?:fix|work|change|ticket)\b[^.]{0,60}\balready (?:exists|done|implemented|in place)\b/i;

export function contamination(runs, outsideRoots) {
  const events = runs.flatMap(run => run.events);
  return {
    claimsShipped: events.filter(event => /^(?:message|ready|blocked|failed):/.test(event) && claimsShipped.test(event)).map(event => event.slice(0, 300)),
    outsideReads: events.filter(event => event.startsWith('tool:') && outsideRoots.some(root => event.includes(root))).map(event => event.slice(0, 300)),
  };
}
