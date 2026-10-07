import { InputError } from './engine.mjs';
import { accessModes } from './access.mjs';
import { branchModes } from './branch.mjs';
import { localAgents } from './local-models.mjs';
import { providerCatalog } from './providers.mjs';
import { preferenceSpecs, preferenceValue, validPreference } from './preferences.mjs';

// Every setting dispatch has is declared here once. The settings pages, the HTTP API, the CLI and the agent's
// dispatch_settings read and change settings only through this list, so a new setting is reachable everywhere
// or a test fails (tests/settings.test.mjs).

const enumOf = values => ({ type: 'enum', values });
const boolean = { type: 'boolean' }, json = { type: 'json' }, text = { type: 'string' };

// Run state, caches and records dispatch keeps for itself; none of them is a setting.
// modelRouting is left by older versions and no longer read.
export const internalStateKeys = ['version', 'runs', 'tasks', 'projects', 'board', 'brain', 'modelCatalog', 'providerLimits', 'setupCompletedAt', 'connectorPlugins', 'modelRouting'];
// Repository fields that identify it or are derived from its folder.
export const internalProjectKeys = ['id', 'repositoryPath', 'provider', 'maxRepairs', 'git', 'connectorMemory'];

const repositoryFields = [
  ['name', text, 'Display name.'], ['baseBranch', text, 'Branch every task starts from.'], ['targetBranches', json, 'Other branches offered when landing or opening pull requests.'],
  ['validation', json, 'Checks the agent can choose, as [{ id, command, args, timeoutSeconds }].'], ['setup', json, 'Commands run before each task.'], ['checkScopes', json, 'Path patterns and the checks they need.'],
  ['risk', json, 'How tests are chosen: { mode: agent | ask | off, minimumChecks, guidance }.'], ['browser', json, 'Live browser: { enabled, headed }.'], ['review', boolean, 'Second-opinion review after checks pass.'],
  ['memory', boolean, 'Keep notes from earlier tasks.'], ['trackRemote', boolean, 'Start from the remote base branch.'], ['dispatchCoAuthor', boolean, 'Add dispatch as co-author on commits.'],
  ['allowSensitiveFiles', boolean, 'Let the agent write files such as .npmrc without asking.'], ['access', enumOf(['inherit', 'full']), 'Agent access for this repository.'],
  ['localFiles', json, 'Ignored files copied from the checkout into each worktree.'], ['network', json, 'Sandbox network: { hosts, localPorts }.'],
  ['databases', json, 'Named databases: [{ name, access: none | read | write, engine, connection, commands, perTask }].'], ['services', json, 'Background services: [{ id, command, args }].'],
  ['instructions', json, 'Standing rules for the agent.'], ['protectedPaths', json, 'Paths the agent may not change.'], ['linked', json, 'Repositories every task here also gets.'], ['linkedEnv', json, 'Variables pointing a linked app at another.'],
  ['connectors', json, 'Per-connector use, actions and settings: { <id>: { enabled, actions, settings } }.'],
];

export class SettingsRegistry {
  constructor(live) { this.live = live; }
  get state() { return this.live.engine.store.state; }

  global() {
    const live = this.live, engine = live.engine;
    return [
      { key: 'access.mode', ...enumOf(accessModes), description: 'Agent access: worktrees (sandboxed, reads and writes only the task\'s worktrees), home (sandboxed to your home folder) or full.', get: () => live.accessMode, set: mode => live.setAccess({ mode }), stateKey: 'accessMode' },
      { key: 'branches.naming', ...enumOf(branchModes), description: 'Name task branches automatically, or ask at dispatch.', get: () => live.branchNaming, set: mode => live.setBranchNaming({ mode }), stateKey: 'branchNaming' },
      { key: 'queue.concurrency', type: 'integer', description: 'How many tasks run at once.', get: () => engine.concurrency, set: value => engine.setConcurrency(value), stateKey: 'concurrency' },
      ...providerCatalog.map(({ id }) => ({ key: `providers.${id}.enabled`, ...boolean, description: `Use the ${id} agent CLI.`, get: () => live.providers.settings[id] === true, set: enabled => live.setProvider({ id, enabled }), stateKey: 'providerSettings' })),
      { key: 'models.hidden', ...json, description: 'Models turned off in pickers and Auto, as [{ provider, model }].', get: () => live.hiddenModels, set: value => this.setHiddenModels(value), stateKey: 'hiddenModels' },
      { key: 'models.autoTiers', ...json, description: 'Auto tiers, lightest first.', get: () => live.autoTiers, set: tiers => live.setAutoTiers({ tiers }), stateKey: 'autoTiers' },
      { key: 'localModels.endpoints', ...json, description: 'Local model servers: [{ name, kind: ollama | server, url }].', get: () => live.localEndpoints, set: endpoints => live.setLocalEndpoints({ endpoints }), stateKey: 'localEndpoints' },
      { key: 'localModels.agent', ...enumOf(localAgents), description: 'The agent CLI that drives local models.', get: () => live.localAgent, set: agent => live.setLocalAgent({ agent }), stateKey: 'localAgent' },
      ...this.connectorGlobals(),
      ...this.preferenceEntries(),
    ];
  }

  preferenceEntries() {
    return Object.entries(preferenceSpecs).map(([key, spec]) => ({ key, type: spec.type, ...(spec.values ? { values: spec.values } : {}), description: spec.description, get: () => preferenceValue(this.state.preferences, key), set: value => this.setPreference(key, value), stateKey: 'preferences' }));
  }

  setPreference(key, value) {
    if (!validPreference(key, value)) throw new InputError(`${key} does not take that value. ${preferenceSpecs[key].description}`);
    this.state.preferences = { ...this.state.preferences, [key]: value };
    this.live.engine.store.save();
  }

  // The browser migrates its cached value once for a preference this install has never stored.
  preferences() {
    const stored = this.state.preferences ?? {};
    return { values: Object.fromEntries(Object.keys(preferenceSpecs).map(key => [key, preferenceValue(stored, key)])), unset: Object.keys(preferenceSpecs).filter(key => !Object.hasOwn(stored, key)) };
  }

  connectorGlobals() {
    return this.live.connectorList.flatMap(connector => [
      { key: `connectors.${connector.id}.enabled`, ...boolean, description: `Turn on ${connector.name} for every repository.`, get: () => connector.enabled === true, set: enabled => this.live.setGlobalConnector({ id: connector.id, enabled }), stateKey: 'connectorSettings' },
      ...connector.actions.map(action => ({ key: `connectors.${connector.id}.actions.${action.id}`, ...boolean, description: `${action.label} (${action.access}) by default.`, get: () => action.enabled === true, set: on => this.live.setGlobalConnector({ id: connector.id, actions: { [action.id]: on } }), stateKey: 'connectorSettings' })),
    ]);
  }

  setHiddenModels(value) {
    if (!Array.isArray(value)) throw new InputError('models.hidden is a list of { provider, model }.');
    for (const model of this.live.modelCatalog.allModels) this.live.setModelEnabled({ provider: model.provider, model: model.model, enabled: !value.some(item => item?.provider === model.provider && item?.model === model.model) });
    return this.live.hiddenModels;
  }

  repository(project) {
    return repositoryFields.map(([field, shape, description]) => ({ key: `repository.${field}`, ...shape, field, description, get: () => this.masked(field, project[field], project), set: value => this.saveField(project, field, value) }));
  }

  // Connector settings a connector marks secret never leave dispatch; changing one is allowed, reading it is not.
  masked(field, value, project) {
    if (field !== 'connectors' || !value) return value;
    const secrets = id => new Set((this.live.connectorList.find(item => item.id === id)?.settings ?? []).filter(setting => setting.secret).map(setting => setting.key));
    return Object.fromEntries(Object.entries(value).map(([id, entry]) => [id, { ...entry, settings: Object.fromEntries(Object.entries(entry?.settings ?? {}).map(([key, setting]) => [key, secrets(id).has(key) ? '<secret>' : setting])) }]));
  }

  async saveField(project, field, value) {
    const saved = await this.live.saveProject({ ...project, confirmed: true, [field]: value }, project.id);
    return saved[field];
  }

  project(name) {
    const found = this.live.projects.find(project => project.name === name || project.id === name || project.repositoryPath === name);
    if (!found) throw new InputError(`No repository called ${name}.`, 404);
    return found;
  }

  entries({ repository } = {}) { return repository ? this.repository(this.project(repository)) : this.global(); }

  find(key, options) {
    const entry = this.entries(options).find(item => item.key === key);
    if (!entry) throw new InputError(missingSetting(key, options?.repository, options?.repository && this.global().some(item => item.key === key)), 404);
    return entry;
  }

  describe(options) { return this.entries(options).map(({ key, type, values, description, get }) => ({ key, type, ...(values ? { values } : {}), description, value: get() })); }

  get(key, options) { return this.find(key, options).get(); }

  async set(key, value, options) {
    const entry = this.find(key, options);
    await entry.set(coerce(entry, value));
    return { key, value: entry.get() };
  }
}

export function missingSetting(key, repository, global = false) {
  if (global) return `${key} is a global setting, not one of ${repository}. Leave out the repository (--repo).`;
  return `No setting ${key}${repository ? ` for ${repository}` : ''}. List them with dispatch settings${repository ? ` --repo ${repository}` : ''}.`;
}

// The CLI sends text; a typed setting takes the value its type needs.
export function coerce(entry, value) {
  if (typeof value !== 'string') return value;
  if (entry.type === 'boolean' && ['true', 'false', 'on', 'off'].includes(value)) return value === 'true' || value === 'on';
  if (entry.type === 'integer' && /^-?\d+$/.test(value)) return Number(value);
  if (entry.type === 'json') { try { return JSON.parse(value); } catch { throw new InputError(`${entry.key} takes JSON.`); } }
  if (entry.type === 'enum' && !entry.values.includes(value)) throw new InputError(`${entry.key} is one of: ${entry.values.join(', ')}.`);
  return value;
}
