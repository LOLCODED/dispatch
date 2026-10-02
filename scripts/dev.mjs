import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { watch } from 'node:fs';
import { build } from 'vite';
import { seedDevData } from './dev-seed.mjs';

const env = { ...process.env, PORT: process.env.PORT ?? '4327', DISPATCH_DATA_DIR: process.env.DISPATCH_DATA_DIR ?? '.dispatch-dev', DISPATCH_DEV_FRAMING: '1' };
if (env.DISPATCH_DEV_SEED !== '0' && await seedDevData(env.DISPATCH_DATA_DIR)) console.log(`Seeded demo runs in ${env.DISPATCH_DATA_DIR}`);

let server = null, restarting = Promise.resolve(), pendingRestart = null;

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  await exited;
}

// The server pins UI bytes at startup (src/app-assets.mjs), so each finished rebuild needs a fresh server process.
// node --watch is not used: after its child exits cleanly on SIGTERM it waits for file changes instead of exiting, which stalls every restart.
function restartServer() {
  restarting = restarting.then(async () => {
    await stopServer();
    server = spawn(process.execPath, ['src/server.mjs'], { stdio: 'inherit', env });
  });
}
const restartSoon = () => { clearTimeout(pendingRestart); pendingRestart = setTimeout(restartServer, 100); };
const sources = watch('src', { recursive: true }, restartSoon);

const watcher = await build({ mode: 'preview', build: { watch: {} } });
watcher.on('event', event => {
  if (event.code === 'END') restartServer();
  if (event.code === 'ERROR') console.error(event.error);
  event.result?.close();
});

const shutdown = async () => { sources.close(); clearTimeout(pendingRestart); await watcher.close(); await restarting; await stopServer(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
