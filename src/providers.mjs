import { InputError } from './engine.mjs';

export const providerCatalog = [
  { id: 'codex', name: 'Codex' },
  { id: 'claude', name: 'Claude Code' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'pi', name: 'pi' },
  { id: 'local-models', name: 'Local models' },
];
const defaults = { claude: false, cursor: false, opencode: false, pi: false, 'local-models': false };

export const providerName = id => providerCatalog.find(provider => provider.id === id)?.name ?? 'Provider';
// What an adapter can carry, declared without any probe: questions by native request or the dispatch_question tool,
// dispatch tools over MCP, and whether read-only turns may carry tools at all.
export const defaultContract = { questions: 'none', tools: 'none', browserTools: 'none', sessions: false, streaming: false, readOnlyTurns: true, readOnlyTools: false, sandbox: true };

// Every harness other than an installed Codex needs explicit consent before dispatch probes it, lists its models, or starts a turn.
export class ProviderRegistry {
  constructor(store, adapters) { this.store = store; this.adapters = adapters; }
  get settings() {
    this.settleCodexDefault();
    return Object.fromEntries(providerCatalog.map(({ id }) => [id, this.store.state.providerSettings?.[id] ?? defaults[id]]));
  }
  // Codex starts on only where its CLI is installed; the first answer is saved so a later install never enables it implicitly.
  settleCodexDefault() {
    if (this.store.state.providerSettings?.codex !== undefined) return;
    this.store.state.providerSettings = { ...this.store.state.providerSettings, codex: this.adapters.codex?.installed?.() ?? true };
    this.store.save();
  }
  enabledIds() { return providerCatalog.map(provider => provider.id).filter(id => this.settings[id] === true && this.adapters[id]); }
  isEnabled(id) { return this.enabledIds().includes(id); }
  setEnabled(id, enabled) {
    if (!providerCatalog.some(provider => provider.id === id) || !this.adapters[id]) throw new InputError('Unknown provider.');
    if (typeof enabled !== 'boolean') throw new InputError('Enabled must be a boolean.');
    this.store.state.providerSettings = { ...this.store.state.providerSettings, [id]: enabled };
    this.store.save();
    return this.settings;
  }
  adapter(id) {
    if (!this.isEnabled(id)) throw new InputError(`${providerName(id)} is not enabled. Enable it in Settings → Providers.`);
    return this.adapters[id];
  }
  contract(id) { return { ...defaultContract, ...(this.adapter(id).contract ?? {}) }; }
  contracts() { return Object.fromEntries(this.enabledIds().map(id => [id, this.contract(id)])); }
  defaultProvider() { return this.enabledIds()[0] ?? null; }
}
