import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionOf, attentionTitle, badgedIcon, decisionAlert, newAskKind } from '../web/lib/attention.mjs';

const run = (id, status) => ({ id, title: id, mode: 'live', status, createdAt: '2026-09-30T10:00:00Z' });

test('counts decisions apart from reviews', () => {
  const { count, decisions } = attentionOf({ runs: [run('a', 'blocked'), run('c', 'ready'), run('e', 'ready')] });
  assert.deepEqual({ count, decisions }, { count: 3, decisions: 1 });
});

test('marks the tab title when a decision waits', () => {
  assert.equal(attentionTitle('dispatch', 3, 0), '(3) dispatch');
  assert.equal(attentionTitle('dispatch', 3, 1), '(! 1 · 2) dispatch');
  assert.equal(attentionTitle('dispatch', 2, 2), '(! 2) dispatch');
  assert.equal(decisionAlert(1), '! Decision needed');
  assert.equal(decisionAlert(3), '! 3 decisions needed');
});

test('a new decision outranks a new review for the ping', () => {
  const before = new Set(['review:c:c']);
  assert.equal(newAskKind(null, new Set(['decision:a:a'])), null);
  assert.equal(newAskKind(before, before), null);
  assert.equal(newAskKind(before, new Set([...before, 'review:e:e'])), 'review');
  assert.equal(newAskKind(before, new Set([...before, 'review:e:e', 'decision:a:a'])), 'decision');
});

test('adds a dot to the favicon svg', () => {
  const href = 'data:image/svg+xml,%3Csvg%3E%3Crect/%3E%3C/svg%3E';
  assert.match(badgedIcon(href), /%3Ccircle .*%3C\/svg%3E$/);
  assert.equal(badgedIcon(href).match(/%3C\/svg%3E/g).length, 1);
});
