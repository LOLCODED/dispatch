import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryInput, suggestedRecipe } from '../src/repository-setup.mjs';
import { createServer } from '../src/server.mjs';
import { liveFixture, settle, temporaryRepository, until, workerDouble } from './live-double.mjs';

const info = { repositoryPath: '/code/site', name: 'site', git: true, baseBranch: 'main', branches: ['main'], scripts: { check: 'x', test: 'y', dev: 'z' }, suggestedChecks: ['check', 'test'], suggestInstall: true, suggestBrowser: true };
const parse = result => JSON.parse(result.content[0].text);
const completed = { outcome: 'completed', sessionId: 'session-1', summary: 'Done' };

async function otherRepository(t) {
  const other = await temporaryRepository('dispatch-repository-tool-');
  t.after(() => rmSync(other.dir, { recursive: true, force: true }));
  return other.repo;
}

test('a repository saved without the setup page gets its suggested settings, each overridable', () => {
  const defaults = repositoryInput(info);
  assert.deepEqual(defaults.validation, suggestedRecipe(info).validation);
  assert.deepEqual(defaults.setup.map(step => step.args.join(' ')), ['ci']);
  assert.deepEqual(defaults.checkScopes, [{ id: 'text-only', paths: ['*.md', 'docs/**'], checks: ['check'] }]);
  assert.equal(defaults.browser.enabled, true); assert.equal(defaults.baseBranch, 'main'); assert.equal(defaults.confirmed, true);
  const custom = repositoryInput(info, { name: 'Site', checks: ['npm run lint', 'npm run lint', 'make test'], setup: [], textOnlyPaths: [], browser: false, review: true, instructions: ['Keep it small'] });
  assert.deepEqual(custom.validation.map(step => step.id), ['lint', 'lint-2', 'check-3']);
  assert.deepEqual(custom.setup, []); assert.deepEqual(custom.checkScopes, []);
  assert.equal(custom.name, 'Site'); assert.equal(custom.browser.enabled, false); assert.equal(custom.review, true); assert.deepEqual(custom.instructions, ['Keep it small']);
  const plain = repositoryInput({ ...info, git: false, baseBranch: null });
  assert.equal(plain.baseBranch, null); assert.equal(plain.trackRemote, false);
});

test('adding a saved folder keeps its settings and only links it', async t => {
  const { live, project } = await liveFixture(t);
  const path = await otherRepository(t);
  const first = await live.repositories.add({ repositoryPath: path, checks: ['npm run test'] });
  assert.equal(first.created, true); assert.deepEqual(first.project.validation.map(step => step.id), ['test']);
  const again = await live.repositories.add({ repositoryPath: path, checks: ['npm run other'], linkTo: project.id });
  assert.equal(again.created, false); assert.equal(again.project.id, first.project.id); assert.deepEqual(again.project.validation.map(step => step.id), ['test']);
  assert.deepEqual(project.linked, [first.project.id]); assert.equal(again.linkedTo, project.name);
  await assert.rejects(live.repositories.add({ repositoryPath: project.repositoryPath, linkTo: project.id }), /other saved repositories/);
  await assert.rejects(live.repositories.add({ repositoryPath: path, checks: 'npm test' }), /Checks must be a list/);
});

test('the agent adds a folder once the operator approves and it joins the task on the next turn', async t => {
  let other, inspected, added;
  const behavior = async (options, turn) => {
    if (turn === 1) {
      inspected = parse(await options.tools.call('dispatch_repository', { action: 'inspect', path: other }));
      added = parse(await options.tools.call('dispatch_repository', { action: 'add', path: other, name: 'site', checks: [`${process.execPath} -e 0`], setup: [] }));
      return completed;
    }
    const member = options.prompt.match(/^- site: (\S+)/m)?.[1];
    assert.ok(member && options.writableRoots.includes(member), options.prompt);
    writeFileSync(join(member, 'value.txt'), 'changed');
    return completed;
  };
  const { live, engine, project } = await liveFixture(t, { adapter: { ...workerDouble(behavior), contract: { writableRoots: true } } });
  other = await otherRepository(t);
  const run = await live.create({ projectId: project.id, input: 'Update the site README' });
  await until(() => live.interactions.pending.has(run.id));
  const request = run.interactions.at(-1);
  assert.match(request.questions[0].question, /wants to add .* to this task/); assert.match(request.questions[0].question, /Checks: .* -e 0/);
  live.interactions.answer(run.id, { requestId: request.id, answers: { repository: request.questions[0].options[0].label } });
  await settle(engine, run);
  assert.equal(inspected.saved, null); assert.equal(inspected.git, true); assert.deepEqual(inspected.defaults.setup, []);
  assert.equal(added.added, true); assert.equal(added.savedNow, true); assert.match(added.next, /continues the ticket there/);
  const site = live.projects.find(item => item.repositoryPath.endsWith(other.split('/').slice(-2).join('/')));
  assert.ok(site); assert.deepEqual(run.linkRequests, [site.id]); assert.deepEqual(project.linked, []); assert.deepEqual(run.linked, []);
  await until(() => run.supersededBy);
  const next = engine.get(run.supersededBy); await settle(engine, next);
  assert.match(next.input, /^site is now part of this task/);
  assert.equal(next.status, 'ready', JSON.stringify(next.events.map(event => event.message)));
  const [member] = next.linked;
  assert.equal(member.projectId, site.id); assert.ok(member.headSha && member.headSha !== member.baseSha);
  assert.equal(readFileSync(join(other, 'value.txt'), 'utf8'), 'original');
  await live.removeWorktree(next.id);
  assert.equal(existsSync(member.workspace), false);
});

test('a declined addition saves nothing', async t => {
  let other, result;
  const { live, engine, project } = await liveFixture(t, { behavior: async options => { result = parse(await options.tools.call('dispatch_repository', { action: 'add', path: other, alwaysLink: true })); return completed; } });
  other = await otherRepository(t);
  const run = await live.create({ projectId: project.id, input: 'Update the site' });
  await until(() => live.interactions.pending.has(run.id));
  live.interactions.answer(run.id, { requestId: run.interactions.at(-1).id, answers: { repository: 'Not now' } });
  await settle(engine, run);
  assert.deepEqual(result, { added: false, operator: 'Not now' });
  assert.equal(live.projects.length, 1); assert.equal(run.linkRequests, undefined);
});

test('dispatch repo add saves and links a folder, and repo list shows it', async t => {
  const { engine, project, repo } = await liveFixture(t);
  const other = await otherRepository(t);
  const server = createServer(engine); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { ...process.env, DISPATCH_URL: `http://127.0.0.1:${server.address().port}` };
  const cli = (args, cwd = repo) => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../bin/dispatch.mjs', import.meta.url)), ...args], { cwd, env }).catch(error => error);
  const saved = await cli(['repo', 'add', other, '--name', 'site', '--check', 'npm run test', '--no-browser', '--link', repo]);
  assert.match(saved.stdout, /Saved site .* with checks: test\.\nLinked to /);
  const site = engine.live.projects.find(item => item.name === 'site');
  assert.equal(site.browser.enabled, false); assert.deepEqual(project.linked, [site.id]);
  const listed = await cli(['repo', 'list']);
  assert.match(listed.stdout, /site\s+\S+repo\n/); assert.match(listed.stdout, /\(links site\)/);
  const missing = await cli(['repo', 'add']);
  assert.equal(missing.code, 1); assert.match(missing.stderr, /Give the repository folder/);
});
