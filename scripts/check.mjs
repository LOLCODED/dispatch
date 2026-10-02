import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
let count = 0;
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'web', '.git', '.dispatch', 'test-results', 'playwright-report'].includes(entry.name) || entry.name.startsWith('.dispatch-')) continue;
    const file = join(path, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(mjs|cjs|js)$/.test(file)) { const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }); if (result.status !== 0) process.exit(1); count++; }
  }
}
walk('.'); console.log(`Syntax checked ${count} JavaScript files.`);
