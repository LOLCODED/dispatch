import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { dispatchIdentityConfig } from './commit-identity.mjs';
import { InputError } from './engine.mjs';
import { localPath } from './folders.mjs';
import { git } from './local-tools.mjs';

export const ignored = 'node_modules/\ndist/\n.env\ntest-results/\nplaywright-report/\n';
const insideVisible = (root, path) => { const rel = relative(root, path); return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep) && !rel.split(sep).some(part => part.startsWith('.')); };

export async function insideRepository(directory) {
  try { await git(directory, ['rev-parse', '--show-toplevel']); return true; } catch { return false; }
}

export function newRepositoryTarget(value, root) {
  const path = localPath(value), parent = dirname(path);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) throw new InputError('The parent folder must exist before dispatch creates a repository in it.');
  const target = join(realpathSync(parent), basename(path));
  if (!insideVisible(realpathSync(root), target)) throw new InputError('Create new repositories inside your home folder, outside hidden folders.');
  if (existsSync(target) && (!statSync(target).isDirectory() || readdirSync(target).length)) throw new InputError('Choose a new or empty folder for a new repository.');
  return target;
}

export async function createRepository(value, { root = homedir() } = {}) {
  const target = newRepositoryTarget(value, root);
  if (await insideRepository(dirname(target))) throw new InputError('That folder is inside an existing Git repository. Choose a folder outside it.');
  const created = !existsSync(target);
  mkdirSync(target, { recursive: true });
  try {
    await git(target, ['init', '-b', 'main']);
    writeFileSync(join(target, '.gitignore'), ignored, { flag: 'wx' });
    await git(target, ['add', '.gitignore']);
    await git(target, [...dispatchIdentityConfig, 'commit', '-m', 'Initial commit']);
  } catch (error) {
    if (created) rmSync(target, { recursive: true, force: true });
    throw new InputError(`Could not initialise the repository: ${error.message.slice(0, 500)}`);
  }
  return target;
}

export async function createFolder(value, { root = homedir() } = {}) {
  const target = newRepositoryTarget(value, root);
  if (await insideRepository(dirname(target))) throw new InputError('That folder is inside an existing Git repository. Choose a folder outside it.');
  mkdirSync(target, { recursive: true });
  return target;
}
