import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const builtinRoot = dirname(fileURLToPath(import.meta.url));

// Every folder here with a package.json is a connector shipped with dispatch, loaded exactly like one the operator adds.
export async function builtinFolders(root = builtinRoot) {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, 'package.json'))).map(entry => join(root, entry.name)).sort();
}
