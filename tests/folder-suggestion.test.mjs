import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestFolder, unfiledSuggestions } from '../src/folder-suggestion.mjs';

const folders = [
  { id: 's1', name: 'Sprint 1', parentId: null, createdAt: '2026-09-01T00:00:00Z' },
  { id: 's2', name: 'Sprint 2', parentId: null, createdAt: '2026-09-15T00:00:00Z' },
  { id: 'garden', name: 'Garden', parentId: null, createdAt: '2026-08-01T00:00:00Z' },
];
const filed = [{ title: 'Water the tomato plants', folderId: 'garden' }, { title: 'Prune tomato vines', folderId: 'garden' }];

test('a mentioned folder name wins, matched as a whole name', () => {
  assert.equal(suggestFolder({ text: 'Put this in sprint 1 please', at: '2026-09-20T00:00:00Z' }, folders, filed).folder.id, 's1');
  assert.equal(suggestFolder({ text: 'Weed the garden', at: '2026-09-20T00:00:00Z' }, folders, filed).folder.id, 'garden');
  assert.notEqual(suggestFolder({ text: 'Sprint 12 kickoff', at: '2026-09-20T00:00:00Z' }, folders, filed).folder.id, 's1');
});

test('shared words with filed tasks come next, then the newest folder made before the task', () => {
  assert.equal(suggestFolder({ text: 'Stake the tomato plants', at: '2026-09-20T00:00:00Z' }, folders, filed).reason, 'like other tasks in Garden');
  assert.equal(suggestFolder({ text: 'Refactor login', at: '2026-09-20T00:00:00Z' }, folders, filed).folder.id, 's2');
  assert.equal(suggestFolder({ text: 'Refactor login', at: '2026-09-10T00:00:00Z' }, folders, filed).folder.id, 's1');
  assert.equal(suggestFolder({ text: 'Refactor login', at: '2026-07-01T00:00:00Z' }, folders, filed), null);
  assert.equal(suggestFolder({ text: 'Refactor login', at: '2026-09-20T00:00:00Z' }, [], filed), null);
});

test('only unfiled, unarchived tasks get suggestions', () => {
  const entries = [
    { key: 'a', title: 'Prune tomato plants', createdAt: '2026-09-20T00:00:00Z', state: 'todo', item: {} },
    { key: 'b', title: 'Prune tomato plants', createdAt: '2026-09-20T00:00:00Z', state: 'archived', item: {} },
    { key: 'c', title: 'Water the tomato plants', createdAt: '2026-09-20T00:00:00Z', state: 'review', item: { folderId: 'garden' } },
  ];
  assert.deepEqual(unfiledSuggestions(entries, folders).map(({ entry, folder }) => [entry.key, folder.id]), [['a', 'garden']]);
  assert.deepEqual(unfiledSuggestions(entries, []), []);
});
