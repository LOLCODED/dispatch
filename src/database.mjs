import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from './engine.mjs';
import { localEnvironment } from './local-tools.mjs';
import { runProcess } from './process.mjs';
import { tableView } from './views.mjs';

const envLine = /^([A-Za-z_][A-Za-z0-9_]{0,63})=(.*)$/;
const maxText = 24000, queryTimeoutMs = 20000, variable = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/, connectorId = /^[a-z][a-z0-9]{1,30}$/;

export const sqlTool = {
  name: 'dispatch_sql', kind: 'sql',
  description: 'Run one query against one of this repository’s databases and see the rows. Databases the operator marked read only refuse changes; schema changes belong in migration files. Results are shown to the operator.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', maxLength: 20000 }, database: { type: 'string', maxLength: 31, description: 'Which database, by the name in your instructions; may be left out when there is only one.' } } },
};

export function commandParts(value, what) {
  const parts = typeof value === 'string' ? value.trim().split(/\s+/).filter(Boolean) : [value?.command, ...(value?.args ?? [])];
  if (!parts[0] || parts.length > 40 || parts.some(part => typeof part !== 'string' || !part || part.length > 500)) throw new InputError(`${what} needs a program and its arguments.`);
  return { command: parts[0], args: parts.slice(1) };
}

function connectionSettings(value) {
  if (value?.from === 'connector') {
    if (!connectorId.test(value.connector ?? '') || !variable.test(value.variable ?? 'DATABASE_URL')) throw new InputError('A connector connection names the connector and the variable it fills.');
    return { from: 'connector', connector: value.connector, variable: value.variable ?? 'DATABASE_URL' };
  }
  const variables = [value?.variable ?? value?.variables].flat().filter(Boolean);
  if (typeof value?.envFile !== 'string' || !value.envFile.trim() || value.envFile.includes('..') || value.envFile.startsWith('/') || !variables.length || variables.some(name => !variable.test(name))) throw new InputError('A database needs an env file inside the repository and the variables to read from it, such as DATABASE_URL.');
  return { from: 'envFile', envFile: value.envFile.trim(), variables };
}

function commandsSettings(value) {
  if (!value) return null;
  return { query: commandParts(value.query, 'The query command'), format: value.format === 'tsv' ? 'tsv' : 'csv', ...(typeof value.null === 'string' && value.null ? { null: value.null.slice(0, 20) } : {}) };
}

function envTemplate(lines) {
  const listed = lines && typeof lines === 'object' && !Array.isArray(lines) ? Object.entries(lines).map(([name, value]) => `${name}=${value}`) : Array.isArray(lines) ? lines : String(lines ?? '').split('\n');
  const entries = listed.map(line => line.trim()).filter(Boolean).map(line => line.match(envLine));
  if (!entries.length || entries.some(entry => !entry)) throw new InputError('Commands give the task database’s variables one per line as NAME=value, for example DATABASE_URL=<scheme>://127.0.0.1:{port}/app_{task}.');
  return Object.fromEntries(entries.map(([, name, value]) => [name, value]));
}

export function perTaskSettings(value) {
  if (value === undefined || value === null || value === false) return null;
  if (value.provider !== 'commands' && !connectorId.test(value.provider ?? '')) throw new InputError('A task database comes from a connector or from commands.');
  const migrate = value.migrate ? commandParts(value.migrate, 'The migrate command') : null;
  if (value.provider !== 'commands') return { provider: value.provider, migrate };
  if (Boolean(value.snapshot) !== Boolean(value.changes)) throw new InputError('Database changes need both a snapshot command and a changes command.');
  const changes = value.snapshot ? { snapshot: commandParts(value.snapshot, 'The snapshot command'), changes: commandParts(value.changes, 'The changes command') } : {};
  return { provider: 'commands', migrate, create: commandParts(value.create, 'The create command'), drop: commandParts(value.drop, 'The drop command'), env: envTemplate(value.env), ...changes };
}

export const accessLevels = ['none', 'read', 'write'];
const databaseName = /^[a-z][a-z0-9-]{0,30}$/, optionValue = value => typeof value === 'boolean' || (typeof value === 'string' && value.length <= 500);

function connectorOptions(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 30 || Object.entries(value).some(([key, entry]) => !/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key) || !optionValue(entry))) throw new InputError('Connector options are short text or on/off values.');
  return { ...value };
}

function connectionOf(value, legacy) {
  if (legacy) return connectionSettings(value.source === 'connector' ? { from: 'connector', connector: value.connector } : value);
  const connection = connectionSettings(value.connection);
  return connection.from === 'connector' ? { ...connection, options: connectorOptions(value.connection.options) } : connection;
}

function databaseEntry(value, fallbackName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Each database is an object.');
  const legacy = !value.connection, name = value.name ?? fallbackName, access = value.access ?? 'read';
  if (!databaseName.test(name ?? '')) throw new InputError('A database name is short lowercase letters, digits and dashes, such as local or staging.');
  if (!accessLevels.includes(access)) throw new InputError('Database access is none, read or write.');
  const engine = value.engine === undefined || value.engine === null || value.engine === '' ? null : value.engine;
  if (engine !== null && engine !== 'commands' && !connectorId.test(engine)) throw new InputError('The database engine is a connector id or commands.');
  const commands = commandsSettings(value.commands);
  if (engine === 'commands' && !commands) throw new InputError('The commands engine needs a query command.');
  const perTask = perTaskSettings(value.perTask);
  return { name, access, engine, connection: connectionOf(value, legacy), ...(commands ? { commands } : {}), ...(perTask ? { perTask } : {}) };
}

// A repository saved before named databases held one { engine, connection } (or only a connection); it becomes the read-only database "default".
export function databasesSettings(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  if (list.length > 10) throw new InputError('A repository has at most 10 databases.');
  const entries = list.map((entry, index) => databaseEntry(entry, index ? `db${index + 1}` : 'default'));
  if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw new InputError('Database names must be unique.');
  if (entries.filter(entry => entry.perTask).length > 1) throw new InputError('Only one database can be copied for each task.');
  return entries;
}
export const projectDatabases = project => databasesSettings(project?.databases ?? project?.database);
export const databaseSettings = value => databasesSettings(value)[0] ?? null;

export function envFileValues(workspace, envFile, names) {
  let text; try { text = readFileSync(join(workspace, envFile), 'utf8'); } catch { throw new Error(`${envFile} is not in this worktree. Add it under Copied from your checkout.`); }
  const values = {};
  for (const line of text.split('\n')) {
    const match = line.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && names.includes(match[1])) values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  const missing = names.filter(name => !values[name]);
  if (missing.length) throw new Error(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set in ${envFile}.`);
  return values;
}

// Database CLIs' CSV output quotes fields holding the delimiter, quotes or newlines and double inner quotes (RFC 4180).
export function parseDelimited(text, delimiter = ',') {
  const records = [];
  let record = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) { record.push(field); field = ''; }
    else if (char === '\n') { record.push(field); records.push(record); record = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field || record.length) { record.push(field); records.push(record); }
  return records;
}

export function textTable(columns, rows) {
  if (!columns.length) return '(no rows returned)';
  const shown = cell => cell === null ? 'NULL' : String(cell).replaceAll('\n', '\\n');
  const widths = columns.map((column, index) => Math.min(60, Math.max(column.length, ...rows.map(row => shown(row[index]).length))));
  const line = cells => cells.map((cell, index) => shown(cell).slice(0, 60).padEnd(widths[index])).join(' | ').trimEnd();
  return [line(columns), widths.map(width => '-'.repeat(width)).join('-+-'), ...rows.map(line), `(${rows.length} row${rows.length === 1 ? '' : 's'})`].join('\n');
}

const redacted = (text, env) => Object.values(env).filter(value => value.length >= 8).reduce((output, secret) => output.split(secret).join('<database>'), String(text ?? ''));
const capped = text => text.length > maxText ? `${text.slice(0, maxText)}\n… ${text.length - maxText} more characters` : text;

const readable = entry => entry.access !== 'none';
const describe = entry => `${entry.name} (${entry.access === 'write' ? 'read and write' : 'read only'}${entry.perTask ? '; this task’s own copy' : ''})`;
export const databasesBrief = entries => entries.filter(readable).length ? ` Databases for dispatch_sql (pass database by name): ${entries.filter(readable).map(describe).join('; ')}. Never change a database you can only read.` : '';

// Routes each of a repository's named databases to the connector that speaks its engine, or to the operator's own commands; core knows no engine.
// A connector with database.connect may hold a tunnel open; it stays open for the run and closes when the run's turn ends.
export class Databases {
  constructor(live, { execute = runProcess } = {}) { this.live = live; this.execute = execute; this.connected = new Map(); }

  available(project) { return projectDatabases(project).filter(readable); }

  entry(project, name) {
    const entries = this.available(project);
    if (!entries.length) throw new Error('This repository has no database the agent may use.');
    if (!name) { if (entries.length === 1) return entries[0]; throw new Error(`Name the database: ${entries.map(entry => entry.name).join(', ')}.`); }
    const found = projectDatabases(project).find(entry => entry.name === name);
    if (!found) throw new Error(`No database called ${name}. Use one of ${entries.map(entry => entry.name).join(', ')}.`);
    if (!readable(found)) throw new Error(`The operator does not allow the agent to use ${name}.`);
    return found;
  }

  engine(entry) {
    if (entry.engine) return entry.engine;
    const engines = this.live.connectors.registry.withHook('database.query');
    if (engines.length === 1) return engines[0].connector.id;
    throw new Error(engines.length ? `Choose which database connector ${entry.name} uses under Extras › Databases.` : 'No connector that runs database queries is loaded; add one or set query commands under Extras › Databases.');
  }

  hookContext(entry) { return { name: entry.name, options: entry.connection.options ?? {} }; }

  // source reads the operator's checkout: the worktree's copy of the env file points at the task's own database once it has one.
  async connectionEnv(run, entry, signal, { source = false } = {}) {
    const { connection } = entry;
    if (connection.from === 'envFile') return envFileValues(source ? run.project.repositoryPath : run.workspace, connection.envFile, connection.variables);
    if (this.live.connectors.registry.hook(connection.connector, 'database.connect')) return this.connect(run, entry, signal);
    const url = String(await this.live.connectors.invoke(run.project, connection.connector, 'database.url', [], { signal, database: this.hookContext(entry) }) ?? '').trim();
    if (!url) throw new Error(`The ${connection.connector} connector returned no connection for ${entry.name}.`);
    return { [connection.variable]: url };
  }

  async connect(run, entry, signal) {
    const key = `${run.id}:${entry.name}`;
    if (!this.connected.has(key)) {
      const opening = this.live.connectors.invoke(run.project, entry.connection.connector, 'database.connect', [{ run: run.id, workspace: run.workspace }], { signal, database: this.hookContext(entry) }).then(result => {
        const env = Object.fromEntries(Object.entries(result?.env ?? {}).filter(([name, value]) => variable.test(name) && typeof value === 'string'));
        if (!Object.keys(env).length) throw new Error(`The ${entry.connection.connector} connector opened no connection for ${entry.name}.`);
        this.live.log(run, 'database', `Connected to ${entry.name} through ${this.live.connectors.registry.get(entry.connection.connector)?.name ?? entry.connection.connector}.`);
        return { env, entry, project: run.project };
      });
      this.connected.set(key, opening);
      opening.catch(() => this.connected.delete(key));
    }
    return (await this.connected.get(key)).env;
  }

  async disconnect(run) {
    for (const [key, opening] of [...this.connected].filter(([key]) => key.startsWith(`${run.id}:`))) {
      this.connected.delete(key);
      const open = await opening.catch(() => null);
      if (open) await this.live.connectors.invoke(open.project, open.entry.connection.connector, 'database.disconnect', [{ run: run.id }], { database: this.hookContext(open.entry) }).catch(error => this.live.log(run, 'database', `Could not close ${open.entry.name}: ${error.message}`));
    }
  }

  async query(run, entry, sql, signal) {
    const taskEnv = entry.perTask ? this.live.taskDatabases?.env(run) ?? {} : {}, env = { ...await this.connectionEnv(run, entry, signal), ...taskEnv }, engine = this.engine(entry), readOnly = entry.access !== 'write';
    try {
      const { columns, rows } = engine === 'commands' ? await this.commandQuery(run, entry, sql, env, signal) : await this.live.connectors.invoke(run.project, engine, 'database.query', [{ sql, env, workspace: run.workspace, readOnly }], { signal, database: this.hookContext(entry) });
      return { columns: (columns ?? []).map(String), rows: (rows ?? []).map(row => row.map(cell => cell === null || cell === undefined ? null : redacted(cell, env))) };
    } catch (error) { throw new Error(redacted(error.message, env)); }
  }

  async commandQuery(run, entry, sql, env, signal) {
    const { query, format, null: nullMarker } = entry.commands;
    const args = query.args.includes('{sql}') ? query.args.map(arg => arg === '{sql}' ? sql : arg) : [...query.args, sql];
    const result = await this.execute(query.command, args, { cwd: run.workspace, signal, timeoutMs: queryTimeoutMs, inheritEnv: false, env: localEnvironment(env) });
    if (result.exitCode !== 0 || result.timedOut) throw new Error(String(result.output ?? '').trim() || `${query.command} exited with ${result.exitCode}.`);
    const [columns = [], ...records] = parseDelimited(String(result.output ?? ''), format === 'tsv' ? '\t' : ',');
    return { columns, rows: records.map(record => record.map(cell => nullMarker !== undefined && cell === nullMarker ? null : cell)) };
  }

  async call(run, args, { signal } = {}) {
    let entry;
    try {
      entry = this.entry(run.project, args.database);
      const { columns, rows } = await this.query(run, entry, args.query, signal);
      return { content: [{ type: 'text', text: capped(textTable(columns, rows)) }], isError: false, view: { ...tableView(columns, rows, { query: args.query }), label: 'SQL', title: entry.name } };
    } catch (error) {
      return { content: [{ type: 'text', text: capped(error.message) }], isError: true, view: { type: 'table', label: 'SQL', ...(entry ? { title: entry.name } : {}), columns: [], rows: [], query: args.query, error: error.message } };
    }
  }
}
