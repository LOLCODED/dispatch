import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewVerdict, reviewPrompt, maxFindings } from '../src/review.mjs';
test('review requires explicit consistent JSON, with at most five located findings', () => {
  assert.equal(reviewVerdict('{"approved":true,"findings":[]}').approved, true);
  assert.equal(reviewVerdict('{"approved":false,"findings":["src/a.js:12 — regression — callers get null"]}').approved, false);
  assert.equal(reviewVerdict('{"approved":false,"findings":["Dockerfile:3 — wrong base image — build fails"]}').findings.length, 1);
  const six = JSON.stringify({ approved: false, findings: Array.from({ length: maxFindings + 1 }, (_, i) => `a.js:${i + 1} — x — y`) });
  for (const summary of ['okay', 'null', '{}', '{"approved":true,"findings":["bug"]}', '{"approved":false,"findings":[]}', '{"approved":"true","findings":[]}', '{"approved":false,"findings":["a.js: regression"]}', '{"approved":false,"findings":["the code is wrong"]}', six, JSON.stringify({ approved: false, findings: ['a.js:1 ' + 'x'.repeat(2001)] })]) assert.throws(() => reviewVerdict(summary));
});
test('the review prompt locks scope to the diff, lists changed files and narrows a second round to the earlier findings', () => {
  const run = { baseSha: 'base1', changedPaths: ['src/a.js', 'src/b.js'], ticket: { title: 'T', description: 'D', acceptance: 'A' } };
  const first = reviewPrompt(run, { instructions: '\n\nOPERATOR INSTRUCTIONS:\n- prefer staging' });
  assert.match(first, /only defects this diff introduces/); assert.match(first, /1–5 findings/); assert.match(first, /Changed files:\n- src\/a\.js\n- src\/b\.js/); assert.match(first, /OPERATOR INSTRUCTIONS:\n- prefer staging/); assert.doesNotMatch(first, /second round/);
  const second = reviewPrompt(run, { previousFindings: ['src/a.js:3 — x — y'] });
  assert.match(second, /second round[\s\S]*do not raise anything new[\s\S]*Previous findings:\n- src\/a\.js:3 — x — y/);
});
