import { currentChecks } from './checks.mjs';

const failedAtRevision = run => currentChecks(run).some(check => check.status === 'failed');

export function suggestedReply(run) {
  if (run.status === 'blocked') return 'Go with the recommended option.';
  if (run.status === 'failed') return failedAtRevision(run) ? 'Fix the failing check.' : 'Try again.';
  if (run.status === 'ready') return run.kind === 'answer' || run.answered ? 'Make this change.' : null;
  if (['cancelled', 'interrupted', 'budget_exceeded'].includes(run.status)) return 'Continue.';
  return null;
}

// Tab accepts the suggestion only while the field is empty, so it never replaces typed text or traps keyboard focus.
export function acceptSuggestion(event, suggestion, value, onAccept) {
  if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || !suggestion || value.trim()) return;
  event.preventDefault();
  onAccept(suggestion);
}
