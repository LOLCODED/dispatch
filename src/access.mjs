import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { InputError } from './engine.mjs';

export const accessModes = ['home', 'full'];

export const accessMode = state => state.accessMode === 'full' ? 'full' : 'home';

export function setAccessMode(store, mode) {
  if (!accessModes.includes(mode)) throw new InputError('Choose home or full access.');
  store.state.accessMode = mode; store.save();
  return mode;
}

export const sandboxAccess = mode => mode === 'full' ? { fullAccess: true, writableRoots: [] } : { fullAccess: false, writableRoots: [realpathSync(homedir())] };
