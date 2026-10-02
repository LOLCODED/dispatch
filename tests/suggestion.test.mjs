import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptSuggestion, suggestedReply } from '../web/lib/suggestion.mjs';

test('the follow-up suggestion comes from the run state, with none while the agent works or after a change is ready', () => {
  assert.equal(suggestedReply({ status: 'blocked' }), 'Go with the recommended option.');
  assert.equal(suggestedReply({ status: 'failed', revision: 'r2', checks: [{ status: 'failed', revision: 'r2' }] }), 'Fix the failing check.');
  assert.equal(suggestedReply({ status: 'failed', revision: 'r2', checks: [{ status: 'failed', revision: 'r1' }] }), 'Try again.');
  assert.equal(suggestedReply({ status: 'ready', kind: 'answer' }), 'Make this change.');
  assert.equal(suggestedReply({ status: 'ready', kind: 'change', answered: true }), 'Make this change.');
  assert.equal(suggestedReply({ status: 'ready', kind: 'change' }), null);
  for (const status of ['cancelled', 'interrupted', 'budget_exceeded']) assert.equal(suggestedReply({ status }), 'Continue.');
  for (const status of ['queued', 'implementing', 'validating']) assert.equal(suggestedReply({ status }), null);
});

test('Tab accepts the suggestion only into an empty field', () => {
  const press = (key, extra = {}) => { const event = { key, preventDefault() { event.prevented = true; }, ...extra }; return event; };
  const filled = [];
  const tab = press('Tab'); acceptSuggestion(tab, 'Continue.', '', text => filled.push(text));
  assert.deepEqual(filled, ['Continue.']); assert.equal(tab.prevented, true);
  const typed = press('Tab'); acceptSuggestion(typed, 'Continue.', 'my own words', text => filled.push(text));
  const shifted = press('Tab', { shiftKey: true }); acceptSuggestion(shifted, 'Continue.', '', text => filled.push(text));
  const none = press('Tab'); acceptSuggestion(none, null, '', text => filled.push(text));
  assert.deepEqual(filled, ['Continue.']); assert.equal(typed.prevented, undefined); assert.equal(shifted.prevented, undefined); assert.equal(none.prevented, undefined);
});
