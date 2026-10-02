import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionOf, attentionTitle, clampVolume, defaultVolume, hasNewAsk, trayLimit, trayOf } from '../web/lib/attention.mjs';

const run = (id, status, extra = {}) => ({ id, title: id, mode: 'live', status, createdAt: '2026-09-30T10:00:00Z', ...extra });

test('counts tasks that need a decision or are ready for review, and pings for agent asks and new reviews', () => {
  const runs = [run('a', 'blocked'), run('b', 'failed'), run('c', 'ready'), run('d', 'implementing'), run('e', 'ready'), run('f', 'ready')];
  const board = { items: { e: { pause: { runId: 'e' } }, f: { done: { runId: 'f' } } } };
  const { count, asks } = attentionOf({ runs, board });
  assert.equal(count, 4);
  assert.deepEqual([...asks].sort(), ['decision:a:a', 'decision:b:b', 'review:c:c']);
});

test('lists what needs you, what is ready for review and what is running, capped per group', () => {
  const runs = [run('a', 'blocked'), run('d', 'implementing'), run('q', 'queued'), ...Array.from({ length: trayLimit + 2 }, (_, index) => run(`r${index}`, 'ready'))];
  const sections = trayOf({ runs });
  assert.deepEqual(sections.map(section => [section.state, section.total, section.entries.length]), [['decision', 1, 1], ['review', trayLimit + 2, trayLimit], ['active', 1, 1]]);
  assert.deepEqual(trayOf({ runs: [] }), []);
});

test('prefixes the tab title with the count only when something waits', () => {
  assert.equal(attentionTitle('dispatch', 0), 'dispatch');
  assert.equal(attentionTitle('dispatch', 2), '(2) dispatch');
});

test('pings for a new ask but not on first load or when asks clear', () => {
  assert.equal(hasNewAsk(null, new Set(['a:1'])), false);
  assert.equal(hasNewAsk(new Set(['a:1']), new Set(['a:1'])), false);
  assert.equal(hasNewAsk(new Set(['a:1']), new Set()), false);
  assert.equal(hasNewAsk(new Set(['a:1']), new Set(['a:2'])), true);
});

test('keeps stored volume within 0 to 100', () => {
  assert.equal(clampVolume('35'), 35);
  assert.equal(clampVolume('140'), 100);
  assert.equal(clampVolume('-3'), 0);
  assert.equal(clampVolume(''), defaultVolume);
  assert.equal(clampVolume('loud'), defaultVolume);
});
