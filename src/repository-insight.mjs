import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { longRunningScript } from './recipe-roles.mjs';

const maxCiBytes = 256 * 1024;
const ciFolders = ['.github/workflows', '.azure-pipelines', '.circleci'];
const ciFiles = ['azure-pipelines.yml', 'azure-pipelines.yaml', '.gitlab-ci.yml', 'bitbucket-pipelines.yml', 'Jenkinsfile'];
const checkKinds = new Set(['test', 'e2e', 'lint', 'typecheck', 'format', 'check']);
const fallbackChecks = /^(check|test|test:unit|test:e2e)$/;

// Order matters: a deploy or server script is never a check, whatever else its name says.
const kindRules = [
  ['deploy', (name, body) => /deploy|release|publish|migrat|seed|rollback|backup|restore|^db[:-]|snapshot|sync|backfill|reconcile|^fix[:-]|prod|staging|restart|spike/i.test(name) || /\b(dbmate|prisma migrate|knex migrate|sequelize db:|npm publish)\b/.test(body)],
  ['server', (name, body) => longRunningScript(name) || /\b(nodemon|next dev|webpack serve|ts-node-dev|tsx watch|--watch)\b|\bvite(?!\s+build)(\s|$)/.test(body)],
  ['format-write', (name, body) => /--write\b|--fix\b/.test(body) || /:fix\b|^fix\b/.test(name)],
  ['service-test', (name, body) => /^test/.test(name) && /[:-](db|database|integration|it)(\b|:)/.test(name)],
  ['e2e', (name, body) => /e2e|playwright|cypress/i.test(name) || /\b(playwright test|cypress run)\b/.test(body)],
  ['test', (name, body) => /^test/.test(name) || /\b(jest|vitest|mocha|ava|tap|node --test)\b/.test(body)],
  ['typecheck', (name, body) => /type-?check|types/i.test(name) || /\b(tsc|vue-tsc)\b.*--noEmit/.test(body)],
  ['lint', (name, body) => /lint/i.test(name) || /\b(eslint|stylelint|biome)\b/.test(body)],
  ['format', (name, body) => /format|prettier/i.test(name) || /\bprettier\b/.test(body)],
  ['check', name => /^(check|ci|verify|validate)(:|$)/.test(name)],
  ['build', (name, body) => /^build/.test(name) || /\b(vite build|tsc|webpack|rollup|esbuild)\b/.test(body)],
];
export const scriptKind = (name, body = '') => kindRules.find(([, matches]) => matches(name, String(body)))?.[0] ?? 'other';

function readCapped(file) {
  try { return statSync(file).size <= maxCiBytes ? readFileSync(file, 'utf8') : ''; } catch { return ''; }
}
function ciTexts(root) {
  const files = ciFiles.map(file => join(root, file));
  for (const folder of ciFolders) {
    try { for (const entry of readdirSync(join(root, folder))) if (/\.ya?ml$/.test(entry)) files.push(join(root, folder, entry)); } catch { /* No CI folder of this kind. */ }
  }
  return files.filter(file => existsSync(file)).map(readCapped).filter(Boolean);
}

// What CI runs is the best evidence of which scripts pass on the base branch and matter to the team.
export function ciScripts(texts, scripts) {
  const found = new Set();
  for (const text of texts) {
    for (const [, name] of text.matchAll(/\bnpm\s+(?:run(?:-script)?\s+)([\w:.-]+)/g)) found.add(name);
    if (/\bnpm\s+(?:test|t)\b/.test(text)) found.add('test');
    for (const [, name] of text.matchAll(/\b(?:yarn|pnpm)\s+(?:run\s+)?([\w:.-]+)/g)) found.add(name);
  }
  return [...found].filter(name => typeof scripts[name] === 'string');
}

// npm ci only regenerates the Prisma client when postinstall asks for it; without one, code importing it fails in a fresh worktree.
const needsPrismaGenerate = (root, scripts) => existsSync(join(root, 'prisma', 'schema.prisma')) && !/prisma generate/.test(scripts.postinstall ?? '');

export function registryHosts(root) {
  const text = readCapped(join(root, '.npmrc'));
  const hosts = [...text.matchAll(/^\s*(?:@[\w-]+:)?registry\s*=\s*(\S+)/gm)].map(([, url]) => { try { return new URL(url).hostname; } catch { return null; } });
  return [...new Set(hosts.filter(host => host && host !== 'registry.npmjs.org'))];
}

// Untracked env files never reach a fresh worktree, which is the usual reason tests pass locally and fail in a task.
export function localEnvFiles(root) {
  try { return readdirSync(root).filter(name => /^\.env(\.[\w-]+)?$/.test(name) && !/\.(example|sample|template|dist)$/.test(name)).sort(); } catch { return []; }
}
export const suggestedLocalFiles = files => files.filter(name => /^\.env\.(test|testing|local|development|dev)$/.test(name));

export function repositoryInsight(root, scripts) {
  const texts = ciTexts(root), inCi = new Set(ciScripts(texts, scripts));
  const details = Object.fromEntries(Object.entries(scripts).map(([name, body]) => [name, { command: String(body).slice(0, 200), kind: scriptKind(name, body), ci: inCi.has(name) }]));
  const ciChecks = [...inCi].filter(name => checkKinds.has(details[name].kind));
  const suggestedChecks = ciChecks.length ? ciChecks : Object.keys(scripts).filter(name => fallbackChecks.test(name) && !['server', 'deploy'].includes(details[name].kind));
  const localFiles = localEnvFiles(root), registries = registryHosts(root);
  return {
    scriptDetails: details, suggestedChecks, checksFrom: ciChecks.length ? 'ci' : 'names',
    suggestedSetup: needsPrismaGenerate(root, scripts) ? [{ id: 'prisma-generate', command: 'npx', args: ['prisma', 'generate'] }] : [],
    localFiles, suggestedLocalFiles: suggestedLocalFiles(localFiles), registries,
  };
}
