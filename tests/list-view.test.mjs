import test from 'node:test';
import assert from 'node:assert/strict';
import { ascending, byText, descending, filterSort, pageOf, textMatches } from '../web/lib/list-view.mjs';

const items = [{ name: 'beta', at: 2 }, { name: 'Alpha', at: null }, { name: 'gamma', at: 3 }];

test('text matching ignores case, blanks and missing fields', () => {
  assert.equal(textMatches(['Fix Login', null], 'login'), true);
  assert.equal(textMatches(['Fix Login'], 'logout'), false);
  assert.equal(textMatches([], '  '), true);
});

test('filterSort filters only with a query and never mutates its input', () => {
  const matches = (item, query) => textMatches([item.name], query);
  assert.deepEqual(filterSort(items, { query: 'a', matches }).map(item => item.name), ['beta', 'Alpha', 'gamma']);
  assert.deepEqual(filterSort(items, { query: 'gam', matches }).map(item => item.name), ['gamma']);
  assert.deepEqual(filterSort(items, { compare: byText(item => item.name) }).map(item => item.name), ['Alpha', 'beta', 'gamma']);
  assert.equal(items[0].name, 'beta');
});

test('numeric sorts keep missing values last in both directions', () => {
  assert.deepEqual([...items].sort(descending(item => item.at)).map(item => item.at), [3, 2, null]);
  assert.deepEqual([...items].sort(ascending(item => item.at)).map(item => item.at), [2, 3, null]);
});

test('pages clamp to the available range', () => {
  const list = Array.from({ length: 25 }, (_, index) => index);
  assert.deepEqual(pageOf(list, 1, 10), { items: list.slice(10, 20), page: 1, pages: 3, total: 25 });
  assert.equal(pageOf(list, 9, 10).page, 2);
  assert.deepEqual(pageOf([], 3, 10), { items: [], page: 0, pages: 1, total: 0 });
});
