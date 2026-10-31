import test from 'node:test';
import assert from 'node:assert/strict';
import { afkAnswers, afkContinuation, afkLimit, recommended } from '../src/afk.mjs';

test('AFK answers take the recommended option, else the first, and never "Other"', () => {
  assert.equal(recommended([{ label: 'Keep it' }, { label: 'Port it (Recommended)' }]), 'Port it');
  assert.equal(recommended([{ label: 'Other' }, { label: 'Keep it' }]), 'Keep it');
  assert.equal(recommended([]), null);
  const { chosen, answers } = afkAnswers([{ id: 'q1', question: 'Which?', options: [{ label: 'A' }, { label: 'B (Recommended)' }] }, { id: 'q2', question: 'Name?' }]);
  assert.equal(chosen.q1, 'B'); assert.deepEqual(answers.q1, { answers: ['B'] });
  assert.match(chosen.q2, /best judgement/);
});

test('a blocked AFK run continues with its recommended option until the streak limit', () => {
  const question = "I'll retry the research.\n1. Continue with the research (Recommended)\n2. Retune from descriptions only";
  const next = afkContinuation({ status: 'blocked', question });
  assert.equal(next.afk, true); assert.match(next.input, /Go with: Continue with the research$/);
  assert.equal(afkContinuation({ status: 'blocked', question, afkStreak: afkLimit }), null, 'stops looping and waits for the operator');
  assert.equal(afkContinuation({ status: 'blocked', question: 'Log in to the CLI first.' }), null, 'no options means a real blocker');
  assert.equal(afkContinuation({ status: 'ready', question }), null);
});
