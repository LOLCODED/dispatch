import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const unsystemd = value => value.replace(/%%/g, '%').replace(/\\(["\\])/g, '$1');
const unxml = value => value.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

export function serviceEnv(text) {
  const env = {};
  for (const [, pair] of text.matchAll(/^Environment="((?:[^"\\]|\\.)*)"$/gm)) { const value = unsystemd(pair), at = value.indexOf('='); env[value.slice(0, at)] = value.slice(at + 1); }
  for (const [, key, value] of text.matchAll(/<key>([A-Z_]+)<\/key><string>([^<]*)<\/string>/g)) env[key] = unxml(value);
  return env;
}

export const movedPath = (path, from, to) => path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;

export function rewritePaths(value, from, to) {
  if (typeof value === 'string') return movedPath(value, from, to);
  if (Array.isArray(value)) return value.map(item => rewritePaths(item, from, to));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewritePaths(item, from, to)]));
  return value;
}

function worktreeRepository(workspace, from, to) {
  const file = join(workspace, '.git');
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  const gitdir = readFileSync(file, 'utf8').match(/^gitdir: (.+)$/m)?.[1]?.trim();
  return gitdir?.includes('/.git/worktrees/') ? movedPath(gitdir, from, to).split('/.git/worktrees/')[0] : null;
}

// Git records both ends of every worktree link as absolute paths, so each moved worktree is re-linked from its repository.
export function repairWorktrees(root, from, to, git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' })) {
  const failed = [];
  for (const name of existsSync(root) ? readdirSync(root) : []) {
    const workspace = join(root, name), repository = worktreeRepository(workspace, from, to);
    if (!repository) continue;
    const result = git(repository, ['worktree', 'repair', workspace]);
    if (result.status !== 0) failed.push(`${workspace}: ${String(result.stderr ?? '').trim() || `exit ${result.status}`}`);
  }
  return failed;
}

// Moves a stopped install's data folder and rewrites the absolute paths dispatch and Git stored inside it.
export function migrateData(from, to) {
  if (existsSync(to)) throw new Error(`${to} already exists; data stays in ${from}.`);
  if (existsSync(join(from, 'server.lock'))) throw new Error(`dispatch still holds ${from}; stop it before moving its data.`);
  renameSync(from, to);
  const state = join(to, 'state.json');
  if (existsSync(state)) writeFileSync(state, `${JSON.stringify(rewritePaths(JSON.parse(readFileSync(state, 'utf8')), from, to), null, 2)}\n`);
  return { failed: repairWorktrees(join(to, 'live-workspaces'), from, to) };
}
