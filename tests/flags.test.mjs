import test from 'node:test';
import assert from 'node:assert/strict';
import { changeFlags, sqlToRun, sqlOutputLimit } from '../src/flags.mjs';
test('change flags come from the diff paths alone and name every matching file', () => {
  const flags = changeFlags(['src/a.js', 'src/a.test.js', 'tests/e2e/run.spec.mjs', 'db/migrations/002_add.sql', 'scripts/seed.sql', '.env.staging', 'package-lock.json', 'src/controllers/legacy.js'], ['src/controllers/**']);
  assert.deepEqual(flags, { testsChanged: ['src/a.test.js', 'tests/e2e/run.spec.mjs'], sqlChanged: ['db/migrations/002_add.sql', 'scripts/seed.sql'], envChanged: ['.env.staging'], lockfileChanged: ['package-lock.json'], protectedTouched: ['src/controllers/legacy.js'] });
  assert.deepEqual(changeFlags([], undefined), { testsChanged: [], sqlChanged: [], envChanged: [], lockfileChanged: [], protectedTouched: [] });
  assert.deepEqual(changeFlags(['README.md']).testsChanged, []);
});
test('SQL to run is read from the tested revision, labelled per file, bounded, and absent without .sql changes', async () => {
  const contents = { 'db/001.sql': 'CREATE TABLE a (id int);\n', 'db/002.sql': 'x'.repeat(sqlOutputLimit) };
  const text = await sqlToRun(['db/001.sql', 'db/migrations/note.md', 'db/002.sql', 'db/missing.sql'], async path => { if (!(path in contents)) throw new Error('missing'); return contents[path]; });
  assert.match(text, /^-- db\/001\.sql\nCREATE TABLE a \(id int\);\n\n-- db\/002\.sql: omitted, output limit reached\n\n-- db\/missing\.sql\n-- file could not be read$/);
  assert.equal(await sqlToRun([], async () => ''), null); assert.equal(await sqlToRun(['db/migrations/note.md'], async () => ''), null);
});
