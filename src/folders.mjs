import { readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { InputError } from './engine.mjs';

export function localPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0')) throw new InputError('Enter a local folder path.');
  const path = value.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (path.startsWith('~') && path !== '~' && !path.startsWith('~/')) throw new InputError('Use ~/ for your home folder.');
  return resolve(path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);
}

export async function listFolders(value = '~') {
  const path = localPath(value);
  try {
    const current = await realpath(path);
    const entries = await readdir(current, { withFileTypes: true });
    const folders = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
    return { path: current, parent: dirname(current), home: homedir(), cwd: process.cwd(), folders: folders.slice(0, 500).map(entry => ({ name: entry.name, path: join(current, entry.name) })), truncated: folders.length > 500 };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new InputError(`This folder does not exist: ${path}`);
    throw new InputError(`Cannot read this folder (${error.code ?? 'unknown error'}). Check the path and local permissions.`);
  }
}
