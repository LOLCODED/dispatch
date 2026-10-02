import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationTree } from '../src/conversations.mjs';

const run = (id, createdAt, previousRunId) => ({ id, createdAt: `2026-01-01T00:0${createdAt}:00Z`, previousRunId });

test('groups follow-ups beneath their first turn, newest conversation first', () => {
  const tree = conversationTree([run('b2', 4, 'b1'), run('a1', 1), run('b1', 2), run('a2', 3, 'a1')]);
  assert.deepEqual(tree.map(chain => chain.map(item => item.id)), [['b1', 'b2'], ['a1', 'a2']]);
});

test('treats follow-ups with unavailable predecessors as their own conversation', () => {
  assert.deepEqual(conversationTree([run('x', 1, 'missing')]).map(chain => chain.map(item => item.id)), [['x']]);
});

test('stops on cyclic links instead of looping', () => {
  const tree = conversationTree([run('a', 1, 'b'), run('b', 2, 'a')]);
  assert.equal(tree.flat().length, 2);
});
