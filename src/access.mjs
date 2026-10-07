import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { InputError } from './engine.mjs';

export const accessModes = ['worktrees', 'home', 'full'];

export const accessMode = state => accessModes.includes(state.accessMode) ? state.accessMode : 'home';

export function setAccessMode(store, mode) {
  if (!accessModes.includes(mode)) throw new InputError('Choose worktrees, home or full access.');
  store.state.accessMode = mode; store.save();
  return mode;
}

export const sandboxAccess = mode => mode === 'full' ? { fullAccess: true, writableRoots: [] } : mode === 'worktrees' ? { fullAccess: false, writableRoots: [realpathSync(tmpdir())] } : { fullAccess: false, writableRoots: [realpathSync(homedir())] };

// Worktrees-only access closes the home folder to the sandbox's commands, then reopens the task's worktrees, the Git
// metadata they point at and the Node install that runs their tools, so other checkouts and their history stay unread.
export function worktreeReads(worktrees, repositories, node = process.execPath) {
  const home = realpathSync(homedir()), gitDirs = repositories.map(path => join(path, '.git'));
  return { reads: { denyRead: [home], allowRead: [...new Set([...worktrees, ...gitDirs, dirname(dirname(node)), join(home, '.gitconfig'), join(home, '.config', 'git')])] }, gitDirs };
}
