import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Engine } from '../src/engine.mjs';
import { LiveService } from '../src/live.mjs';
import { git } from '../src/local-tools.mjs';
import { settle, unitCheck, workerDouble } from '../tests/live-double.mjs';

const serveScript = `import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
createServer((request, response) => {
  response.setHeader('content-type', 'text/html');
  response.end('<!doctype html><title>Demo app</title><h1>Demo app</h1><p>' + readFileSync('value.txt', 'utf8') + '</p><button onclick="this.textContent=\\'Clicked\\'">Count</button>');
}).listen(Number(process.env.PORT) || 0, '127.0.0.1');
setInterval(() => {}, 1000);
`;

const tickets = [
  { input: 'Change the demo value', behavior: ({ workspace }) => {
    writeFileSync(join(workspace, 'value.txt'), 'changed');
    writeFileSync(join(workspace, 'NOTES.md'), '# Notes\n\nThe demo value is now "changed".\n');
    return { outcome: 'completed', summary: 'Changed value.txt and added NOTES.md.', usage: { input_tokens: 1200, cached_input_tokens: 800, output_tokens: 300 } };
  } },
  { input: 'Add a footer note to the demo', behavior: ({ workspace }) => {
    writeFileSync(join(workspace, 'value.txt'), 'changed');
    writeFileSync(join(workspace, 'FOOTER.md'), 'Made with dispatch.\n');
    return { outcome: 'completed', summary: 'Added FOOTER.md.', usage: { input_tokens: 900, cached_input_tokens: 600, output_tokens: 200 } };
  } },
  { input: 'Where is the demo value stored?', behavior: () => ({ outcome: 'completed', summary: 'The value lives in value.txt:1 and serve.mjs reads it on every request.\nDISPATCH_ANSWERED' }) },
  { input: 'Pick a colour for the Count button', behavior: () => ({ outcome: 'blocked', summary: 'DISPATCH_BLOCKED: Which colour should the Count button use?\n1. Blue (Recommended) — matches the heading\n2. Green — stands out more' }) },
  { input: 'Break the value check', behavior: ({ workspace }) => {
    writeFileSync(join(workspace, 'value.txt'), 'broken');
    return { outcome: 'completed', summary: 'Wrote "broken" to value.txt.' };
  } },
];

const hasRuns = dataDir => existsSync(join(dataDir, 'state.json')) && JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).runs?.length > 0;

async function demoRepository(dataDir) {
  const repo = join(dataDir, 'demo-repository');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'value.txt'), 'original');
  writeFileSync(join(repo, 'serve.mjs'), serveScript);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { dev: 'node serve.mjs' } }, null, 2));
  await git(repo, ['init', '-b', 'main']); await git(repo, ['add', '.']);
  await git(repo, ['-c', 'user.name=dispatch', '-c', 'user.email=dispatch@localhost', 'commit', '-m', 'Initial']);
  return repo;
}

export async function seedDevData(directory) {
  const dataDir = resolve(directory);
  if (hasRuns(dataDir)) return false;
  const behaviors = new Map(tickets.map(ticket => [ticket.input, ticket.behavior]));
  const adapter = workerDouble(options => behaviors.get([...behaviors.keys()].find(input => options.prompt.includes(input)))?.(options) ?? { outcome: 'completed' });
  const engine = new Engine({ dataDir });
  const live = new LiveService(engine, { adapter });
  try {
    const project = await live.saveProject({ name: 'Demo repository', repositoryPath: await demoRepository(dataDir), baseBranch: 'main', confirmed: true, validation: [unitCheck], memory: false });
    for (const { input } of tickets) await settle(engine, await live.create({ projectId: project.id, input }));
  } finally { await engine.shutdown(); }
  return true;
}

