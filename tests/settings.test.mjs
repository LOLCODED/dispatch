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
