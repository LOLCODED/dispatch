import test from 'node:test';
import assert from 'node:assert/strict';
import { groupEvidence, stepThrough } from '../web/lib/evidence.mjs';

const shot = (id, check, attempt) => ({ id, at: id, type: 'artifact', artifact: { id, check, attempt } });

test('consecutive evidence from one check attempt collapses into a single group', () => {
  const grouped = groupEvidence([shot('a', 'test:e2e', 1), shot('b', 'test:e2e', 1), { id: 'e', type: 'event' }, shot('c', 'test:e2e', 1), shot('d', 'test:e2e', 2), shot('f', 'Agent browser', 2)]);
  assert.deepEqual(grouped.map(entry => entry.type === 'evidence' ? entry.artifacts.map(artifact => artifact.id).join('') : entry.id), ['ab', 'e', 'c', 'd', 'f']);
  assert.equal(grouped[0].id, 'evidence-a'); assert.equal(grouped[0].at, 'a');
});
test('stepping wraps around and leaves unknown or single items in place', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.equal(stepThrough(items, items[2], 1), items[0]); assert.equal(stepThrough(items, items[0], -1), items[2]);
  assert.equal(stepThrough([items[0]], items[0], 1), items[0]); const other = { id: 9 }; assert.equal(stepThrough(items, other, 1), other);
});
