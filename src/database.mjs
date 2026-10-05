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
  description: 'Run one query against this repository’s development database and see the rows. Use it to read data and check behaviour; schema and data changes belong in migration files. Results are shown to the operator.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', maxLength: 20000 } } },
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
  if (!entries.length || entries.some(entry => !entry)) throw new InputError('Commands give the task database’s variables one per line as NAME=value, for example DATABASE_URL=postgres://localhost:{port}/app_{task}.');
  return Object.fromEntries(entries.map(([, name, value]) => [name, value]));
}

export function perTaskSettings(value) {
  if (value === undefined || value === null || value === false) return null;
  if (value.provider !== 'commands' && !connectorId.test(value.provider ?? '')) throw new InputError('A task database comes from a connector or from commands.');
  const migrate = value.migrate ? commandParts(value.migrate, 'The migrate command') : null;
  if (value.provider !== 'commands') return { provider: value.provider, migrate };
  return { provider: 'commands', migrate, create: commandParts(value.create, 'The create command'), drop: commandParts(value.drop, 'The drop command'), env: envTemplate(value.env) };
}

// Older settings held only the connection ({ envFile, variable } or { source: 'connector', connector }); they keep working with the default engine.
export function databaseSettings(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new InputError('Database settings must be an object.');
  const legacy = !value.connection;
  const connection = connectionSettings(legacy ? (value.source === 'connector' ? { from: 'connector', connector: value.connector } : value) : value.connection);
  const engine = value.engine === undefined || value.engine === null || value.engine === '' ? null : value.engine;
  if (engine !== null && engine !== 'commands' && !connectorId.test(engine)) throw new InputError('The database engine is a connector id or commands.');
  const commands = commandsSettings(value.commands);
  if (engine === 'commands' && !commands) throw new InputError('The commands engine needs a query command.');
  const perTask = perTaskSettings(value.perTask);
  return { engine, connection, ...(commands ? { commands } : {}), ...(perTask ? { perTask } : {}) };
}

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

// psql --csv and similar tools quote fields holding the delimiter, quotes or newlines and double inner quotes (RFC 4180).
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

// Routes a repository's database to the connector that speaks its engine, or to the operator's own commands; core knows no engine.
export class Databases {
  constructor(live, { execute = runProcess } = {}) { this.live = live; this.execute = execute; }

  engine(project) {
    const chosen = databaseSettings(project.database)?.engine;
    if (chosen) return chosen;
    const engines = this.live.connectors.registry.withHook('database.query');
    if (engines.length === 1) return engines[0].connector.id;
    throw new Error(engines.length ? 'Choose which database connector this repository uses under Extras › Database.' : 'No connector that runs database queries is loaded; add one or set query commands under Extras › Database.');
  }

  // source reads the operator's checkout: the worktree's copy of the env file points at the task's own database once it has one.
  async connectionEnv(run, signal, { source = false } = {}) {
    const { connection } = databaseSettings(run.project.database);
    if (connection.from === 'envFile') return envFileValues(source ? run.project.repositoryPath : run.workspace, connection.envFile, connection.variables);
    const url = String(await this.live.connectors.invoke(run.project, connection.connector, 'database.url', [], { signal }) ?? '').trim();
    if (!url) throw new Error(`The ${connection.connector} connector returned no connection.`);
    return { [connection.variable]: url };
  }

  async query(run, sql, signal) {
    const env = { ...await this.connectionEnv(run, signal), ...this.live.taskDatabases?.env(run) }, engine = this.engine(run.project);
    try {
      const { columns, rows } = engine === 'commands' ? await this.commandQuery(run, sql, env, signal) : await this.live.connectors.invoke(run.project, engine, 'database.query', [{ sql, env, workspace: run.workspace }], { signal });
      return { columns: (columns ?? []).map(String), rows: (rows ?? []).map(row => row.map(cell => cell === null || cell === undefined ? null : redacted(cell, env))) };
    } catch (error) { throw new Error(redacted(error.message, env)); }
  }

  async commandQuery(run, sql, env, signal) {
    const { query, format, null: nullMarker } = databaseSettings(run.project.database).commands;
    const args = query.args.includes('{sql}') ? query.args.map(arg => arg === '{sql}' ? sql : arg) : [...query.args, sql];
    const result = await this.execute(query.command, args, { cwd: run.workspace, signal, timeoutMs: queryTimeoutMs, inheritEnv: false, env: localEnvironment(env) });
    if (result.exitCode !== 0 || result.timedOut) throw new Error(String(result.output ?? '').trim() || `${query.command} exited with ${result.exitCode}.`);
    const [columns = [], ...records] = parseDelimited(String(result.output ?? ''), format === 'tsv' ? '\t' : ',');
    return { columns, rows: records.map(record => record.map(cell => nullMarker !== undefined && cell === nullMarker ? null : cell)) };
  }

  async call(run, args, { signal } = {}) {
    if (!run.project?.database) throw new Error('This repository has no database set up for queries.');
    try {
      const { columns, rows } = await this.query(run, args.query, signal);
      return { content: [{ type: 'text', text: capped(textTable(columns, rows)) }], isError: false, view: { ...tableView(columns, rows, { query: args.query }), label: 'SQL' } };
    } catch (error) {
      return { content: [{ type: 'text', text: capped(error.message) }], isError: true, view: { type: 'table', label: 'SQL', columns: [], rows: [], query: args.query, error: error.message } };
    }
  }
}
