import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { liveFixture, settle } from './live-double.mjs';

function double(name, models, calls) {
  return {
    capabilities: async () => { calls.push(`${name}:capabilities`); return { available: true, authenticated: true, version: `${name}-double` }; },
    models: async () => { calls.push(`${name}:models`); return { available: true, message: `${name} models`, models }; },
    run: async options => {
      calls.push(`${name}:run:${options.readOnly ? 'review' : options.sessionId ?? 'new'}`);
      options.onSession(`${name}-session`);
      if (options.readOnly) return { outcome: 'completed', sessionId: `${name}-review`, summary: '{"approved":true,"findings":[]}' };
      writeFileSync(join(options.workspace, 'value.txt'), 'changed');
      return { outcome: 'completed', sessionId: `${name}-session`, summary: `${name} done`, usage: { input_tokens: 5, cached_input_tokens: 1, output_tokens: 2 } };
    },
  };
}
async function fixture(t) {
  const calls = [];
  const fixture = await liveFixture(t, {
    adapter: double('codex', [{ model: 'test-sol', isDefault: true, supportedReasoningEfforts: [] }], calls),
    services: { adapters: { claude: double('claude', [{ model: 'opus', displayName: 'Opus', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], calls), 'local-models': double('local', [{ model: 'ollama/qwen3.6:latest', isDefault: true, supportedReasoningEfforts: [] }], calls) } },
    project: { review: true },
  });
  return { ...fixture, calls };
}

test('disabled providers are never probed, listed, or executable', async t => {
  const { live, project, calls } = await fixture(t);
  assert.deepEqual(live.providers.settings, { codex: true, claude: false, cursor: false, opencode: false, pi: false, 'local-models': false });
  const connections = await live.connections();
  assert.deepEqual(Object.keys(connections).sort(), ['codex', 'connectors']); assert.deepEqual(connections.connectors, {});
  await live.refreshModels();
  assert.deepEqual(calls, ['codex:capabilities', 'codex:models']);
  assert.deepEqual(live.modelCatalog.models.map(model => model.provider), ['codex']);
  await assert.rejects(live.create({ projectId: project.id, input: 'Change it', execution: { provider: 'claude', model: 'opus' } }), /enabled provider/);
  for (const id of ['shell', 'ollama', 'local']) assert.throws(() => live.setProvider({ id, enabled: true }), /Unknown provider/);
  assert.throws(() => live.setProvider({ id: 'claude', enabled: 'yes' }), /boolean/);
});

test('an enabled provider owns its run, review and follow-up session', async t => {
  const { engine, live, project, calls } = await fixture(t);
  live.setProvider({ id: 'claude', enabled: true });
  const catalog = await live.refreshModels();
  assert.deepEqual(catalog.models.map(model => `${model.provider}:${model.model}`), ['codex:test-sol', 'claude:opus']);
  assert.match(catalog.message, /Codex: codex models/); assert.equal(catalog.providers.claude.available, true);
  const run = await live.create({ projectId: project.id, input: 'Change it', execution: { provider: 'claude', model: 'opus', effort: 'high' } });
  await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.at(-1)));
  assert.equal(run.provider, 'claude'); assert.equal(run.sessionId, 'claude-session');
  assert.ok(run.events.some(event => event.message === 'Live Claude Code run queued.'));
  const next = await live.followup(run.id, { input: 'Once more' }); await settle(engine, next);
  assert.equal(next.provider, 'claude'); assert.deepEqual(next.execution.model, 'opus');
  assert.deepEqual(calls.filter(call => call.includes(':run:')), ['claude:run:new', 'claude:run:review', 'claude:run:claude-session', 'claude:run:review']);
});

test('Auto uses the default model reported by the default provider', async t => {
  const { live, project } = await fixture(t); await live.refreshModels();
  const run = await live.create({ projectId: project.id, input: 'Change it' });
  assert.deepEqual([run.execution.provider, run.execution.model, run.execution.mode], ['codex', 'test-sol', 'auto']);
});

test('local models alone run Auto, review and follow-ups without probing a hosted provider', async t => {
  const { engine, live, project, calls } = await fixture(t);
  live.setProvider({ id: 'codex', enabled: false }); live.setProvider({ id: 'local-models', enabled: true });
  await live.refreshModels(); await live.connections();
  const run = await live.create({ projectId: project.id, input: 'Change it' }); await settle(engine, run);
  assert.equal(run.status, 'ready', JSON.stringify(run.events.at(-1)));
  assert.deepEqual([run.execution.provider, run.execution.model, run.execution.mode], ['local-models', 'ollama/qwen3.6:latest', 'auto']);
  assert.ok(calls.every(call => call.startsWith('local:')), calls.join());
});

test('disabling a provider removes its models and blocks continuing its sessions', async t => {
  const { engine, live, project } = await fixture(t);
  live.setProvider({ id: 'claude', enabled: true }); await live.refreshModels();
  const run = await live.create({ projectId: project.id, input: 'Change it', execution: { provider: 'claude', model: 'opus', effort: 'high' } }); await settle(engine, run);
  assert.equal(run.provider, 'claude'); assert.equal(run.execution.mode, 'manual');
  const { providerSettings, modelCatalog } = live.setProvider({ id: 'claude', enabled: false });
  assert.equal(providerSettings.claude, false); assert.deepEqual(modelCatalog.models.map(model => model.provider), ['codex']);
  const next = await live.followup(run.id, { input: 'Continue' }); await settle(engine, next);
  assert.equal(next.status, 'blocked'); assert.match(next.events.at(-1).message, /Claude Code is not enabled/);
});

test('dispatch needs at least one provider and ignores settings saved for removed providers', async t => {
  const { engine, live, project } = await fixture(t);
  engine.store.state.providerSettings = { codex: false, ollama: true, local: true };
  assert.deepEqual(live.providers.settings, { codex: false, claude: false, cursor: false, opencode: false, pi: false, 'local-models': false });
  await assert.rejects(live.create({ projectId: project.id, input: 'Change it' }), /Enable a provider/);
  assert.equal(engine.runs.length, 0);
});

test('contracts are declared per adapter without probing and are unreadable for disabled providers', async t => {
  const { liveFixture } = await import('./live-double.mjs');
  const { live } = await liveFixture(t);
  const codex = live.providers.contract('codex');
  assert.deepEqual(codex, { questions: 'none', tools: 'none', browserTools: 'none', sessions: false, streaming: false, readOnlyTurns: true, readOnlyTools: false, sandbox: true });
  assert.throws(() => live.providers.contract('claude'), /not enabled/);
  assert.deepEqual(Object.keys(live.providers.contracts()), ['codex']);
  const { CodexAdapter } = await import('../src/codex.mjs'); const { ClaudeAdapter } = await import('../src/claude.mjs');
  assert.equal(new CodexAdapter().contract.questions, 'native'); assert.equal(new ClaudeAdapter().contract.questions, 'tool'); assert.equal(new ClaudeAdapter().contract.readOnlyTools, true);
});

test('Codex starts on only where its CLI is installed, and the first answer is kept', async t => {
  const { ProviderRegistry } = await import('../src/providers.mjs');
  const store = state => ({ state, saves: 0, save() { this.saves++; } });
  const absent = store({}), registry = new ProviderRegistry(absent, { codex: { installed: () => false } });
  assert.equal(registry.settings.codex, false); assert.equal(absent.state.providerSettings.codex, false); assert.equal(absent.saves, 1);
  registry.adapters.codex.installed = () => true;
  assert.equal(registry.settings.codex, false); assert.equal(absent.saves, 1);
  assert.equal(new ProviderRegistry(store({}), { codex: { installed: () => true } }).settings.codex, true);
  assert.equal(new ProviderRegistry(store({ providerSettings: { codex: true } }), { codex: { installed: () => false } }).settings.codex, true);
  const { commandOnPath } = await import('../src/local-tools.mjs');
  assert.equal(commandOnPath('codex', { path: '/a:/b', platform: 'linux', executable: file => file === '/b/codex' }), true);
  assert.equal(commandOnPath('codex', { path: 'C:\\a', platform: 'win32', executable: file => file === 'C:\\a/codex.cmd' }), true);
  assert.equal(commandOnPath('codex', { path: '', platform: 'linux', executable: () => true }), false);
});

test('a provider without a sandbox is refused unless the run has full access', async t => {
  const calls = [], unsandboxed = { ...double('opencode', [{ model: 'a/b', supportedReasoningEfforts: [] }], calls), contract: { sandbox: false } };
  const { engine, live, project } = await liveFixture(t, { adapter: double('codex', [{ model: 'test-sol', isDefault: true, supportedReasoningEfforts: [] }], calls), services: { adapters: { opencode: unsandboxed } } });
  live.setProvider({ id: 'opencode', enabled: true }); await live.refreshModels();
  const refused = await live.create({ projectId: project.id, input: 'Change it', execution: { provider: 'opencode', model: 'a/b' } }); await settle(engine, refused);
  assert.equal(refused.status, 'blocked'); assert.match(refused.events.at(-1).message, /OpenCode has no sandbox.*Full access/);
  assert.ok(!calls.includes('opencode:run:new'));
  live.setAccess({ mode: 'full' });
  const allowed = await live.create({ projectId: project.id, input: 'Change it again', execution: { provider: 'opencode', model: 'a/b' } }); await settle(engine, allowed);
  assert.equal(allowed.status, 'ready', JSON.stringify(allowed.events.at(-1)));
  assert.throws(() => live.setLocalAgent({ agent: 'codex' }), /Choose one of/);
  assert.equal(live.setLocalAgent({ agent: 'pi' }).localAgent, 'pi');
});
