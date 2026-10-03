import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Engine } from '../src/engine.mjs';
import { LiveService } from '../src/live.mjs';
import { git } from '../src/local-tools.mjs';
import { entrySchema } from '../src/brain.mjs';
import { autoRepository } from '../src/home-repository.mjs';
import { buildProfile, distinctiveTerms, fingerprint, pastedClues, routingKey, splitWords } from '../src/repository-routing.mjs';
import { tiebreakCandidates, tiebreakPrompt, tiebreakVerdict } from '../src/repository-tiebreak.mjs';
import { linkSuggestions } from '../src/repository-router.mjs';
import { createServer } from '../src/server.mjs';
import { completes, settle, temporaryRepository, until, workerDouble } from './live-double.mjs';

const project = (id, files, extra = {}) => ({ id, name: id, repositoryPath: `/code/${id}`, linked: [], ...extra, files });
const player = project('music-player', ['src/services/SubsonicAlbumService.ts', 'src/components/GlobalPlayer.tsx', 'src/pages/PlaylistDetailsPage.tsx', 'src/components/TrackRow.tsx', 'src/components/ShuffleButton.tsx']);
const game = project('office-fly', ['scripts/fly_controller.gd', 'scripts/updraft.gd', 'scenes/props/desk.tscn', 'scripts/fan_mechanism.gd', 'scripts/climb_surface.gd']);
const web = project('shop-web', ['src/pages/CheckoutPage.tsx', 'src/pages/OrderHistoryPage.tsx', 'src/components/CartDrawer.tsx'], { linked: ['shop-api'] });
const api = project('shop-api', ['src/routes/orders.ts', 'src/routes/checkout.ts', 'src/db/order_notes.sql'], { linked: ['shop-web'] });
const home = { id: 'home', name: 'dispatch home', repositoryPath: '/data/home', linked: [] };
const profilesOf = projects => projects.map(item => buildProfile(item, item.files));

test('identifiers split into routing words without file noise', () => {
  assert.deepEqual(splitWords('src/services/SubsonicAlbumService.ts'), ['service', 'subsonic', 'album', 'service']);
  assert.deepEqual(splitWords('scripts/fly_controller.gd'), ['fly', 'controller']);
  assert.deepEqual(splitWords('Fix the HTTPServer bug in index.js'), ['http', 'server']);
});

test('pasted run ids, forge links and paths each point at the one repository that owns them', () => {
  const projects = [player, game], profiles = profilesOf(projects);
  const runs = [{ id: 'b538947e-ba24-46b7-adff-1b831baa63e0', projectId: 'office-fly' }];
  assert.equal(pastedClues('look at /runs/b538947e-ba24-46b7-adff-1b831baa63e0, it loops', projects, { runs }).project, game);
  assert.equal(pastedClues('see https://github.com/me/music-player/pull/12', projects).project, player);
  assert.equal(pastedClues('TypeError at getAlbum (SubsonicAlbumService.ts:42)', projects, { profiles }).project, player);
  assert.equal(pastedClues('crash in /code/office-fly/scripts/updraft.gd:9', projects).project, game);
  assert.equal(pastedClues('unknown run 00000000-0000-0000-0000-000000000000 and index.js', projects, { runs, profiles }).project, null);
  assert.equal(pastedClues('compare SubsonicAlbumService.ts with updraft.gd', projects, { profiles }).project, null);
});

test('fingerprints weigh words only one repository has, and linked repositories may share a ticket', () => {
  const projects = [player, game], profiles = profilesOf(projects);
  const clear = fingerprint('the shuffle button skips the last track in a playlist', projects, profiles);
  assert.equal(clear.confident, true); assert.equal(clear.ranked[0].project, player); assert.deepEqual(clear.ranked[0].hits, ['shuffle', 'button', 'track', 'playlist']);
  assert.equal(fingerprint('make it feel more like magic', projects, profiles).ranked.length, 0);
  const pair = [web, api], shared = fingerprint('add order notes to checkout and show them in order history', pair, profilesOf(pair));
  assert.equal(shared.confident, true);
  const unlinked = pair.map(item => ({ ...item, linked: [] }));
  assert.equal(fingerprint('add order notes to checkout and show them in order history', unlinked, profilesOf(unlinked)).confident, false);
});

test('routing tries names, then pastes, then learned habits, then fingerprints, and ranks guesses for dispatch home', () => {
  const projects = [home, player, game], profiles = profilesOf([player, game]);
  assert.equal(autoRepository('bump vite in music-player', projects, home, { profiles }).stage, 'name');
  assert.equal(autoRepository('fix src/components/TrackRow.tsx and the fan', projects, home, { profiles }).project, player);
  const vague = autoRepository('the player feels floaty', projects, home, { profiles });
  assert.equal(vague.project, home); assert.equal(vague.confidence, 'ask'); assert.deepEqual(vague.ranked.map(item => item.project.id), ['music-player']);
  const key = routingKey('make it feel more like magic');
  const suggest = autoRepository('make it feel more like magic', projects, home, { profiles, learned: wanted => wanted === key ? { mode: 'suggest', value: 'office-fly', count: 2 } : null });
  assert.equal(suggest.project, home); assert.equal(suggest.ranked[0].project, game); assert.match(suggest.ranked[0].reason, /last 2 times/);
  const auto = autoRepository('make it feel more like magic', projects, home, { profiles, learned: () => ({ mode: 'auto', value: 'office-fly', count: 4 }) });
  assert.equal(auto.project, game); assert.equal(auto.stage, 'learned');
  assert.equal(autoRepository('the fly gets stuck climbing near the fan', projects, home, { profiles }).project, game);
});

test('routing keys fit the brain preference key format', () => {
  const key = routingKey('Make the Shuffle button LOUDER! (again)');
  assert.equal(key, 'repository.route:button louder shuffle');
  assert.doesNotThrow(() => entrySchema({ kind: 'preference', key, scope: 'global' }));
  assert.ok(entrySchema({ kind: 'preference', key: routingKey('word '.repeat(10) + 'a'.repeat(200)), scope: 'global' }));
  assert.equal(routingKey('it is the'), null);
});

test('repositories that change in the same ticket are offered as links, counting each ticket once', () => {
  const projects = [{ id: 'a', linked: [] }, { id: 'b', linked: [] }, { id: 'c', linked: ['a'] }];
  const run = (key, projectId, members) => ({ mode: 'live', ticket: { key }, projectId, changedPaths: ['x'], linked: members.map(id => ({ projectId: id, changedPaths: ['y'] })) });
  const runs = [run('t1', 'a', ['b']), run('t1', 'a', ['b']), run('t2', 'b', ['a', 'c']), run('t3', 'a', ['c'])];
  assert.deepEqual(linkSuggestions(runs, projects), [{ ids: ['a', 'b'], count: 2 }]);
  assert.deepEqual(linkSuggestions(runs.slice(0, 2), projects), []);
  assert.deepEqual(linkSuggestions(runs, projects, { excluded: new Set(['b']) }), []);
});

async function repositoryWith(files) {
  const { dir, repo } = await temporaryRepository('dispatch-routing-');
  for (const file of files) { mkdirSync(dirname(join(repo, file)), { recursive: true }); writeFileSync(join(repo, file), 'x'); }
  await git(repo, ['add', '.']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Files']);
  return { dir, repo };
}

async function routingFixture(t, behavior = completes) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-routing-data-'));
  const engine = new Engine({ dataDir: join(dir, 'data') });
  const live = new LiveService(engine, { adapter: workerDouble(behavior) });
  const repos = [await repositoryWith(player.files), await repositoryWith(game.files)];
  t.after(async () => { await engine.shutdown(); for (const item of [{ dir }, ...repos]) rmSync(item.dir, { recursive: true, force: true }); });
  await live.ensureHome();
  const [music, fly] = [await live.saveProject({ repositoryPath: repos[0].repo, name: 'music', baseBranch: 'main', confirmed: true, validation: [] }), await live.saveProject({ repositoryPath: repos[1].repo, name: 'fly', baseBranch: 'main', confirmed: true, validation: [] })];
  return { engine, live, music, fly };
}

test('a vague ticket routes by the files of the saved repositories, and the preview says why', async t => {
  const { engine, live, music } = await routingFixture(t);
  const run = await live.create({ input: 'The shuffle button skips the last track of a playlist' }); await settle(engine, run);
  assert.equal(run.projectId, music.id); assert.equal(run.repositorySelection.stage, 'fingerprint'); assert.match(run.repositorySelection.reason, /mentions “shuffle”/);
  const server = createServer(engine); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const preview = async input => (await fetch(`http://127.0.0.1:${server.address().port}/api/routing/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input }) })).json();
  assert.deepEqual(await preview('the GlobalPlayer pauses on lock'), { stage: 'fingerprint', confidence: 'likely', reason: 'Selected music: the ticket mentions “global”, “player”, which match its files.', home: false, project: { id: music.id, name: 'music' }, members: [], ranked: [] });
  const unclear = await preview('make it feel more like magic');
  assert.equal(unclear.home, true); assert.equal(unclear.confidence, 'ask');
  assert.equal(await preview('  '), null);
});

test('choosing a repository for the same kind of ticket four times makes routing automatic', async t => {
  const { engine, live, fly } = await routingFixture(t);
  for (let i = 0; i < 4; i++) {
    const preview = await live.router.preview({ input: 'make it feel more like magic' });
    assert.equal(preview.home, i < 4, `attempt ${i}`);
    if (i >= 2) assert.equal(preview.ranked[0].id, fly.id);
    await settle(engine, await live.create({ projectId: fly.id, routingAnswer: true, input: 'Make it feel more like magic' }));
  }
  const routed = await live.create({ input: 'make it feel more like magic' }); await settle(engine, routed);
  assert.equal(routed.projectId, fly.id); assert.equal(routed.repositorySelection.stage, 'learned');
});

test('an agent in dispatch home adds a saved repository without asking, and routing learns from it', async t => {
  let result, music;
  const behavior = async (options, turn) => {
    if (turn === 1) result = JSON.parse((await options.tools.call('dispatch_repository', { action: 'add', path: music.repositoryPath })).content[0].text);
    return { outcome: 'completed', sessionId: 'session-1', summary: 'Done' };
  };
  const fixture = await routingFixture(t, behavior); music = fixture.music;
  const run = await fixture.live.create({ input: 'make it feel more like magic' });
  await until(() => result);
  assert.equal(result.added, true); assert.equal(result.savedNow, false);
  assert.equal(fixture.live.interactions.pending.has(run.id), false);
  assert.deepEqual(run.linkRequests, [music.id]);
  assert.equal(fixture.live.router.learned(routingKey('make it feel more like magic')).value, music.id);
  await until(() => run.supersededBy); await settle(fixture.engine, fixture.engine.get(run.supersededBy));
});

test('a close call is described to the model by each repository’s distinctive words, and only a named pick counts', () => {
  const projects = [player, game], profiles = profilesOf(projects);
  assert.deepEqual(distinctiveTerms(profiles[1], [profiles[0]], 3), ['fly', 'office', 'climb']);
  const prompt = tiebreakPrompt('The player feels floaty', tiebreakCandidates(projects, profiles));
  assert.match(prompt, /1\. music-player\n {3}Its files mention: .*subsonic/); assert.match(prompt, /2\. office-fly\n {3}Its files mention: .*updraft/);
  assert.match(prompt, /Ticket:\nThe player feels floaty/); assert.match(prompt, /ROUTE: none/);
  assert.deepEqual(tiebreakVerdict('ROUTE: office-fly — floaty sounds like flight physics.', projects), { project: game, reason: 'floaty sounds like flight physics' });
  assert.equal(tiebreakVerdict('Thinking…\nroute: **music-player** - audio', projects).project, player);
  assert.equal(tiebreakVerdict('ROUTE: music-player', projects).project, player);
  assert.equal(tiebreakVerdict('ROUTE: none — a general question', projects), null);
  assert.equal(tiebreakVerdict('ROUTE: shop-web — guess', projects), null);
  assert.equal(tiebreakVerdict('I would pick office-fly', projects), null);
});

const asksRoute = options => options.readOnly && options.prompt.startsWith('Decide which repository');

test('a close call asks the run’s model before the first turn and moves the run to its pick', async t => {
  const prompts = [];
  const behavior = options => { if (asksRoute(options)) { prompts.push(options); return { outcome: 'completed', sessionId: 'route', summary: 'ROUTE: music — playback feel' }; } return completes(options); };
  const { engine, live, music } = await routingFixture(t, behavior);
  const run = await live.create({ input: 'the player feels floaty' }); await settle(engine, run);
  assert.equal(prompts.length, 1); assert.equal(prompts[0].workspace, live.homePath); assert.equal(prompts[0].sessionId, null);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.map(event => event.message)));
  assert.equal(run.projectId, music.id); assert.equal(run.project.name, 'music'); assert.ok(run.workspace.startsWith(live.workspaceRoot));
  assert.equal(run.repositorySelection.stage, 'model'); assert.match(run.repositorySelection.reason, /picked it from the close call \(playback feel\)/);
  assert.equal(run.repositorySelection.tiebreak, undefined);
});

test('a model that picks none of the guesses leaves the run in dispatch home', async t => {
  const behavior = options => asksRoute(options) ? { outcome: 'completed', sessionId: 'route', summary: 'ROUTE: none — a question' } : completes(options);
  const { engine, live } = await routingFixture(t, behavior);
  const run = await live.create({ input: 'the player feels floaty' }); await settle(engine, run);
  assert.equal(run.projectId, live.homeProject().id); assert.equal(run.status, 'ready');
  assert.ok(run.events.some(event => /did not pick one/.test(event.message)));
});

test('a finished run that changed two often-paired repositories offers to link them, once', async t => {
  const { engine, live, music, fly } = await routingFixture(t);
  const changed = key => ({ id: `run-${key}`, mode: 'live', status: 'ready', events: [], ticket: { key }, projectId: music.id, changedPaths: ['a'], linked: [{ projectId: fly.id, changedPaths: ['b'] }] });
  engine.runs.push(changed('t1'));
  assert.equal(live.router.offerFor(engine.runs.at(-1)), null);
  engine.runs.push(changed('t2'));
  const ids = [music.id, fly.id].sort();
  assert.deepEqual(live.router.offerFor(engine.runs.at(-1)), { ids, count: 2, names: ids.map(id => id === music.id ? 'music' : 'fly') });
  live.router.dismiss([fly.id, music.id]);
  assert.equal(live.router.offerFor(engine.runs.at(-1)), null);
  assert.deepEqual(live.router.link([music.id, fly.id]), { linked: ['music', 'fly'] });
  assert.deepEqual(music.linked, [fly.id]); assert.deepEqual(fly.linked, [music.id]);
  assert.throws(() => live.router.link([music.id, music.id]), /two saved repositories/);
});
