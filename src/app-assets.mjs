import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));

// Pin UI bytes to this server process. Rebuilding a checkout cannot replace
// its HTML underneath an open browser or remove the JS that HTML references.
export function snapshotAppAssets(root) {
  const files = new Map(), client = join(root, 'dist', 'client');
  if (existsSync(join(client, 'index.html'))) files.set('index.html', readFileSync(join(client, 'index.html')));
  const assets = join(client, 'assets');
  if (existsSync(assets)) for (const file of readdirSync(assets, { withFileTypes: true })) {
    if (file.isFile() && /^[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(file.name)) files.set(`/assets/${file.name}`, readFileSync(join(assets, file.name)));
  }
  return files;
}
