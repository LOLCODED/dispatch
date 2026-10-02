import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../src/process.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
test('captures actual exit code and both output streams', async () => {
  const result = await runProcess(process.execPath, ['-e', 'console.log("out");console.error("err");process.exitCode=7']);
  assert.equal(result.exitCode, 7); assert.match(result.output, /out/); assert.match(result.output, /err/);
});
test('arguments are passed literally without shell expansion', async () => {
  const literal = '$(echo unsafe); `whoami`';
  const result = await runProcess(process.execPath, ['-e', 'console.log(process.argv[1])', literal]); assert.equal(result.output.trim(), literal);
});
test('timeout terminates a long-running command', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 50 });
  assert.equal(result.timedOut, true); assert.ok(result.durationMs < 5000);
});
test('abort before start avoids spawning', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await runProcess('this-command-does-not-exist', [], { signal: controller.signal }); assert.equal(result.cancelled, true);
});
test('output is bounded', async () => {
  const result = await runProcess(process.execPath, ['-e', 'console.log("x".repeat(10000))'], { maxOutput: 100 }); assert.equal(result.output.length, 100);
});
test('missing executable produces actionable failure', async () => {
  const result = await runProcess('/does/not/exist', []); assert.notEqual(result.exitCode, 0); assert.match(result.output, /ENOENT/);
});
test('explicit live environment does not inherit unrelated credentials and stdin stays literal', async () => {
  process.env.DISPATCH_TEST_SECRET = 'must-not-inherit';
  try {
    const chunks = [];
    const result = await runProcess(process.execPath, ['-e', 'let s=""; process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(JSON.stringify({text:s,secret:process.env.DISPATCH_TEST_SECRET})))'], { inheritEnv: false, input: '$(not a command)', onStdout: chunk => chunks.push(chunk.toString()) });
    assert.equal(result.exitCode, 0); assert.deepEqual(JSON.parse(chunks.join('')), { text: '$(not a command)' });
  } finally { delete process.env.DISPATCH_TEST_SECRET; }
});

test('cancellation kills an owned descendant even when its parent exits and it ignores SIGTERM', { skip: process.platform === 'win32' }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dispatch-stop-group-')), ready = join(directory, 'ready');
  const controller = new AbortController(); let descendant;
  t.after(() => { if (descendant) { try { process.kill(descendant, 'SIGKILL'); } catch {} } rmSync(directory, { recursive: true, force: true }); });
  const childScript = 'process.on("SIGTERM",()=>{}); require("fs").writeFileSync(process.argv[1], "ready"); setInterval(()=>{},1000)';
  const parentScript = `const {spawn}=require('child_process'); const fs=require('fs'); const child=spawn(process.execPath,['-e',${JSON.stringify(childScript)},process.argv[1]],{stdio:'ignore'}); process.on('SIGTERM',()=>process.exit(0)); const timer=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(timer);console.log(child.pid)}},10);setInterval(()=>{},1000);`;
  const result = await runProcess(process.execPath, ['-e', parentScript, ready], { signal: controller.signal, timeoutMs: 5000, onStdout: chunk => { descendant = Number(chunk.toString().trim()); if (descendant > 0) controller.abort(); } });
  assert.equal(result.cancelled, true); assert.ok(descendant > 0);
  // A killed process can briefly remain a zombie until init reaps it.
  let running = true;
  for (let i = 0; i < 100; i++) {
    try { const { readFileSync } = await import('node:fs'); const stat = readFileSync(`/proc/${descendant}/stat`, 'utf8'); if (stat.split(') ')[1]?.startsWith('Z')) { running = false; break; } process.kill(descendant, 0); }
    catch (error) { if (error.code === 'ESRCH' || error.code === 'ENOENT') { running = false; break; } if (process.platform !== 'linux') { try { process.kill(descendant, 0); } catch { running = false; break; } } }
    await sleep(10);
  }
  assert.equal(running, false, 'Descendant must not keep executing after cancellation.');
});

test('cancellation also kills a descendant that moved into its own process group', { skip: process.platform !== 'linux' }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dispatch-stop-detached-')), ready = join(directory, 'ready');
  const controller = new AbortController(); let descendant;
  t.after(() => { if (descendant) { try { process.kill(descendant, 'SIGKILL'); } catch {} } rmSync(directory, { recursive: true, force: true }); });
  const childScript = 'require("fs").writeFileSync(process.argv[1], "ready"); setInterval(()=>{},1000)';
  const parentScript = `const {spawn}=require('child_process'); const fs=require('fs'); const child=spawn(process.execPath,['-e',${JSON.stringify(childScript)},process.argv[1]],{stdio:'ignore',detached:true}); child.unref(); process.on('SIGTERM',()=>process.exit(0)); const timer=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(timer);console.log(child.pid)}},10);setInterval(()=>{},1000);`;
  const result = await runProcess(process.execPath, ['-e', parentScript, ready], { signal: controller.signal, timeoutMs: 5000, onStdout: chunk => { descendant = Number(chunk.toString().trim()); if (descendant > 0) controller.abort(); } });
  assert.equal(result.cancelled, true); assert.ok(descendant > 0);
  let running = true;
  for (let i = 0; i < 200 && running; i++) { try { const stat = readFileSync(`/proc/${descendant}/stat`, 'utf8'); if (stat.split(') ')[1]?.startsWith('Z')) running = false; } catch { running = false; } if (running) await sleep(10); }
  assert.equal(running, false, 'A detached descendant must not keep executing after cancellation.');
});
