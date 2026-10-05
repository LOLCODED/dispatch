import test from 'node:test';
import assert from 'node:assert/strict';
import { internalProjectKeys, internalStateKeys } from '../src/settings.mjs';
import { liveFixture } from './live-double.mjs';

// The hard rule: every setting is reachable through the registry (HTTP, CLI and dispatch_settings).
// Filling every setting through its own page's setter must leave no state or repository key the registry does not know.
test('every stored setting is declared in the settings registry', async t => {
  const { live, project } = await liveFixture(t, { project: { review: true, memory: false, browser: { enabled: true }, localFiles: [], network: { hosts: ['registry.npmjs.org'] }, services: [{ id: 'worker', command: 'npm', args: ['run', 'worker'] }], instructions: ['Use tabs'], protectedPaths: ['db/**'], databases: [{ name: 'local', access: 'write', connection: { envFile: '.env', variables: ['DATABASE_URL'] } }] } });
  live.setAccess({ mode: 'full' }); live.setBranchNaming({ mode: 'ask' }); live.engine.setConcurrency(2);
  live.setLocalEndpoints({ endpoints: [{ name: 'Ollama', kind: 'ollama', url: 'http://127.0.0.1:11434' }] }); live.setLocalAgent({ agent: 'pi' }); live.setAutoTiers({ tiers: [] });
  live.engine.store.state.hiddenModels = [];
  const registry = live.settingsRegistry, state = live.engine.store.state;
  const stateKeys = new Set(registry.global().map(entry => entry.stateKey));
  assert.deepEqual(Object.keys(state).filter(key => !stateKeys.has(key) && !internalStateKeys.includes(key)), [], 'state keys missing from src/settings.mjs');
  const fields = new Set(registry.repository(project).map(entry => entry.field));
  assert.deepEqual(Object.keys(project).filter(key => !fields.has(key) && !internalProjectKeys.includes(key)), [], 'repository fields missing from src/settings.mjs');
});

test('settings read and change through the registry, with CLI text turned into the setting’s type', async t => {
  const { live, project } = await liveFixture(t);
  const registry = live.settingsRegistry;
  assert.deepEqual(await registry.set('access.mode', 'full'), { key: 'access.mode', value: 'full' });
  assert.deepEqual(await registry.set('queue.concurrency', '3'), { key: 'queue.concurrency', value: 3 });
  await assert.rejects(registry.set('branches.naming', 'sometimes'), /one of: auto, ask/);
  await assert.rejects(registry.set('no.such.setting', 1), /No setting no.such.setting/);
  assert.deepEqual(await registry.set('repository.review', 'true', { repository: project.name }), { key: 'repository.review', value: true });
  assert.deepEqual((await registry.set('repository.databases', '[{"name":"staging","access":"read","connection":{"from":"connector","connector":"ado","options":{"keyVault":"kv"}}}]', { repository: project.name })).value.map(entry => [entry.name, entry.access]), [['staging', 'read']]);
  assert.equal(live.projects[0].review, true);
  const listed = registry.describe({ repository: project.name });
  assert.ok(listed.every(entry => entry.key.startsWith('repository.') && entry.description)); assert.ok(registry.describe().some(entry => entry.key === 'providers.claude.enabled'));
});

test('a connector setting marked secret is never read back', async t => {
  const { live, project } = await liveFixture(t);
  Object.defineProperty(live, 'connectorList', { value: [{ id: 'vault', name: 'Vault', enabled: false, actions: [], settings: [{ key: 'token', secret: true }, { key: 'region', secret: false }] }] });
  const masked = live.settingsRegistry.masked('connectors', { vault: { enabled: true, settings: { token: 'abc123', region: 'eu' } } }, project);
  assert.deepEqual(masked.vault.settings, { token: '<secret>', region: 'eu' });
});

test('the web code keeps nothing in browser storage that should be a setting', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs'), { join } = await import('node:path');
  const { browserEvents, browserStateKeys, preferenceSpecs } = await import('../src/preferences.mjs');
  const files = dir => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : /\.(m?js|jsx)$/.test(name) ? [path] : []; });
  const literals = files('web').flatMap(path => [...readFileSync(path, 'utf8').matchAll(/['`](dispatch-[a-z0-9-]+)/g)].map(match => match[1]));
  const known = literal => browserEvents.includes(literal) || browserStateKeys.some(key => literal === key || (key.endsWith('-') && literal.startsWith(key)));
  assert.deepEqual([...new Set(literals.filter(literal => !known(literal)))], [], 'register these in src/preferences.mjs as a setting, or as browser state');
  assert.ok(Object.values(preferenceSpecs).every(spec => !literals.includes(spec.cache)), 'web code reads a preference from storage directly instead of through server-preferences');
});

test('preferences are validated settings, stored on the server and read back with their defaults', async t => {
  const { live } = await liveFixture(t);
  const { fromCache, cacheText } = await import('../src/preferences.mjs');
  const registry = live.settingsRegistry;
  assert.equal(registry.get('appearance.theme'), 'system');
  assert.deepEqual(registry.preferences().unset.includes('appearance.theme'), true);
  await registry.set('appearance.theme', 'dark'); await registry.set('attention.volume', '35'); await registry.set('keybinds', '{"fullScreen":"Alt+G"}');
  assert.deepEqual([registry.get('appearance.theme'), registry.get('attention.volume'), registry.get('keybinds')], ['dark', 35, { fullScreen: 'Alt+G' }]);
  assert.equal(registry.preferences().unset.includes('appearance.theme'), false);
  await assert.rejects(registry.set('appearance.theme', 'purple'), /one of: system, dark, light/);
  await assert.rejects(registry.set('attention.volume', 400), /does not take that value/);
  assert.equal(fromCache('attention.volume', '35'), 35); assert.equal(fromCache('appearance.theme', 'purple'), undefined); assert.equal(cacheText('keybinds', { a: 'B' }), '{"a":"B"}');
});
