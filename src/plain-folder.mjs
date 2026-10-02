import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './local-tools.mjs';
import { ignored } from './new-repository.mjs';

export const isPlain = project => project?.git === false;
export const shadowDir = (root, projectId) => join(root, projectId);
export const notRepository = error => /not a git repository/i.test(error?.message ?? '');

export async function ensureShadow(dir, folder) {
  if (!existsSync(join(dir, 'HEAD'))) { mkdirSync(dir, { recursive: true }); await git(dir, ['init', '--bare', '--quiet']); }
  for (const [key, value] of [['core.bare', 'false'], ['core.worktree', folder], ['gc.auto', '0']]) await git(folder, ['config', key, value], { gitDir: dir });
  mkdirSync(join(dir, 'info'), { recursive: true });
  // Git matches "node_modules/" to directories only; a symlinked node_modules would be snapshotted, so the shadow excludes these names outright.
  writeFileSync(join(dir, 'info', 'exclude'), ignored.replace(/\/$/gm, ''));
}

export function folderRefusal(folder, name) {
  if (!existsSync(folder)) return `The folder ${name} (${folder}) no longer exists.`;
  if (existsSync(join(folder, '.git'))) return `${name} (${folder}) is now a Git repository. Remove it from Repositories and add it again as a repository.`;
  return null;
}

export function shadowOf(run, workspace = run.workspace) {
  if (workspace === run.workspace) return run.shadow ?? null;
  return (run.linked ?? []).find(member => member.workspace === workspace)?.shadow ?? null;
}

export function workspaceGit(run, workspace = run.workspace) {
  const shadow = shadowOf(run, workspace);
  return (args, options = {}) => git(workspace, args, shadow ? { gitDir: shadow, ...options } : options);
}

export const inPlaceFolders = (project, members) => [project, ...members].filter(isPlain).map(item => item.repositoryPath);
