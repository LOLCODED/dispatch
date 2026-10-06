import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { activeStatuses } from '../src/board-state.mjs';
import { migrateData, serviceEnv } from './migrate-data.mjs';
import { latestTag } from '../src/updates.mjs';

export { latestTag };

export const serviceName = 'dispatch';
export const launchdLabel = 'dev.dispatch.server';

export class InstallError extends Error {}

// Data defaults to ~/.dispatch so deleting that one folder resets dispatch; an explicit --dir keeps everything under it.
export function installLayout({ dir, port = 4317 } = {}) {
  const root = resolve(dir ?? join(homedir(), '.local', 'share', 'dispatch'));
  return { root, app: join(root, 'app'), data: dir ? join(root, 'data') : join(homedir(), '.dispatch'), log: join(root, 'server.log'), port: Number(port) };
}

export function servicePath(path) {
  return [...new Set(path.split(':').filter(Boolean))].join(':');
}

const systemdValue = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;

export function systemdUnit({ layout, node, path }) {
  return `[Unit]
Description=dispatch
After=network.target

[Service]
WorkingDirectory=${layout.app}
Environment=${systemdValue(`PORT=${layout.port}`)}
Environment=${systemdValue(`DISPATCH_DATA_DIR=${layout.data}`)}
Environment=${systemdValue(`PATH=${path}`)}
ExecStart=${systemdValue(node)} src/server.mjs
Restart=on-failure
TimeoutStopSec=30

[Install]
WantedBy=default.target
`;
}

const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function launchdPlist({ layout, node, path }) {
  const env = { PORT: layout.port, DISPATCH_DATA_DIR: layout.data, PATH: path };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${launchdLabel}</string>
  <key>ProgramArguments</key><array><string>${xml(node)}</string><string>src/server.mjs</string></array>
  <key>WorkingDirectory</key><string>${xml(layout.app)}</string>
  <key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('')}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xml(layout.log)}</string>
  <key>StandardErrorPath</key><string>${xml(layout.log)}</string>
</dict></plist>
`;
}

export const queueHold = { waitSeconds: 120, installSeconds: 1800, pollMs: 5000 };

export function activeRuns(runs) {
  return runs.filter(run => activeStatuses.has(run.status) && run.status !== 'queued');
}

// Holds the queue so no new run starts, renewing a short lease each poll so a vanished CLI cannot leave it held. False when the server cannot hold its queue.
export async function waitForIdle(queue, { log = console.log, wait = delay, pollMs = queueHold.pollMs } = {}) {
  let first = true, last = '';
  for (;;) {
    const state = await queue.hold(queueHold.waitSeconds);
    if (!state && first) return false;
    if (!state) throw new InstallError('Lost contact with dispatch while waiting. Nothing was updated.');
    if (!state.working.length) return true;
    const line = `Waiting for ${state.working.length} run(s) to finish: ${state.working.join(', ')}. Queued runs stay queued and continue after the restart. Ctrl+C cancels; --force updates now and interrupts them.`;
    if (line !== last) log(line);
    first = false; last = line;
    await wait(pollMs);
  }
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new InstallError(`${command} ${args[0] ?? ''} failed (exit ${result.status ?? result.signal}).`);
}

function output(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new InstallError(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function resolveRef(app, ref) {
  if (ref) return ref;
  const tag = latestTag(output('git', ['tag', '--list', 'v*'], { cwd: app }));
  if (!tag) throw new InstallError('No release tag (vX.Y.Z) in the source checkout. Tag one with `npm version <x.y.z>`, or pass --ref.');
  return tag;
}

function remoteUrl(cwd) {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

// The install clones a local checkout, which goes stale on machines that never pull it; release tags also come from that checkout's own origin.
export function upstreamUrl(app) {
  const source = remoteUrl(app);
  return source && existsSync(source) ? remoteUrl(source) : null;
}

function fetchTags(app) {
  run('git', ['fetch', '--tags', '--force', 'origin'], { cwd: app });
  const upstream = upstreamUrl(app);
  if (!upstream) return;
  console.log(`$ git fetch --tags --force ${upstream}`);
  const result = spawnSync('git', ['fetch', '--tags', '--force', upstream], { cwd: app, stdio: 'inherit' });
  if (result.status !== 0) console.log(`Could not fetch release tags from ${upstream}; using the tags in the source checkout.`);
}

function build(app, revision, exec) {
  exec('git', ['checkout', '--detach', '--force', revision], { cwd: app });
  exec('npm', ['ci', '--no-audit', '--no-fund'], { cwd: app });
  exec('npm', ['run', 'build'], { cwd: app });
}

// The running server keeps its code in memory, so a failed build is undone before anything restarts into it.
export function switchVersion(app, target, previous, exec = run) {
  try { build(app, target, exec); }
  catch (error) {
    if (!previous) throw error;
    console.log(`Building ${target} failed; restoring ${previous.slice(0, 12)}.`);
    try { build(app, previous, exec); }
    catch { throw new InstallError(`Updating to ${target} failed (${error.message}), and restoring ${previous.slice(0, 12)} failed too. Fix the install in ${app} before dispatch restarts.`); }
    throw new InstallError(`Updating to ${target} failed (${error.message}). ${previous.slice(0, 12)} is restored; dispatch keeps running it.`);
  }
}

const currentRevision = app => { const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: app, encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() : null; };

function checkout(layout, ref) {
  const previous = currentRevision(layout.app);
  fetchTags(layout.app);
  const target = resolveRef(layout.app, ref);
  switchVersion(layout.app, target, previous);
  return target;
}

function servicePlatform() {
  if (process.platform === 'linux') return 'systemd';
  if (process.platform === 'darwin') return 'launchd';
  throw new InstallError(`No service support for ${process.platform}; run \`npm start\` in ${installLayout().app} instead.`);
}

function serviceFile() {
  if (servicePlatform() === 'systemd') return join(homedir(), '.config', 'systemd', 'user', `${serviceName}.service`);
  return join(homedir(), 'Library', 'LaunchAgents', `${launchdLabel}.plist`);
}

function writeService(layout, path = process.env.PATH ?? '') {
  const spec = { layout, node: process.execPath, path: servicePath(path) };
  const file = serviceFile();
  mkdirSync(dirname(file), { recursive: true });
  if (servicePlatform() === 'systemd') {
    writeFileSync(file, systemdUnit(spec));
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', '--now', serviceName]);
    return file;
  }
  writeFileSync(file, launchdPlist(spec));
  spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${launchdLabel}`]);
  run('launchctl', ['bootstrap', `gui/${process.getuid()}`, file]);
  return file;
}

function restartService() {
  if (servicePlatform() === 'systemd') run('systemctl', ['--user', 'restart', serviceName]);
  else run('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${launchdLabel}`]);
}

function installedServiceFile() {
  const file = serviceFile();
  if (!existsSync(file)) throw new InstallError('dispatch is not installed as a service. Run `dispatch install` from a dispatch checkout, or `npm start` there.');
  return file;
}

function assertIdle(runs, force, action) {
  const busy = activeRuns(runs);
  if (busy.length && !force) throw new InstallError(`${busy.length} run(s) are working (${busy.map(item => item.title).join(', ')}). Wait for them or pass --force to ${action}; interrupted runs recover as interrupted, queued runs stay queued.`);
}

export function startService() {
  const file = installedServiceFile();
  if (servicePlatform() === 'systemd') { output('systemctl', ['--user', 'start', serviceName]); return; }
  spawnSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, file]);
  output('launchctl', ['kickstart', `gui/${process.getuid()}/${launchdLabel}`]);
}

export async function stopService({ force, runs }) {
  installedServiceFile();
  assertIdle(await runs(), force, 'stop anyway');
  if (servicePlatform() === 'systemd') output('systemctl', ['--user', 'stop', serviceName]);
  else spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${launchdLabel}`]);
}

export function pathHint(link, path) {
  const folder = dirname(link);
  if (path.split(':').includes(folder)) return '';
  return `\n${folder} is not on your PATH, so \`dispatch\` will not be found yet. Add it to your shell profile, then open a new terminal:\n  export PATH="${folder}:$PATH"`;
}

function linkCommand(layout) {
  const link = join(homedir(), '.local', 'bin', 'dispatch');
  mkdirSync(dirname(link), { recursive: true });
  rmSync(link, { force: true });
  symlinkSync(join(layout.app, 'bin', 'dispatch.mjs'), link);
  return link;
}

export function install({ dir, port, ref, source = fileURLToPath(new URL('..', import.meta.url)) }) {
  const layout = installLayout({ dir, port });
  if (existsSync(layout.app)) throw new InstallError(`${layout.app} already exists. Use \`dispatch update\`.`);
  mkdirSync(layout.data, { recursive: true });
  run('git', ['clone', '--no-checkout', source, layout.app]);
  const version = checkout(layout, ref);
  const service = writeService(layout), link = linkCommand(layout);
  console.log(`\nInstalled ${version} in ${layout.app}\nData: ${layout.data}\nService: ${service}\nCommand: ${link}\nOpen http://127.0.0.1:${layout.port}${pathHint(link, process.env.PATH ?? '')}`);
}

export async function update({ dir, port, ref, force, runs, queue }) {
  const layout = installLayout({ dir, port });
  if (!existsSync(layout.app)) throw new InstallError(`No install at ${layout.app}. Run \`dispatch install\` from a dispatch checkout.`);
  const held = !force && await waitForIdle(queue);
  if (held) await queue.hold(queueHold.installSeconds);
  else assertIdle(await runs(), force, 'update anyway');
  let version;
  try { version = checkout(layout, ref); }
  catch (error) { if (held) await queue.release(); throw error; }
  const moved = dir ? null : moveData(layout);
  if (!moved) restartService();
  console.log(`\nUpdated to ${version}. dispatch restarted on http://127.0.0.1:${moved?.port ?? layout.port}`);
}

function haltService() {
  if (servicePlatform() === 'systemd') output('systemctl', ['--user', 'stop', serviceName]);
  else spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${launchdLabel}`]);
}

// An install made before data moved to ~/.dispatch is moved there once, while the update has the queue idle; the service keeps its port and PATH.
function moveData(layout) {
  const env = serviceEnv(readFileSync(installedServiceFile(), 'utf8')), from = env.DISPATCH_DATA_DIR;
  if (!from || resolve(from) === layout.data || !existsSync(from)) return null;
  if (existsSync(layout.data)) { console.log(`${layout.data} already exists, so data stays in ${from}. Move or remove one of them, then update again to switch.`); return null; }
  const target = { ...layout, port: Number(env.PORT ?? layout.port) };
  haltService();
  let result;
  try { result = migrateData(resolve(from), layout.data); }
  catch (error) { startService(); throw new InstallError(`Data was not moved: ${error.message}`); }
  writeService(target, env.PATH ?? process.env.PATH ?? '');
  console.log(`Moved data from ${from} to ${layout.data}.`);
  for (const line of result.failed) console.log(`Could not re-link worktree ${line}`);
  return target;
}
