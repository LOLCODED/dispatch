import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { activeRuns, installLayout, latestTag, launchdPlist, servicePath, switchVersion, systemdUnit, upstreamUrl, waitForIdle } from '../bin/install.mjs';

const layout = installLayout({ dir: '/home/me/.local/share/dispatch', port: 4317 });
const spec = { layout, node: '/usr/bin/node', path: '/home/me/.local/bin:/usr/bin' };

test('the newest vX.Y.Z tag wins numerically and other tags are ignored', () => {
  assert.equal(latestTag('v1.9.0\nv1.10.0\nv1.2.3\nnightly\nv2.0.0-rc1\n'), 'v1.10.0');
  assert.equal(latestTag('\n'), null);
});

test('the service keeps the user PATH once so agent CLIs resolve, and uses its own data directory', () => {
  assert.equal(servicePath('/a:/b:/a::/c'), '/a:/b:/c');
  const unit = systemdUnit(spec);
  assert.match(unit, /WorkingDirectory=\/home\/me\/.local\/share\/dispatch\/app/);
  assert.match(unit, /Environment="DISPATCH_DATA_DIR=\/home\/me\/.local\/share\/dispatch\/data"/);
  assert.match(unit, /Environment="PORT=4317"/);
  assert.match(unit, /ExecStart="\/usr\/bin\/node" src\/server.mjs/);
  assert.match(unit, /Environment="DISPATCH_SERVICE=dispatch"/);
  assert.match(systemdUnit({ ...spec, layout: installLayout({ dir: '/tmp/x', service: 'dispatch-test' }) }), /DISPATCH_SERVICE=dispatch-test/);
  assert.throws(() => installLayout({ service: '../evil' }), /service name/);
  assert.match(systemdUnit({ ...spec, path: '/odd%dir' }), /PATH=\/odd%%dir/);
  const plist = launchdPlist({ ...spec, path: '/a&b' });
  assert.match(plist, /<key>DISPATCH_DATA_DIR<\/key><string>\/home\/me\/.local\/share\/dispatch\/data<\/string>/);
  assert.match(plist, /\/a&amp;b/);
});

test('an update waits only for runs that are working, not queued, finished or interrupted ones', () => {
  const runs = [{ status: 'implementing' }, { status: 'validating' }, { status: 'queued' }, { status: 'ready' }, { status: 'blocked' }, { status: 'interrupted' }];
  assert.deepEqual(activeRuns(runs).map(run => run.status), ['implementing', 'validating']);
});

test('waiting for idle renews the queue hold each poll until no run is working', async () => {
  const states = [{ working: ['Big task'] }, { working: ['Big task'] }, { working: [] }], holds = [], lines = [];
  const queue = { hold: async seconds => { holds.push(seconds); return states.shift(); } };
  assert.equal(await waitForIdle(queue, { log: line => lines.push(line), wait: async () => {} }), true);
  assert.deepEqual(holds, [120, 120, 120]);
  assert.equal(lines.length, 1); assert.match(lines[0], /1 run\(s\) to finish: Big task/);
});

test('waiting for idle reports a server that cannot hold its queue, and fails if contact is lost mid-wait', async () => {
  assert.equal(await waitForIdle({ hold: async () => null }), false);
  const states = [{ working: ['Big task'] }, null];
  await assert.rejects(waitForIdle({ hold: async () => states.shift() }, { log: () => {}, wait: async () => {} }), /Lost contact/);
});

test('an install cloned from a local checkout finds that checkout\'s own origin for release tags', t => {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-upstream-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const [release, source, app] = ['release', 'source', 'app'].map(name => join(root, name));
  git(root, 'init', '-q', release);
  git(release, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git(root, 'clone', '-q', release, source);
  git(root, 'clone', '-q', '--no-checkout', source, app);
  assert.equal(upstreamUrl(app), release);
  assert.equal(upstreamUrl(source), null);
  git(app, 'remote', 'set-url', 'origin', 'git@github.com:me/dispatch.git');
  assert.equal(upstreamUrl(app), null);
});

test('a failed build restores the previous version before anything restarts, and says so', t => {
  t.mock.method(console, 'log', () => {});
  const recorder = failing => { const calls = []; return { calls, exec: (command, args) => { calls.push(`${command} ${args.join(' ')}`); if (failing(calls)) throw new Error('npm run failed (exit 1).'); } }; };
  const target = recorder(calls => calls.at(-1) === 'npm run build' && calls.includes('git checkout --detach --force v1.3.0') && !calls.includes('git checkout --detach --force aaaaaaaaaaaaaaaa'));
  assert.throws(() => switchVersion('/app', 'v1.3.0', 'aaaaaaaaaaaaaaaa', target.exec), /Updating to v1\.3\.0 failed \(npm run failed \(exit 1\)\.\)\. aaaaaaaaaaaa is restored; dispatch keeps running it\./);
  assert.deepEqual(target.calls.slice(3), ['git checkout --detach --force aaaaaaaaaaaaaaaa', 'npm ci --no-audit --no-fund', 'npm run build']);
  const both = recorder(calls => calls.at(-1) === 'npm run build');
  assert.throws(() => switchVersion('/app', 'v1.3.0', 'aaaaaaaaaaaaaaaa', both.exec), /restoring aaaaaaaaaaaa failed too/);
  const first = recorder(calls => calls.at(-1) === 'npm run build');
  assert.throws(() => switchVersion('/app', 'v1.3.0', null, first.exec), /npm run failed/);
  assert.equal(first.calls.length, 3);
  const fine = recorder(() => false);
  switchVersion('/app', 'v1.3.0', 'aaaaaaaaaaaaaaaa', fine.exec);
  assert.deepEqual(fine.calls, ['git checkout --detach --force v1.3.0', 'npm ci --no-audit --no-fund', 'npm run build']);
});
