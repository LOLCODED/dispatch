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
export function nextMove(run, { finishAsIsAfter = 2 } = {}) {
  if (run.status === 'ready') return { kind: 'done' };
  if (!['blocked', 'failed', 'interrupted'].includes(run.status)) return { kind: 'done' };
  if (preexisting(run) && run.sessionId) return { kind: 'accept-preexisting' };
  const files = (run.blockedTree?.files ?? 0) + (run.blockedTree?.linkedFiles ?? 0);
  if (run.status === 'blocked' && !run.asIs && files && run.blockedTree.repeats >= finishAsIsAfter) return { kind: 'finish-as-is' };
  return { kind: 'followup', input: run.question ? blockedReply(run.question) : freeTextReply };
}
