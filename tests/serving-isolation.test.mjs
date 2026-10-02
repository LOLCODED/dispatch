import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { Engine } from '../src/engine.mjs';
import { LiveService } from '../src/live.mjs';
import { createServer } from '../src/server.mjs';
import { git } from '../src/local-tools.mjs';
import { terminal } from '../src/catalog.mjs';
import { settle } from './live-double.mjs';

test('a failed run on the serving checkout preserves the served app, assets, checkout and saved task linkage', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dispatch-serving-')), repo = join(directory, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true }); mkdirSync(join(repo, 'dist', 'client', 'assets'), { recursive: true });
  const source = 'export const version = 1;\n', html = '<html>Serving version one</html>', script = 'console.log("one")';
  writeFileSync(join(repo, 'src', 'server.mjs'), source);
  writeFileSync(join(repo, '.gitignore'), 'dist/\n');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { check: 'node --check src/server.mjs', test: 'node --check src/server.mjs', 'test:e2e': 'node --check src/server.mjs' } }));
  writeFileSync(join(repo, 'dist', 'client', 'index.html'), html); writeFileSync(join(repo, 'dist', 'client', 'assets', 'app-one.js'), script);
  await git(repo, ['init', '-b', 'main']); await git(repo, ['add', '.']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
  const engine = new Engine({ dataDir: join(directory, 'state') });
  let turns = 0;
  const live = new LiveService(engine, { adapter: {
    capabilities: async () => ({ available: true, authenticated: true }),
    run: async options => { turns++; assert.notEqual(options.workspace, repo); options.onSession('owner'); writeFileSync(join(options.workspace, 'src', 'server.mjs'), 'invalid JavaScript {'); return { outcome: 'completed', sessionId: 'owner' }; },
  } });
  const project = await live.saveProject({ repositoryPath: repo, confirmed: true, baseBranch: 'main', validation: ['check', 'test', 'test:e2e'].map(id => ({ id, command: 'npm', args: ['run', id] })) });
  const server = createServer(engine, { assetRoot: repo }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await engine.shutdown(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  const post = async (path, body) => { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(response.status, 201); return response.json(); };
  const task = await post('/api/tasks', { projectId: project.id, input: 'Break the server' }); assert.equal(turns, 0);
  const [run, duplicate] = await Promise.all([post(`/api/tasks/${task.id}/start`, {}), post(`/api/tasks/${task.id}/start`, {})]); assert.equal(run.id, duplicate.id);
  for (let i = 0; i < 1000 && (!terminal.has(engine.get(run.id).status) || engine.active.has(run.id)); i++) {
    assert.equal(await (await fetch(base)).text(), html); await sleep(10);
  }
  assert.equal(engine.get(run.id).status, 'failed'); assert.equal(engine.get(run.id).handoff, null); assert.equal(turns, 2);
  assert.equal(readFileSync(join(repo, 'src', 'server.mjs'), 'utf8'), source);
  assert.equal(await git(repo, ['branch', '--show-current']), 'main');
  // Even an external rebuild of the serving checkout cannot replace this process's UI.
  writeFileSync(join(repo, 'dist', 'client', 'index.html'), '<html>New build</html>');
  rmSync(join(repo, 'dist', 'client', 'assets', 'app-one.js'));
  assert.equal(await (await fetch(base)).text(), html);
  assert.equal(await (await fetch(base + '/assets/app-one.js')).text(), script);
  assert.equal((await (await fetch(base + '/api/tasks')).json())[0].runId, run.id);
  assert.equal((await post(`/api/tasks/${task.id}/start`, {})).id, run.id); assert.equal(turns, 2);
  assert.equal((await fetch(base + '/api/workspace')).status, 200);
});
