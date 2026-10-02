import test from 'node:test';
import assert from 'node:assert/strict';
import { checkScope, globRegExp, projectScopes, recipeScopes, scopeSettings, textOnlySettings } from '../src/check-scope.mjs';

const validation = [{ id: 'check' }, { id: 'test' }, { id: 'test:e2e' }];
const project = { validation, textOnly: { paths: ['*.md', 'docs/**', 'web/copy/*.json'], checks: ['check'] } };
const scoped = { validation, checkScopes: [{ id: 'docs', paths: ['*.md', 'docs/**'], checks: [] }, { id: 'web', paths: ['web/**'], checks: ['check', 'test'] }, { id: 'web-e2e', paths: ['web/pages/*.jsx'], checks: ['test:e2e'] }] };

test('glob patterns match at any depth without a slash and from the root with one', () => {
  assert.ok(globRegExp('*.md').test('README.md')); assert.ok(globRegExp('*.md').test('web/notes/a.md'));
  assert.ok(globRegExp('docs/**').test('docs/a/b.png')); assert.ok(!globRegExp('docs/**').test('src/docs/a.md'));
  assert.ok(globRegExp('**/locales/*.json').test('locales/en.json')); assert.ok(globRegExp('**/locales/*.json').test('web/locales/en.json'));
  assert.ok(!globRegExp('web/copy/*.json').test('web/copy/nested/en.json')); assert.ok(!globRegExp('*.md').test('README.mdx'));
});
test('legacy text-only rules behave as one scope and run only the selected checks', () => {
  assert.deepEqual(projectScopes(project), [{ id: 'text-only', paths: ['*.md', 'docs/**', 'web/copy/*.json'], checks: ['check'] }]);
  const scope = checkScope(project, ['README.md', 'docs/STATUS.md']);
  assert.equal(scope.scoped, true); assert.deepEqual(scope.matched.map(item => item.id), ['text-only']);
  assert.deepEqual(scope.steps.map(step => step.id), ['check']); assert.deepEqual(scope.skipped.map(step => step.id), ['test', 'test:e2e']);
});
test('every changed file must match a scope; the required checks are the union of the matched scopes', () => {
  assert.deepEqual(checkScope(scoped, ['README.md']).steps, []);
  assert.deepEqual(checkScope(scoped, ['README.md', 'web/lib/diff.mjs']).steps.map(step => step.id), ['check', 'test']);
  assert.deepEqual(checkScope(scoped, ['web/pages/Run.jsx']).steps.map(step => step.id), ['check', 'test', 'test:e2e']);
  const reversed = { validation, checkScopes: [...scoped.checkScopes].reverse() };
  assert.deepEqual(checkScope(reversed, ['web/pages/Run.jsx', 'docs/a.md']).steps.map(step => step.id), ['check', 'test', 'test:e2e']);
  assert.deepEqual(checkScope(scoped, ['web/pages/Run.jsx', 'src/live.mjs']), { scoped: false, matched: [], steps: validation, skipped: [] });
});
test('any unmatched file or no rules runs every check; an empty diff also does, though the run blocks before checks', () => {
  for (const [rules, paths] of [[project, ['README.md', 'src/live.mjs']], [project, []], [{ validation }, ['README.md']], [{ validation, textOnly: { paths: [], checks: [] } }, ['README.md']], [{ validation, checkScopes: [] }, ['README.md']]]) {
    const scope = checkScope(rules, paths);
    assert.equal(scope.scoped, false); assert.equal(scope.steps, validation); assert.deepEqual(scope.skipped, []);
  }
});
test('settings reject match-all and escaping patterns and drop checks that no longer exist', () => {
  assert.deepEqual(textOnlySettings(undefined, validation), { paths: [], checks: [] });
  assert.deepEqual(textOnlySettings({ paths: [' *.md ', '', '*.md'], checks: ['check', 'gone'] }, validation), { paths: ['*.md'], checks: ['check'] });
  assert.deepEqual(textOnlySettings({ paths: [], checks: ['check'] }, validation), { paths: [], checks: [] });
  for (const path of ['**', '*', '**/*']) assert.throws(() => textOnlySettings({ paths: [path], checks: [] }, validation), /every file/);
  assert.throws(() => textOnlySettings({ paths: ['../x/*.md'], checks: [] }, validation), /repository-relative/);
  assert.throws(() => textOnlySettings({ paths: 'docs/**' }, validation), /list/);
});
test('scope settings name scopes, drop empty ones, and reject duplicates, match-all patterns and too many scopes', () => {
  assert.deepEqual(scopeSettings(undefined, validation), []);
  assert.deepEqual(scopeSettings([{ paths: ['*.md'], checks: ['check', 'gone'] }, { id: 'none', paths: [], checks: ['test'] }], validation), [{ id: 'scope-1', paths: ['*.md'], checks: ['check'] }]);
  assert.throws(() => scopeSettings([{ id: 'a', paths: ['*.md'] }, { id: 'a', paths: ['docs/**'] }], validation), /unique/);
  assert.throws(() => scopeSettings([{ id: 'a', paths: ['**'] }], validation), /every file/);
  assert.throws(() => scopeSettings(Array.from({ length: 25 }, (_, i) => ({ paths: [`dir${i}/**`] })), validation), /at most 24/);
  assert.equal(scopeSettings(Array.from({ length: 17 }, (_, i) => ({ paths: [`dir${i}/**`] })), validation).length, 17);
  assert.throws(() => scopeSettings({ paths: ['*.md'] }, validation), /list of scopes/);
  assert.deepEqual(recipeScopes({ textOnly: { paths: ['*.md'], checks: ['check'] } }, validation), [{ id: 'text-only', paths: ['*.md'], checks: ['check'] }]);
  assert.deepEqual(recipeScopes({ checkScopes: [{ id: 'docs', paths: ['docs/**'], checks: [] }], textOnly: { paths: ['*.md'], checks: [] } }, validation), [{ id: 'docs', paths: ['docs/**'], checks: [] }]);
  assert.deepEqual(recipeScopes({}, validation), []);
});
