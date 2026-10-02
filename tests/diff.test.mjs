import test from 'node:test';
import assert from 'node:assert/strict';
import { diffstat, fileTree, lineReference, parseDiff } from '../web/lib/diff.mjs';

test('diff aligns replacements, additions and context with both line numbers', () => {
  const [file] = parseDiff(' summary\ndiff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n@@ -10,3 +10,4 @@ fn\n context\n-old\n+new\n+extra\n tail\n\\ No newline at end of file\n');
  assert.equal(file.name, 'app.js'); assert.equal(file.additions, 2); assert.equal(file.deletions, 1);
  assert.deepEqual(file.rows[2], { kind: 'change', before: { number: 11, text: 'old', changed: true }, after: { number: 11, text: 'new', changed: true } });
  assert.equal(file.rows[3].before, null); assert.equal(file.rows[4].before.number, 12); assert.equal(file.rows[4].after.number, 13);
  assert.equal(file.rows.at(-1).kind, 'note');
});
test('diff preserves binary metadata, empty hunks, deletion and literal ticket-like text', () => {
  const files = parseDiff('diff --git a/image.png b/image.png\nBinary files differ\ndiff --git a/old.txt b/old.txt\n--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-<script>unsafe</script>\ndiff --git a/new.txt b/new.txt\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new\n');
  assert.equal(files.length, 3); assert.deepEqual(files[0].metadata, ['Binary files differ']); assert.equal(files[1].name, 'old.txt'); assert.equal(files[1].rows[1].after, null); assert.equal(files[2].rows[1].before, null);
  assert.equal(files[1].rows[1].before.text, '<script>unsafe</script>');
  assert.deepEqual(parseDiff(''), []);
});

test('line references quote one line or every line of a range', () => {
  assert.equal(lineReference({ file: 'a.js', line: 2, text: '  old ' }), 'a.js:2\n> old');
  assert.equal(lineReference({ file: 'a.js', line: 2, endLine: 2, text: 'only' }), 'a.js:2\n> only');
  assert.equal(lineReference({ file: 'a.js', line: 2, endLine: 4, text: 'first\n  middle\nlast' }), 'a.js:2-4\n> first\n>   middle\n> last');
});

test('changed files group by folder in patch order', () => {
  const files = [{ name: 'src/a.mjs', additions: 1, deletions: 0 }, { name: 'README.md', additions: 2, deletions: 1 }, { name: 'src/b.mjs', additions: 0, deletions: 3 }];
  assert.deepEqual(fileTree(files).map(group => [group.folder, group.files.map(file => file.index)]), [['src', [0, 2]], ['', [1]]]);
});

test('the diffstat splits five blocks by share of added and removed lines', () => {
  assert.deepEqual(diffstat(4, 1), ['added', 'added', 'added', 'added', 'removed']);
  assert.deepEqual(diffstat(0, 0), Array(5).fill('neutral'));
  assert.deepEqual(diffstat(1, 0), Array(5).fill('added'));
});
