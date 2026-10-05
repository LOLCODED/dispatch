import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { repositoryInsight, scriptKind } from '../src/repository-insight.mjs';
import { suggestedRecipe } from '../src/repository-setup.mjs';

function repository(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-insight-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); }
  return root;
}

test('scripts are classified by name and command, and anything that never finishes or changes things is never a check', () => {
  const kinds = Object.fromEntries(Object.entries({
    test: 'vitest run', 'test:db': 'node --test tests/db', 'test:e2e': 'playwright test', lint: 'eslint .', 'lint:fix': 'eslint . --fix', typecheck: 'tsc --noEmit',
    format: 'prettier --write .', 'format:check': 'prettier --check .', dev: 'vite', build: 'vite build', 'db:migrate:prod': 'dbmate up', 'sync:users:staging': 'node sync.js', release: 'np', other: 'node tools/x.js',
  }).map(([name, body]) => [name, scriptKind(name, body)]));
  assert.deepEqual(kinds, { test: 'test', 'test:db': 'service-test', 'test:e2e': 'e2e', lint: 'lint', 'lint:fix': 'format-write', typecheck: 'typecheck', format: 'format-write', 'format:check': 'format', dev: 'server', build: 'build', 'db:migrate:prod': 'deploy', 'sync:users:staging': 'deploy', release: 'deploy', other: 'other' });
});

test('checks come from what CI runs, setup and findings from the repository files', t => {
  const scripts = { test: 'jest', 'test:unit': 'jest unit', 'test:db': 'jest db', lint: 'eslint .', dev: 'nodemon', deploy: 'sh deploy.sh', postinstall: 'husky' };
  const root = repository(t, {
    '.github/workflows/ci.yml': 'jobs:\n  test:\n    steps:\n      - run: npm ci\n      - run: npm run lint\n      - run: npm run test:unit\n      - run: npm run test:db\n      - run: npm run deploy\n',
    '.npmrc': '@acme:registry=https://npm.example.test/\nregistry=https://registry.npmjs.org/\n',
    'prisma/schema.prisma': 'generator client {}', '.env.test': 'A=1', '.env.example': 'A=', '.env': 'A=2',
  });
  const insight = repositoryInsight(root, scripts);
  assert.equal(insight.checksFrom, 'ci'); assert.deepEqual(insight.suggestedChecks, ['lint', 'test:unit']);
  assert.equal(insight.scriptDetails['test:db'].ci, true); assert.equal(insight.scriptDetails['test:db'].kind, 'service-test');
  assert.deepEqual(insight.suggestedSetup, [{ id: 'prisma-generate', command: 'npx', args: ['prisma', 'generate'] }]);
  assert.deepEqual(insight.registries, ['npm.example.test']);
  assert.deepEqual(insight.localFiles, ['.env', '.env.test']); assert.deepEqual(insight.suggestedLocalFiles, ['.env.test']);
  assert.deepEqual(suggestedRecipe({ ...insight, suggestInstall: true }).setup.map(step => step.id), ['install', 'prisma-generate']);
});

test('without CI the suggestion keeps to the usual test script names, and a postinstall that generates Prisma needs no extra setup', t => {
  const root = repository(t, { 'prisma/schema.prisma': '' });
  const insight = repositoryInsight(root, { test: 'jest', 'test:unit': 'jest', lint: 'eslint .', start: 'node .', postinstall: 'prisma generate' });
  assert.equal(insight.checksFrom, 'names'); assert.deepEqual(insight.suggestedChecks, ['test', 'test:unit']);
  assert.deepEqual(insight.suggestedSetup, []); assert.deepEqual(insight.registries, []); assert.deepEqual(insight.localFiles, []);
});
