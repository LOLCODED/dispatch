import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const limits = { directories: 2000, files: 300, bytes: 64_000, components: 200 };
const skipped = new Set(['node_modules', 'dist', 'build', 'coverage', 'out']);
const sourceFile = /\.(?:tsx|jsx)$/, excludedFile = /\.(?:test|spec|stories)\.(?:tsx|jsx)$/, componentName = /^[A-Z][A-Za-z0-9]*$/;
const declarations = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Z][A-Za-z0-9]*)/g;
const defaultIdentifier = /export\s+default\s+([A-Z][A-Za-z0-9]*)\s*;?\s*$/gm;
const exportLists = /export\s*\{([^}]*)\}/g;

const walkable = entry => entry.isDirectory() && !skipped.has(entry.name) && !entry.name.startsWith('.');
const entries = directory => { try { return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return []; } };

function componentDirectories(root) {
  const found = [], queue = [root];
  for (let visited = 0; queue.length && visited < limits.directories; visited++) {
    const directory = queue.shift();
    for (const entry of entries(directory).filter(walkable)) {
      const path = join(directory, entry.name);
      if (entry.name === 'components') found.push(path); else queue.push(path);
    }
  }
  return found;
}

function sourceFiles(directory) {
  const files = [], queue = [directory];
  while (queue.length && files.length < limits.files) {
    const current = queue.shift();
    for (const entry of entries(current)) {
      if (walkable(entry)) queue.push(join(current, entry.name));
      else if (entry.isFile() && sourceFile.test(entry.name) && !excludedFile.test(entry.name)) files.push(join(current, entry.name));
    }
  }
  return files.slice(0, limits.files);
}

function exportedNames(source) {
  const names = new Set();
  for (const pattern of [declarations, defaultIdentifier]) for (const match of source.matchAll(pattern)) names.add(match[1]);
  for (const match of source.matchAll(exportLists)) for (const part of match[1].split(',')) { const name = part.trim().split(/\s+as\s+/).at(-1).trim(); if (componentName.test(name)) names.add(name); }
  return [...names];
}

// The palette for visual edits: exported PascalCase names from .tsx/.jsx files under any components folder, found by scanning, never by a model.
export function listComponents(root) {
  if (typeof root !== 'string' || !root || !existsSync(root)) return [];
  const components = [];
  for (const directory of componentDirectories(root)) for (const file of sourceFiles(directory)) {
    if (components.length >= limits.components) break;
    let source; try { source = readFileSync(file, 'utf8').slice(0, limits.bytes); } catch { continue; }
    const path = relative(root, file).split(sep).join('/');
    for (const name of exportedNames(source)) components.push({ name, path });
  }
  return components.slice(0, limits.components).sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}
