import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Engine } from '../src/engine.mjs';
import { LiveService } from '../src/live.mjs';
import { git } from '../src/local-tools.mjs';
import { terminal } from '../src/catalog.mjs';

export const models = [
  { model: 'test-sol', displayName: 'Test Sol', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] },
];
export const completes = options => { writeFileSync(join(options.workspace, 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Updated' }; };
export const completesWithFiles = options => { writeFileSync(join(options.workspace, 'value.txt'), 'changed'); writeFileSync(join(options.workspace, 'new.txt'), 'new'); return { outcome: 'completed', sessionId: 'session-1', summary: 'Updated', usage: { input_tokens: 4, cached_input_tokens: 2, output_tokens: 3 } }; };
export const waitsForAbort = async options => { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return { outcome: 'cancelled' }; };
export function gated() {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const behavior = async options => {
    const aborted = new Promise(resolve => options.signal.addEventListener('abort', () => resolve('aborted'), { once: true }));
    if (options.signal.aborted || await Promise.race([gate, aborted]) === 'aborted') return { outcome: 'cancelled' };
    return completes(options);
  };
  return { release, behavior };
}
export function workerDouble(behavior) {
  const calls = [];
  return {
    calls,
    capabilities: async () => ({ available: true, authenticated: true, version: 'test-double' }),
    models: async () => ({ available: true, message: 'Test model catalog', models }),
    run: async options => { calls.push(options); options.onSession?.('session-1'); return behavior(options, calls.length); },
  };
}
export const unitCheck = { id: 'unit', command: process.execPath, args: ['-e', 'if(require("fs").readFileSync("value.txt","utf8")!=="changed")process.exit(1)'] };
export async function temporaryRepository(prefix = 'dispatch-live-double-') {
  const dir = mkdtempSync(join(tmpdir(), prefix)), repo = join(dir, 'repo'); mkdirSync(repo);
  writeFileSync(join(repo, 'value.txt'), 'original');
  await git(repo, ['init', '-b', 'main']); await git(repo, ['add', '.']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
  return { dir, repo };
}
export async function temporaryFolder(prefix = 'dispatch-folder-double-') {
  const dir = mkdtempSync(join(tmpdir(), prefix)), repo = join(dir, 'folder'); mkdirSync(repo);
  writeFileSync(join(repo, 'value.txt'), 'original');
  return { dir, repo };
}
export async function liveFixture(t, { behavior = completes, adapter = workerDouble(behavior), services = {}, project: projectInput = {}, folder = false, ...engineOptions } = {}) {
  const { dir, repo } = await (folder ? temporaryFolder() : temporaryRepository());
  const engine = new Engine({ dataDir: join(dir, 'data'), ...engineOptions });
  const live = new LiveService(engine, { adapter, ...services });
  const project = await live.saveProject({ repositoryPath: repo, baseBranch: folder ? null : 'main', confirmed: true, validation: [unitCheck], ...projectInput });
  t.after(async () => { await engine.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, repo, engine, live, project, adapter, turns: () => adapter.calls?.length ?? 0 };
}
export async function settle(engine, run) { for (let i = 0; i < 1000; i++) { if (terminal.has(run.status) && !engine.active.has(run.id)) return run; await sleep(10); } throw new Error(`Run stuck: ${run.status}`); }
export async function until(condition) { for (let i = 0; i < 1000; i++) { if (condition()) return; await sleep(10); } throw new Error('Condition not met in time.'); }
