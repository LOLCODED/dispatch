import { ClaudeAdapter } from './claude.mjs';
import { InputError } from './engine.mjs';
import { OpencodeAdapter } from './opencode.mjs';
import { PiAdapter } from './pi.mjs';

export const minimumContext = 32768, smallContext = 65536;
const endpointLimit = 8;
const kinds = ['ollama', 'server'];
export const localAgents = ['claude', 'opencode', 'pi'];
const modelName = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;
const endpointId = /^[a-z0-9][a-z0-9-]{0,23}$/;
const loadTimeoutMs = 600000;

export function ollamaBase(host = process.env.OLLAMA_HOST) {
  if (!host) return 'http://127.0.0.1:11434';
  const url = new URL(/^https?:\/\//.test(host) ? host : `http://${host}`);
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
  if (!url.port && url.protocol === 'http:') url.port = '11434';
  return url.origin;
}

export const defaultEndpoints = () => [{ id: 'ollama', name: 'Ollama', kind: 'ollama', url: ollamaBase() }];

function endpointUrl(value) {
  let url; try { url = new URL(value); } catch { url = null; }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new InputError('Enter an http:// or https:// endpoint URL without credentials or a query.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'endpoint';

function uniqueId(entry, taken) {
  if (typeof entry.id === 'string' && endpointId.test(entry.id) && !taken.has(entry.id)) return entry.id;
  const base = slug(entry.name);
  let id = base; for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function endpointList(value) {
  if (!Array.isArray(value) || value.length > endpointLimit) throw new InputError(`Local endpoints are a list of at most ${endpointLimit}.`);
  const taken = new Set();
  return value.map(entry => {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (!name || name.length > 40 || !kinds.includes(entry.kind) || typeof entry.url !== 'string' || entry.url.length > 200) throw new InputError('Each endpoint needs a name (up to 40 characters), a kind (ollama or server) and a URL.');
    const id = uniqueId({ ...entry, name }, taken); taken.add(id);
    return { id, name, kind: entry.kind, url: endpointUrl(entry.url.trim()) };
  });
}

export const localModelId = (endpoint, model) => `${endpoint.id}/${model}`;
export function resolveLocalModel(value, endpoints) {
  const at = typeof value === 'string' ? value.indexOf('/') : -1;
  const endpoint = at > 0 ? endpoints.find(item => item.id === value.slice(0, at)) : null;
  const model = at > 0 ? value.slice(at + 1) : '';
  return endpoint && modelName.test(model) ? { endpoint, model } : null;
}

// The placeholder token replaces the Claude login so nothing reaches Anthropic; every model alias maps to the local model
// so background requests do not ask the server for a Claude model, and the window makes Claude Code compact before the server truncates.
export function claudeProviderEnv(endpoint, model, contextWindow = null) {
  const env = { ANTHROPIC_BASE_URL: endpoint.url, ANTHROPIC_AUTH_TOKEN: 'dispatch-local', ANTHROPIC_API_KEY: '', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ANTHROPIC_DEFAULT_HAIKU_MODEL: model, ANTHROPIC_DEFAULT_SONNET_MODEL: model, ANTHROPIC_DEFAULT_OPUS_MODEL: model };
  return contextWindow ? { ...env, CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(contextWindow) } : env;
}

const localProvider = 'dispatch_local';
const openaiBase = endpoint => `${endpoint.url}/v1`;
export function opencodeProvider(endpoint, model, contextWindow = null) {
  return { provider: { [localProvider]: { npm: '@ai-sdk/openai-compatible', name: endpoint.name, options: { baseURL: openaiBase(endpoint) }, models: { [model]: { name: model, tool_call: true, ...(contextWindow ? { limit: { context: contextWindow, output: 8192 } } : {}) } } } } };
}
// Local models run in a context a single recursive listing can fill (pi's first call was a 27 KB ls -R into 32k).
export function smallContextPrompt(prompt, size) {
  if (!size || size > smallContext || typeof prompt !== 'string') return prompt;
  return `${prompt}\nThis model has a ${size}-token context, so keep every command's output small: list files with git ls-files <folder> or a targeted find, never ls -R or a search over the whole tree, and read long files in parts.\n`;
}

export function piProvider(endpoint, model, contextWindow = null) {
  return { providers: { [localProvider]: { api: 'openai-completions', apiKey: 'dispatch-local', baseUrl: openaiBase(endpoint), models: [{ id: model, input: ['text'], ...(contextWindow ? { contextWindow } : {}) }] } } };
}

export function contextFix(model, endpoint, size) {
  return `${model} on ${endpoint.name} runs with a ${size}-token context; agent tools need at least ${minimumContext}. Raise it on the Ollama server (OLLAMA_CONTEXT_LENGTH=${minimumContext} in its environment, e.g. systemctl edit ollama or docker run -e), or create a variant with PARAMETER num_ctx ${minimumContext}, then refresh models.`;
}

async function request(fetchJson, url, { body, signal, timeoutMs = 5000 } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetchJson(url, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error(`returned ${response.status}`);
  return response.json();
}

const ollama = {
  async version(fetchJson, endpoint) { return `Ollama ${String((await request(fetchJson, `${endpoint.url}/api/version`)).version ?? 'unknown').slice(0, 40)}`; },
  async models(fetchJson, endpoint) {
    const tags = await request(fetchJson, `${endpoint.url}/api/tags`);
    const names = (Array.isArray(tags?.models) ? tags.models : []).map(model => model?.name).filter(name => typeof name === 'string' && modelName.test(name)).slice(0, 50);
    const described = await Promise.all(names.map(async name => {
      try { return { name, tools: (await request(fetchJson, `${endpoint.url}/api/show`, { body: { model: name } })).capabilities?.includes('tools') === true }; }
      catch { return { name, tools: false }; }
    }));
    return { names: described.filter(model => model.tools).map(model => model.name), hidden: names.length - described.filter(model => model.tools).length };
  },
  // Loading with no options gives the same context the OpenAI-compatible endpoint will use; /api/ps then reports it.
  async context(fetchJson, endpoint, model, signal) {
    await request(fetchJson, `${endpoint.url}/api/generate`, { body: { model, keep_alive: '30m' }, signal, timeoutMs: loadTimeoutMs });
    const loaded = (await request(fetchJson, `${endpoint.url}/api/ps`, { signal }))?.models ?? [];
    const size = loaded.find(item => item?.name === model || item?.model === model)?.context_length;
    return Number.isInteger(size) && size > 0 ? size : null;
  },
};

const server = {
  async version(fetchJson, endpoint) { await request(fetchJson, `${endpoint.url}/v1/models`); return 'Local server'; },
  async models(fetchJson, endpoint) {
    const listed = await request(fetchJson, `${endpoint.url}/v1/models`);
    return { names: (Array.isArray(listed?.data) ? listed.data : []).map(model => model?.id).filter(name => typeof name === 'string' && modelName.test(name)).slice(0, 50), hidden: 0 };
  },
  async context() { return null; },
};

const clients = { ollama, server };
const failed = (summary, sessionId) => ({ outcome: 'failed', sessionId, summary, usage: null });

async function endpointModels(fetchJson, endpoint) {
  try {
    const { names, hidden } = await clients[endpoint.kind].models(fetchJson, endpoint);
    return { models: names.map(name => ({ model: localModelId(endpoint, name), displayName: `${name} · ${endpoint.name}`, isDefault: false, defaultReasoningEffort: null, supportedReasoningEfforts: [] })), note: `${endpoint.name}: ${names.length} model${names.length === 1 ? '' : 's'}${hidden ? `, ${hidden} without tool support hidden` : ''}.` };
  } catch { return { models: [], note: `${endpoint.name} is not reachable at ${endpoint.url}.` }; }
}

const agentNames = { claude: 'Claude Code', opencode: 'OpenCode', pi: 'pi' };
// Sessions belong to one agent CLI; a follow-up after the operator switches agents starts a fresh session.
export function localSession(value) {
  const match = typeof value === 'string' && value.match(/^(claude|opencode|pi):(.+)$/);
  return match ? { agent: match[1], id: match[2] } : { agent: value ? 'claude' : null, id: value ?? undefined };
}
// A model only produces text; one of these agent CLIs turns it into edits, commands and dispatch tool calls.
// Codex is not offered: it sends MCP tools as Responses namespaces, which local servers drop.
const harnesses = {
  claude: (adapters, options, { endpoint, model }, size) => adapters.claude.run({ ...options, execution: { ...options.execution, model, effort: null } }, claudeProviderEnv(endpoint, model, size)),
  opencode: (adapters, options, { endpoint, model }, size) => adapters.opencode.run({ ...options, execution: { ...options.execution, model: `${localProvider}/${model}`, effort: null } }, opencodeProvider(endpoint, model, size)),
  pi: (adapters, options, { endpoint, model }, size) => adapters.pi.run({ ...options, execution: { ...options.execution, model: `${localProvider}/${model}`, effort: null } }, { models: piProvider(endpoint, model, size) }),
};

export class LocalModelAdapter {
  constructor({ endpoints = defaultEndpoints, agent = () => 'claude', fetchJson = (...args) => fetch(...args), claude = new ClaudeAdapter(), opencode = new OpencodeAdapter(), pi = new PiAdapter() } = {}) {
    this.endpoints = endpoints; this.agent = agent; this.fetchJson = fetchJson; this.adapters = { claude, opencode, pi };
  }
  get harness() { const id = localAgents.includes(this.agent()) ? this.agent() : 'claude'; return { id, name: agentNames[id], adapter: this.adapters[id] }; }
  get contract() { return this.harness.adapter.contract; }
  async capabilities() {
    const { name, adapter } = this.harness, version = await adapter.version();
    if (!version) return { available: false, authenticated: false, detail: `Local models run through ${name}, chosen below. Install it, then refresh; no account is needed.` };
    const endpoints = this.endpoints();
    const probes = await Promise.all(endpoints.map(endpoint => clients[endpoint.kind].version(this.fetchJson, endpoint).then(found => ({ endpoint, found }), () => ({ endpoint, found: null }))));
    const reachable = probes.filter(probe => probe.found);
    const detail = probes.map(({ endpoint, found }) => found ? `${endpoint.name} at ${endpoint.url}.` : `${endpoint.name} is not reachable at ${endpoint.url}.`).join(' ');
    return { available: reachable.length > 0, authenticated: true, version: `${reachable.map(probe => probe.found).join(', ') || 'No endpoint reachable'} · ${version}`, detail: detail || 'Add an endpoint below.', endpoints: probes.map(({ endpoint, found }) => ({ id: endpoint.id, reachable: Boolean(found), version: found })) };
  }
  async models() {
    const reports = await Promise.all(this.endpoints().map(endpoint => endpointModels(this.fetchJson, endpoint)));
    const models = reports.flatMap(report => report.models);
    if (models[0]) models[0] = { ...models[0], isDefault: true };
    return { available: models.length > 0, models, message: reports.map(report => report.note).join(' ') || 'Add a local endpoint in Settings → Providers.' };
  }
  async contextWindow({ endpoint, model }, signal) {
    try { return { size: await clients[endpoint.kind].context(this.fetchJson, endpoint, model, signal) }; }
    catch (error) { return { error: signal?.aborted ? null : `${endpoint.name} could not load ${model} (${error.message}).` }; }
  }
  async run(options) {
    const target = resolveLocalModel(options.execution?.model, this.endpoints());
    if (!target) return failed('Choose a local model from a saved endpoint before dispatching.', options.sessionId);
    const context = await this.contextWindow(target, options.signal);
    if (options.signal?.aborted) return { outcome: 'cancelled', sessionId: options.sessionId };
    if (context.error) return failed(context.error, options.sessionId);
    if (context.size && context.size < minimumContext) return failed(contextFix(target.model, target.endpoint, context.size), options.sessionId);
    const { id } = this.harness, session = localSession(options.sessionId), prompt = smallContextPrompt(options.prompt, context.size);
    const tagged = value => value ? `${id}:${value}` : value;
    const result = await harnesses[id](this.adapters, { ...options, prompt, sessionId: session.agent === id ? session.id : undefined, onSession: value => options.onSession?.(tagged(value)) }, target, context.size);
    return { ...result, sessionId: tagged(result.sessionId) };
  }
}
