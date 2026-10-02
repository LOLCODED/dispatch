import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connectorApi } from './api.mjs';
import { describeConnector, validateConnector } from './contract.mjs';

async function manifest(folder) {
  try { return JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error(`${join(folder, 'package.json')} is not valid JSON.`); }
}

export async function connectorEntry(folder) {
  if (typeof folder !== 'string' || !isAbsolute(folder)) throw new Error('Give the absolute path of the connector folder.');
  const root = resolve(folder), relative = (await manifest(root)).dispatch?.connector ?? './index.mjs';
  if (typeof relative !== 'string') throw new Error('package.json dispatch.connector must be a path.');
  const entry = resolve(root, relative);
  if (!entry.startsWith(root + sep)) throw new Error('The connector entry must be inside its folder.');
  if (!(await stat(entry).catch(() => null))?.isFile()) throw new Error(`No connector entry at ${entry}.`);
  return entry;
}

export async function loadConnector(folder, { api = connectorApi(), importModule = url => import(url) } = {}) {
  const entry = await connectorEntry(folder), module = await importModule(pathToFileURL(entry).href);
  if (typeof module.default !== 'function') throw new Error(`${entry} must export a default createConnector(dispatch) function.`);
  return validateConnector(await module.default(api));
}

// Third-party connectors run in this process with the operator's permissions; they load only from folders the operator added.
export class ConnectorPlugins {
  constructor(store, registry, { load = loadConnector } = {}) {
    this.store = store; this.registry = registry; this.load = load; this.failures = new Map();
    store.state.connectorPlugins ??= [];
  }
  get entries() { return this.store.state.connectorPlugins; }
  async loadBuiltIn(folders) {
    for (const folder of folders) {
      try { this.registry.add(await this.load(folder), { builtIn: true }); }
      catch (error) { this.failures.set(folder, error.message); }
    }
  }
  async loadAll() {
    for (const entry of this.entries) {
      try { const connector = this.registry.add(await this.load(entry.path)); entry.id = connector.id; this.failures.delete(entry.path); }
      catch (error) { this.failures.set(entry.path, error.message); }
    }
  }
  builtInFailures() { return [...this.failures].filter(([path]) => !this.entries.some(entry => entry.path === path)).map(([path, error]) => ({ path, error })); }
  list() {
    return this.entries.map(entry => {
      const connector = entry.id ? this.registry.get(entry.id) : null;
      return { path: entry.path, id: entry.id ?? null, name: connector?.name ?? null, loaded: Boolean(connector), error: this.failures.get(entry.path) ?? null, ...(connector ? { connector: describeConnector(connector) } : {}) };
    });
  }
  async add(path) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Give the absolute path of the connector folder.');
    const folder = resolve(path);
    if (this.entries.some(entry => entry.path === folder)) throw new Error(`${folder} is already added.`);
    const connector = this.registry.add(await this.load(folder));
    this.entries.push({ path: folder, id: connector.id }); this.store.save();
    return this.list().find(entry => entry.path === folder);
  }
  remove(id) {
    const entry = this.entries.find(item => item.id === id || item.path === id);
    if (!entry) return null;
    if (entry.id && this.registry.get(entry.id)) this.registry.remove(entry.id);
    this.failures.delete(entry.path);
    this.store.state.connectorPlugins = this.entries.filter(item => item !== entry); this.store.save();
    return { path: entry.path, id: entry.id ?? null };
  }
}
