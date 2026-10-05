import { copyFileSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { InputError } from './engine.mjs';
import { git } from './local-tools.mjs';

const maxFiles = 20;

export function localFileSettings(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxFiles) throw new InputError(`Choose at most ${maxFiles} local files to copy.`);
  const paths = value.map(path => typeof path === 'string' ? normalize(path.trim()) : path);
  if (paths.some(path => typeof path !== 'string' || !path || path === '.' || isAbsolute(path) || path.split(sep).some(part => part === '..' || part === '.git'))) throw new InputError('Local files must be paths inside the repository, such as .env.test.');
  return [...new Set(paths)];
}

const ignored = (workspace, path, signal) => git(workspace, ['check-ignore', '-q', '--', path], { signal }).then(() => true, () => false);

// Untracked files such as .env.test never reach a fresh worktree. Only regular files Git ignores are copied, so they can never be committed.
export async function copyLocalFiles(source, workspace, files = [], signal) {
  const copied = [], skipped = [];
  for (const path of files) {
    let stat; try { stat = lstatSync(join(source, path)); } catch { skipped.push(`${path} (not in your checkout)`); continue; }
    if (!stat.isFile()) { skipped.push(`${path} (not a regular file)`); continue; }
    if (!await ignored(workspace, path, signal)) { skipped.push(`${path} (Git does not ignore it, so it would be committed)`); continue; }
    mkdirSync(dirname(join(workspace, path)), { recursive: true });
    copyFileSync(join(source, path), join(workspace, path));
    copied.push(path);
  }
  return { copied, skipped };
}
