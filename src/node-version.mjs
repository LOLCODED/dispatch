import { readFileSync } from 'node:fs';

const required = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).engines.node;

export function nodeVersionProblem(current, range = required) {
  const minimum = Number(range.match(/\d+/)[0]);
  if (Number(current.split('.')[0]) >= minimum) return null;
  return `dispatch needs Node.js ${range}, but this is Node.js ${current}. Update Node.js, run npm ci, then start dispatch again.`;
}

const problem = nodeVersionProblem(process.versions.node);
if (problem) { console.error(`dispatch: ${problem}`); process.exit(1); }
