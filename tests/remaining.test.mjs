import test from 'node:test';
import assert from 'node:assert/strict';
import { asIsReport, openRemaining, remainingWork, splitRemaining, withoutBlocked } from '../src/remaining.mjs';

test('remaining work is the list after the marker, up to the notes or the next marker', () => {
  const text = 'Built part A.\n\n**DISPATCH_REMAINING:**\n- Part B: several repositories.\n2. Extensions\n\nDISPATCH_COMMIT: feat(x): y\nNotes for next time:\n- none';
  assert.deepEqual(splitRemaining(text), { before: 'Built part A.', items: ['Part B: several repositories.', 'Extensions'], after: 'DISPATCH_COMMIT: feat(x): y\nNotes for next time:\n- none' });
  assert.deepEqual(remainingWork('DISPATCH_REMAINING: Only one thing'), ['Only one thing']);
});

test('without the marker nothing is remaining and the text is untouched', () => {
  assert.deepEqual(splitRemaining('Done. What remains is nothing.'), { before: 'Done. What remains is nothing.', items: [], after: '' });
});

test('a placeholder like "none" under the marker is no remaining work', () => {
  for (const placeholder of ['- none', 'None.', '**None**', '(none)', 'N/A', '- nothing']) {
    assert.deepEqual(remainingWork(`Done.\n\nDISPATCH_REMAINING:\n${placeholder}\n\nNotes for next time:\n- none`), []);
  }
  assert.deepEqual(remainingWork('DISPATCH_REMAINING:\n- none\n- Part B'), ['Part B']);
});

test('only an unresolved, ready, latest run has open remaining work', () => {
  const run = { status: 'ready', remaining: { items: ['B'], resolution: null } };
  assert.equal(openRemaining(run), true);
  assert.equal(openRemaining({ ...run, status: 'failed' }), false);
  assert.equal(openRemaining({ ...run, supersededBy: 'next' }), false);
  assert.equal(openRemaining({ ...run, remaining: { items: ['B'], resolution: 'finish' } }), false);
});

test('a report taken as is drops the blocked question and its options and keeps the question as work left', () => {
  const summary = 'Merged the branch.\n\nDISPATCH_BLOCKED: The export needs access I lack. How should I proceed?\n1. You run it — fastest\n2. Allow the host\n\n**DISPATCH_REMAINING:**\n- Commit the export.\n\nNotes for next time:\n- none';
  assert.equal(withoutBlocked(summary), 'Merged the branch.\n\n**DISPATCH_REMAINING:**\n- Commit the export.\n\nNotes for next time:\n- none');
  const report = asIsReport(summary, 'The export needs access I lack. How should I proceed?\n1. You run it — fastest');
  assert.equal(report, 'Merged the branch.\n\nDISPATCH_REMAINING:\n- Open question: The export needs access I lack. How should I proceed?\n- Commit the export.');
  assert.deepEqual(remainingWork(report), ['Open question: The export needs access I lack. How should I proceed?', 'Commit the export.']);
  assert.equal(asIsReport('DISPATCH_BLOCKED: Validation scripts changed.', undefined), '');
  assert.equal(asIsReport('Done.', ''), 'Done.');
});
