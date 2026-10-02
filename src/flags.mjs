import { globRegExp } from './check-scope.mjs';

const patterns = {
  testsChanged: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', 'tests/**', 'test/**', 'e2e/**', '**/*.snap'],
  sqlChanged: ['**/*.sql', '**/migrations/**', '**/migrate/**'],
  envChanged: ['**/.env', '**/.env.*'],
  lockfileChanged: ['**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/bun.lock', '**/bun.lockb'],
};
const compiled = Object.fromEntries(Object.entries(patterns).map(([key, globs]) => [key, globs.map(globRegExp)]));
const matching = (paths, regexps) => paths.filter(path => regexps.some(pattern => pattern.test(path)));
export const sqlOutputLimit = 20000;

export function changeFlags(changedPaths = [], protectedGlobs = []) {
  const paths = Array.isArray(changedPaths) ? changedPaths : [];
  const flags = Object.fromEntries(Object.entries(compiled).map(([key, regexps]) => [key, matching(paths, regexps)]));
  flags.protectedTouched = matching(paths, (protectedGlobs ?? []).map(globRegExp));
  return flags;
}

export async function sqlToRun(paths, read) {
  const files = (paths ?? []).filter(path => /\.sql$/i.test(path));
  if (!files.length) return null;
  const parts = [];
  let used = 0;
  for (const path of files) {
    let content;
    try { content = await read(path); } catch { content = '-- file could not be read'; }
    const text = `-- ${path}\n${String(content).trim()}`;
    if (used + text.length > sqlOutputLimit) { parts.push(`-- ${path}: omitted, output limit reached`); continue; }
    parts.push(text); used += text.length;
  }
  return parts.join('\n\n');
}
