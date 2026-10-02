import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from '../src/dev-server.mjs';

const serveScript = "import { createServer } from 'node:http'; createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<title>Dev fixture</title>'); }).listen(Number(process.env.PORT), '127.0.0.1'); setInterval(() => {}, 1000);";
function workspace(t, scripts) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-dev-server-'));
  if (scripts) writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));
  writeFileSync(join(dir, 'serve.mjs'), serveScript);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('startApp runs the dev script on a free port, answers, and stops its process group', async t => {
  const dir = workspace(t, { dev: `${process.execPath} serve.mjs` });
  let pid;
  const server = await startApp({ workspace: dir, onSpawn: value => { pid = value; }, readyTimeoutMs: 15000 });
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/); assert.equal(server.command, 'npm run dev');
  assert.equal((await fetch(server.url)).status, 200);
  await server.stop();
  assert.equal(alive(pid), false);
});

test('startApp refuses when there is no dev script and reports an early exit', async t => {
  await assert.rejects(startApp({ workspace: workspace(t, { test: 'node -e 0' }) }), /No dev script/);
  await assert.rejects(startApp({ workspace: workspace(t, { dev: `${process.execPath} -e "process.exit(3)"` }), readyTimeoutMs: 5000 }), /exited \(code 3\)/);
});
