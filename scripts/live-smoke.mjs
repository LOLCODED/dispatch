// Explicit opt-in: this command invokes your signed-in Codex CLI on disposable repositories.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { runInsights } from '../src/analytics.mjs';
import { Engine } from '../src/engine.mjs';
import { LiveService } from '../src/live.mjs';
import { git } from '../src/local-tools.mjs';
import { terminal } from '../src/catalog.mjs';
const directory = mkdtempSync(join(tmpdir(), 'dispatch-live-smoke-'));
console.log(`Live Codex verification; retained workspaces: ${directory}`);
const measurements = [];
const engine = new Engine({ dataDir: join(directory, 'data') }), live = new LiveService(engine);
process.on('SIGTERM', async () => { await engine.shutdown(); process.exitCode = 1; });
process.on('SIGINT', async () => { await engine.shutdown(); process.exitCode = 1; });
async function wait(run) {
  let count = 0;
  while (!terminal.has(run.status) || engine.active.has(run.id)) {
    for (const event of run.events.slice(count)) console.log(`${run.ticketId} ${event.kind}: ${event.message.slice(0, 160)}`);
    count = run.events.length; await sleep(500);
  }
  console.log(`${run.ticketId}: ${run.status} ${run.headSha ?? ''}`);
  measurements.push({ id: run.id, status: run.status, reviews: run.reviews, ...runInsights(run) });
  writeFileSync(join(directory, 'measurements.json'), JSON.stringify(measurements, null, 2));
  if (run.status !== 'ready') throw new Error(JSON.stringify(run.events.slice(-4)));
}
try {
  const cases = [
    ['trim', 'Return a trimmed name from normalizeName(value), including removing spaces at both ends.', 'export const normalizeName = value => value;', 'assert.equal(m.normalizeName("  Ada  "), "Ada");'],
    ['clamp', 'Clamp negative numbers to zero in nonnegative(value), keeping positive numbers unchanged.', 'export const nonnegative = value => value;', 'assert.equal(m.nonnegative(-3), 0); assert.equal(m.nonnegative(4), 4);'],
    ['greet', 'Make greeting(name) return Hello, NAME! with that punctuation.', 'export const greeting = name => name;', 'assert.equal(m.greeting("Ada"), "Hello, Ada!");']
  ];
  for (const [name, task, initial, assertion] of cases) {
    const repo = join(directory, name); mkdirSync(repo);
    writeFileSync(join(repo, 'index.mjs'), initial + '\n');
    writeFileSync(join(repo, 'acceptance.mjs'), `import assert from 'node:assert/strict'; import * as m from './index.mjs'; ${assertion}\n`);
    writeFileSync(join(repo, 'AGENTS.md'), 'This is a disposable dispatch verification repository. Make the requested change only. Do not modify acceptance.mjs. No dependencies or network needed.\n');
    await git(repo, ['init', '-b', 'main']); await git(repo, ['add', '.']); await git(repo, ['-c', 'user.name=dispatch test', '-c', 'user.email=dispatch@localhost', 'commit', '-m', 'Smoke fixture']);
    const project = await live.saveProject({ name, repositoryPath: repo, baseBranch: 'main', confirmed: true, review: name === 'trim', validation: [{ id: 'acceptance', command: process.execPath, args: ['acceptance.mjs'] }] });
    const run = await live.create({ projectId: project.id, input: task }); await wait(run);
    if (name === 'trim') { const followup = await live.followup(run.id, { input: 'Add a brief README.md explaining normalizeName. Leave the implementation and acceptance test unchanged.' }); await wait(followup); }
  }
  console.log('PASS: three live Codex tasks plus explicit-session follow-up and independent review. No remote writes.');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await engine.shutdown(); }
