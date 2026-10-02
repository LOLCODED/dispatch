import { describeConnector, exposedToolName, validateConnector } from './contract.mjs';

export class ConnectorRegistry {
  constructor(list = [], { builtIn = [] } = {}) {
    this.list = []; this.builtIn = new Set();
    for (const connector of builtIn) this.add(connector, { builtIn: true });
    for (const connector of list) this.add(connector);
  }
  get(id) { return this.list.find(connector => connector.id === id) ?? null; }
  ids() { return this.list.map(connector => connector.id); }
  add(connector, { builtIn = false } = {}) {
    validateConnector(connector);
    if (this.get(connector.id)) throw new Error(`A connector with id ${connector.id} is already loaded.`);
    this.list = [...this.list, connector];
    if (builtIn) this.builtIn.add(connector.id);
    return connector;
  }
  remove(id) {
    if (this.builtIn.has(id)) throw new Error(`${id} is built in and cannot be removed.`);
    this.list = this.list.filter(connector => connector.id !== id);
  }
  hook(id, name) {
    const connector = this.get(id);
    for (const [action, spec] of Object.entries(connector?.actions ?? {})) if (spec.hooks?.[name]) return { connector, action, access: spec.access, run: spec.hooks[name] };
    return null;
  }
  tools() {
    return this.list.flatMap(connector => Object.entries(connector.actions).flatMap(([action, spec]) => Object.entries(spec.tools ?? {}).map(([name, tool]) => ({ connector, action, access: spec.access, name: exposedToolName(connector, name), tool }))));
  }
  withHook(name) { return this.list.map(connector => this.hook(connector.id, name)).filter(Boolean); }
  describe() { return this.list.map(connector => describeConnector(connector, { builtIn: this.builtIn.has(connector.id) })); }
}
