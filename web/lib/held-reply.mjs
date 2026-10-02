import { activeStatuses } from './board.mjs';

// A reply that closed an agent turn reads as "done"; show it only once checks and review have settled the run.
export function heldReplies(run) {
  const held = new Set();
  if (!activeStatuses.has(run.status)) return held;
  let closing = null;
  for (const event of run.events) {
    if (event.kind === 'message') closing = event.id;
    else if (event.kind === 'validating' && closing) { held.add(closing); closing = null; }
  }
  const turn = run.workerTurns?.findLast(item => item.role !== 'reviewer');
  if (closing && turn && turn.status !== 'running') held.add(closing);
  return held;
}
