import { blockedQuestionOf, answerOptions, remainingOptions, remainingQuestion } from './question.mjs';
import { openRemaining } from '../../src/remaining.mjs';
import { pullRequestState } from '../../src/board-state.mjs';
export * from '../../src/board-state.mjs';

const retryInput = 'Try again from where you stopped.';

function requestAsk(request) {
  if (request.questions?.length !== 1) return { kind: 'open', text: 'The agent has several questions.' };
  const [question] = request.questions;
  return { kind: 'request', requestId: request.id, questionId: question.id, text: question.question, options: answerOptions(question.options).map(option => ({ label: option.text, value: option.label, recommended: option.recommended })) };
}

function blockedAsk(text, plan) {
  const parsed = blockedQuestionOf(text, plan);
  return { kind: 'followup', text: parsed.question.split('\n').find(line => line.trim()) ?? parsed.question, options: answerOptions(parsed.options).map(option => ({ label: option.text, value: option.text, recommended: option.recommended })) };
}

const pullRequestAsks = {
  closed: pr => [`Pull request #${pr.number} was closed without merging.`],
  conflicts: pr => [`Pull request #${pr.number} conflicts with ${pr.baseRefName ?? 'its base branch'}.`, 'Resolve conflicts', 'conflicts'],
  changes: pr => [`Changes were requested on pull request #${pr.number}.`, 'Address review', 'review'],
  ci: (pr, ci) => [`CI failed on pull request #${pr.number}${ci.failing?.length ? `: ${ci.failing.join(', ')}` : ''}.`, 'Fix CI', 'ci'],
};

function pullRequestAsk({ pr, ci }, state) {
  const [text, label, reason] = pullRequestAsks[state](pr, ci);
  return { kind: 'delivery', text, url: pr.url, options: label ? [{ label, value: reason, reason, recommended: true }] : [], markDone: true };
}

// What the Needs decision row asks, and which answers send without opening the task.
export function askOf(latest) {
  if (latest.pendingRequest) return requestAsk(latest.pendingRequest);
  if (latest.status === 'blocked' && latest.question) return blockedAsk(latest.question, latest.plan);
  if (openRemaining(latest)) return { kind: 'followup', text: remainingQuestion, options: answerOptions(remainingOptions).map(option => ({ label: option.text, value: option.value, action: option.action, recommended: option.recommended })) };
  const pullRequest = pullRequestState(latest);
  if (pullRequestAsks[pullRequest]) return pullRequestAsk(latest.delivery, pullRequest);
  const options = latest.resumable ? [{ label: 'Retry', value: retryInput, recommended: true }] : [];
  return { kind: 'followup', text: latest.reason ?? '', options, markDone: true };
}

export const recommendedFirst = options => options.some(option => option.recommended) ? options : options.map((option, index) => ({ ...option, recommended: index === 0 }));
