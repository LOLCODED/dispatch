import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { localEnvironment } from './local-tools.mjs';

// Short-lived read-only app-server connection. Never starts a thread, logs in, or runs a model.
export function readAppServer({ spawnProcess = spawn, timeoutMs = 15000, fallback, onReady, onResponse }) {
  return new Promise(resolve => {
    let buffer = '', settled = false, timer, killer, bytes = 0;
    const decoder = new StringDecoder('utf8');
    const child = spawnProcess('codex', ['app-server', '--listen', 'stdio://'], { cwd: process.env.TMPDIR || '/tmp', env: localEnvironment(), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const stop = signal => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already stopped. */ } };
    const finish = value => {
      if (settled) return; settled = true; clearTimeout(timer); child.stdin.end(); stop('SIGTERM');
      killer = setTimeout(() => stop('SIGKILL'), 1000); killer.unref(); resolve(value);
    };
    const unavailable = () => finish(fallback);
    const send = value => { if (!settled) child.stdin.write(JSON.stringify(value) + '\n'); };
    child.stdin.on('error', unavailable); child.stderr.on('data', () => {});
    child.on('error', unavailable); child.once('close', () => { clearTimeout(killer); if (settled) stop('SIGKILL'); unavailable(); });
    child.stdout.on('data', chunk => {
      bytes += chunk.length; if (bytes > 1000000) { unavailable(); return; }
      buffer += decoder.write(chunk);
      let newline;
      while (!settled && (newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let response; try { response = JSON.parse(line); } catch { unavailable(); return; }
        if (response.id !== 1) { onResponse(response, { send, finish, unavailable }); continue; }
        if (response.error) { unavailable(); return; }
        send({ method: 'initialized' }); onReady(send);
      }
    });
    timer = setTimeout(unavailable, timeoutMs);
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'dispatch', title: 'dispatch', version: '1.1.0' }, capabilities: {} } });
  });
}
