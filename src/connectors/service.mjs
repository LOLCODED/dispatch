import { delivers, runEvents } from './contract.mjs';
import { active, connectorSetting, globalConnectorSettings, permitted, projectConnectors, updateGlobal } from './settings.mjs';
import { textTicket } from '../local-tools.mjs';

const hookTimeoutMs = 60_000, statusTimeoutMs = 15_000;

export class ConnectorDisabledError extends Error {
  constructor(connector, ref) {
    super(`${connector.name} is not used by this repository. Enable it in repository settings, or paste the ticket text.`);
    this.tracker = connector.id; this.trackerName = connector.name; this.ref = ref;
  }
}

export class ConnectorNotPermitted extends Error {
  constructor(connector, action) { super(`${connector.actions[action]?.label ?? action} is switched off for ${connector.name}.`); this.connector = connector.id; this.action = action; this.status = 409; }
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); timer.unref?.(); })]).finally(() => clearTimeout(timer));
}

// Connectors decide what an action does; this service decides whether it may run and what each call can see.
export class ConnectorService {
  constructor({ registry, store, save = () => store.save(), log = () => {}, timeoutMs = hookTimeoutMs, projects = () => [] }) {
    this.registry = registry; this.store = store; this.save = save; this.log = log; this.timeoutMs = timeoutMs; this.projects = projects;
  }
  get global() { return globalConnectorSettings(this.store.state.connectorSettings); }
  describe() {
    const global = this.global;
    return this.registry.describe().map(connector => ({ ...connector, enabled: global[connector.id]?.enabled === true, actions: connector.actions.map(action => ({ ...action, enabled: permitted(null, global, this.registry.get(connector.id), action.id) })) }));
  }
  normalize(value) { return projectConnectors(value, this.registry); }
  setGlobal(id, input) {
    this.store.state.connectorSettings = updateGlobal(this.global, this.registry.get(id), input ?? {});
    this.save(); return this.describe().find(connector => connector.id === id);
  }
  active(project, id) { return active(project, this.registry.get(id)); }
  allows(project, id, hook) {
    const found = this.registry.hook(id, hook);
    return Boolean(found) && permitted(project, this.global, found.connector, found.action);
  }
  settings(project, connector) { return Object.fromEntries(Object.keys(connector.settings ?? {}).map(key => [key, connectorSetting(project, connector, key)])); }
  // Runs carry a snapshot of their repository; memory always lives on the saved repository.
  saved(project) { return (project?.id && this.projects().find(item => item.id === project.id)) || project; }
  memory(project, id) { return { ...this.saved(project)?.connectorMemory?.[id] }; }
  remember(project, id, values) {
    const target = this.saved(project);
    if (!target || !values || typeof values !== 'object' || Array.isArray(values)) return;
    target.connectorMemory = { ...target.connectorMemory, [id]: { ...target.connectorMemory?.[id], ...values } }; this.save();
  }
  context(project, connector, { signal, workspace } = {}) {
    return { signal, settings: this.settings(project, connector), memory: this.memory(project, connector.id), remember: values => this.remember(project, connector.id, values), ...(workspace && { workspace }) };
  }
  async invoke(project, id, hook, args, { signal, check = true } = {}) {
    const found = this.registry.hook(id, hook);
    if (!found) throw new Error(`${this.registry.get(id)?.name ?? id} cannot ${hook}.`);
    if (check && !permitted(project, this.global, found.connector, found.action)) throw new ConnectorNotPermitted(found.connector, found.action);
    return withTimeout(Promise.resolve(found.run(...args, this.context(project, found.connector, { signal }))), this.timeoutMs, `${found.connector.name} did not answer ${hook} within ${this.timeoutMs / 1000} s.`);
  }
  // Agent tools need the same two things as automatic hooks: the repository uses the connector and the action is permitted.
  agentTools(project, { readOnly = false } = {}) {
    return this.registry.tools()
      .filter(found => this.active(project, found.connector.id) && permitted(project, this.global, found.connector, found.action) && (!readOnly || found.access === 'read'))
      .map(found => ({ name: found.name, kind: 'connector', description: found.tool.description, inputSchema: found.tool.inputSchema }));
  }
  async callTool(project, name, args, { signal, workspace, readOnly = false } = {}) {
    const found = this.registry.tools().find(item => item.name === name);
    if (!found || !this.active(project, found.connector.id)) throw new Error(`No connector tool ${name} for this repository.`);
    if (!permitted(project, this.global, found.connector, found.action) || (readOnly && found.access !== 'read')) throw new ConnectorNotPermitted(found.connector, found.action);
    return withTimeout(Promise.resolve(found.tool.run(args, this.context(project, found.connector, { signal, workspace }))), this.timeoutMs, `${found.connector.name} did not answer ${name} within ${this.timeoutMs / 1000} s.`);
  }
  deliveryConnector(project) {
    const deliverers = this.registry.list.filter(delivers);
    return deliverers.find(connector => active(project, connector)) ?? (deliverers.length === 1 ? deliverers[0] : null);
  }
  inUse(projects, id) { return this.global[id]?.enabled === true || projects.some(project => this.active(project, id)); }
  async probe(connector) {
    if (typeof connector.status !== 'function') return { enabled: true, available: true, authenticated: true, detail: 'Loaded.' };
    try { const reported = await withTimeout(Promise.resolve(connector.status()), statusTimeoutMs, 'No answer within 15 s.'); return { authenticated: reported?.available === true, ...reported, enabled: true }; }
    catch (error) { return { enabled: true, available: false, authenticated: false, detail: `The connector could not report its status: ${error.message}` }; }
  }
  // A connector is asked for its status only once it is turned on somewhere, so an unused one costs nothing.
  async status(projects) {
    return Object.fromEntries(await Promise.all(this.registry.list.map(async connector => [connector.id, this.inUse(projects, connector.id) ? await this.probe(connector) : { enabled: false, available: false, authenticated: false, detail: `Off. Turn it on here or use ${connector.name} in a repository’s settings.` }])));
  }

  detect(input, project) {
    for (const { connector, run } of this.registry.withHook('ticket.detect')) {
      const ref = run(input, { memory: this.memory(project, connector.id) });
      if (ref) return { connector, ref: { ...ref, tracker: connector.id } };
    }
    return null;
  }
  identify(input, project) {
    const found = this.detect(input, project);
    if (found && !(this.active(project, found.connector.id) && this.allows(project, found.connector.id, 'ticket.read'))) throw new ConnectorDisabledError(found.connector, found.ref);
    return { connector: found?.connector.id ?? 'text', identity: found ? found.ref.sourceUrl ?? `${found.ref.organization ?? found.connector.id}:${found.ref.id}` : input.trim(), ref: found?.ref ?? null };
  }
  async intake(input, project) {
    const { connector, ref } = this.identify(input, project);
    if (!ref) return { ...textTicket(input), connector };
    const ticket = await this.invoke(project, connector, 'ticket.read', [ref]);
    if (!ticket || typeof ticket.title !== 'string' || !ticket.title.trim()) throw new Error(`${this.registry.get(connector).name} returned a ticket without a title.`);
    return { ...ref, ...ticket, tracker: connector, key: typeof ticket.key === 'string' && ticket.key ? ticket.key : `${connector}:${ref.id}`, connector };
  }

  emit(event, run, summary) {
    if (!runEvents.includes(event)) return;
    for (const { connector } of this.registry.withHook(event)) {
      if (!this.active(run.project, connector.id) || !this.allows(run.project, connector.id, event)) continue;
      this.invoke(run.project, connector.id, event, [structuredClone(summary)]).catch(error => this.log(run, `${connector.name} ${event} did not complete: ${error.message}`));
    }
  }
}
