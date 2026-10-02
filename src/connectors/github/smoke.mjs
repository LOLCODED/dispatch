// Explicit opt-in: performs a real git push to a disposable local bare remote. The worker is a
// controlled double and gh is a recording shell shim, so no provider or GitHub credentials are used.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { Engine } from '../../engine.mjs';
import { LiveService } from '../../live.mjs';
import { git } from '../../local-tools.mjs';
import { terminal } from '../../catalog.mjs';

const directory = mkdtempSync(join(tmpdir(), 'dispatch-delivery-smoke-'));
const source = join(directory, 'source'), remote = join(directory, 'remote.git'), bin = join(directory, 'bin'), log = join(directory, 'gh-calls.log');
console.log(`Delivery smoke (local bare remote, gh shim, controlled worker); retained under ${directory}`);

function installShim() {
  mkdirSync(bin);
  const shim = `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$1 $2" in
  "--version "*) echo "gh version 0.0.0 (dispatch shim)";;
  "auth status") echo "Logged in (shim)";;
  "pr list") echo "[]";;
  "pr create") echo "https://github.com/example/repo/pull/1";;
  "repo view") echo "example/repo";;
  "api "*) echo '{"total":1,"checks":[{"name":"ci","status":"completed","conclusion":"success"}]}';;
  *) echo "unexpected gh call: $*" >&2; exit 1;;
esac
`;
  writeFileSync(join(bin, 'gh'), shim); chmodSync(join(bin, 'gh'), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
}
async function prepareRepositories() {
  mkdirSync(source); writeFileSync(join(source, 'value.txt'), 'original\n');
  await git(source, ['init', '-b', 'main']); await git(source, ['add', '.']); await git(source, ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@localhost', 'commit', '-m', 'Initial']);
  await git(directory, ['init', '--bare', remote]);
  await git(source, ['remote', 'add', 'origin', remote]);
}
async function wait(engine, run) {
  let seen = 0;
  while (!terminal.has(run.status) || engine.active.has(run.id)) {
    for (const event of run.events.slice(seen)) console.log(`${run.ticketId} ${event.kind}: ${event.message.slice(0, 200)}`);
    seen = run.events.length; await sleep(200);
  }
  for (const event of run.events.slice(seen)) console.log(`${run.ticketId} ${event.kind}: ${event.message.slice(0, 200)}`);
}
const expect = (condition, message) => { if (!condition) throw new Error(`FAIL: ${message}`); };

installShim();
await prepareRepositories();
const engine = new Engine({ dataDir: join(directory, 'data'), delayMs: 1 });
const adapter = { capabilities: async () => ({ available: true, authenticated: true, version: 'controlled double' }), run: async options => { options.onSession('smoke-session'); writeFileSync(join(options.workspace, 'value.txt'), 'changed\n'); return { outcome: 'completed', sessionId: 'smoke-session', summary: 'Changed value.txt' }; } };
const live = new LiveService(engine, { adapter });
await live.connectorPlugins.loadBuiltIn([dirname(fileURLToPath(import.meta.url))]);
try {
  const project = await live.saveProject({ name: 'delivery-smoke', repositoryPath: source, baseBranch: 'main', confirmed: true, connectors: { github: { enabled: true, actions: { push: true, openPullRequest: true } } }, validation: [{ id: 'unit', command: process.execPath, args: ['-e', 'if(require("fs").readFileSync("value.txt","utf8").trim()!=="changed")process.exit(1)'] }] });
  const connections = await live.connections();
  expect(connections.connectors.github.available && connections.connectors.github.authenticated, `gh shim probe: ${JSON.stringify(connections.connectors.github)}`);
  const run = await live.create({ projectId: project.id, input: 'Change value.txt to changed' });
  await wait(engine, run);
  expect(run.status === 'ready', `run status ${run.status}`);
  expect(run.delivery?.error === null, `delivery error ${JSON.stringify(run.delivery?.error)}`);
  const pushed = await git(directory, ['--git-dir', remote, 'rev-parse', `refs/heads/${run.branch}`]);
  expect(pushed === run.headSha, `remote branch ${pushed} differs from head ${run.headSha}`);
  let baseOnRemote = true; try { await git(directory, ['--git-dir', remote, 'rev-parse', '--verify', 'refs/heads/main']); } catch { baseOnRemote = false; }
  expect(!baseOnRemote, 'base branch must never be pushed');
  const calls = readFileSync(log, 'utf8').trim().split('\n');
  expect(calls.some(call => call.startsWith(`pr list --head ${run.branch} --state all --json number,url,state,headRefOid`)), `pr list call missing in ${JSON.stringify(calls)}`);
  const create = calls.find(call => call.startsWith('pr create '));
  expect(create?.startsWith(`pr create --draft --head ${run.branch} --base main --title=${run.title.slice(0, 120)} --body-file `), `pr create call: ${create}`);
  expect(calls.some(call => call.startsWith(`api repos/example/repo/commits/${run.headSha}/check-runs --jq `)), `check-runs call missing in ${JSON.stringify(calls)}`);
  expect(run.delivery.pr.number === 1 && run.delivery.ci.state === 'success', `delivery record ${JSON.stringify(run.delivery)}`);
  expect(project.connectorMemory?.github?.repository?.nameWithOwner === 'example/repo', 'repository cache missing');
  console.log(`PASS: pushed ${run.branch} at ${run.headSha} to the local bare remote; gh shim received ${calls.length} calls with the expected arguments.`);
  console.log('Not verified here: a real GitHub remote, gh authentication and live CI. Run this against a real repository only with explicit consent.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await engine.shutdown(); }
