import test from 'node:test';
import assert from 'node:assert/strict';
import { answerOptions, blockedQuestionOf, parseBlockedQuestion, planApproval } from '../web/lib/question.mjs';

test('blocked questions drop the notes section and keep free text when no options are listed', () => {
  const parsed = parseBlockedQuestion('Should this be a standalone page?\n\n## Notes for next time:\n\n- Saved tasks exist.');
  assert.deepEqual(parsed, { question: 'Should this be a standalone page?', options: [] });
});

test('blocked questions expose numbered options with descriptions', () => {
  const parsed = parseBlockedQuestion('Where should the todo app live?\n1. New repository (Recommended) — keeps dispatch clean\n2. Inside dispatch\nNotes for next time:\n- none');
  assert.equal(parsed.question, 'Where should the todo app live?');
  assert.deepEqual(parsed.options, [{ label: 'New repository (Recommended)', description: 'keeps dispatch clean' }, { label: 'Inside dispatch', description: undefined }]);
});

test('a single numbered line is prose, not a choice', () => {
  assert.deepEqual(parseBlockedQuestion('Which one?\n1. Only this').options, []);
});

test('answer options hide Other and mark the recommended choice', () => {
  assert.deepEqual(answerOptions([{ label: 'Small (Recommended)' }, { label: 'Other' }]), [{ label: 'Small (Recommended)', text: 'Small', recommended: true }]);
});

test('a plan offers approval as the recommended choice and leaves adjustments to free text', () => {
  assert.deepEqual(blockedQuestionOf('Approve this plan?', true), { question: 'Approve this plan?', options: [planApproval] });
  assert.equal(answerOptions([planApproval])[0].recommended, true);
  assert.deepEqual(blockedQuestionOf('Which one?\n1. A\n2. B').options.length, 2);
});
