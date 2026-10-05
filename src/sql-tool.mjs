import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from './engine.mjs';
import { localEnvironment } from './local-tools.mjs';
import { runProcess } from './process.mjs';
import { tableView } from './views.mjs';

const maxOutput = 24000, timeoutMs = 20000, variable = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export const sqlTool = {
  name: 'dispatch_sql', kind: 'sql',
  description: 'Run one read-only SQL query against this repository’s development database and see the rows. The session is read-only with a 15 s statement limit; write changes as .sql files instead. Results are shown to the operator.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', maxLength: 20000 } } },
};

const connectorId = /^[a-z][a-z0-9]{1,30}$/;

// The connection string comes from an env file in the task's copy, or from a connector (a secret store such as Key Vault).
export function databaseSettings(value) {
  if (value === undefined || value === null) return null;
  if (value?.source === 'connector') {
    if (!connectorId.test(value.connector ?? '') || Object.keys(value).some(key => !['source', 'connector'].includes(key))) throw new InputError('A connector database names the connector that provides it.');
    return { source: 'connector', connector: value.connector };
  }
  if (typeof value !== 'object' || Array.isArray(value) || typeof value.envFile !== 'string' || !value.envFile.trim() || value.envFile.includes('..') || value.envFile.startsWith('/') || !variable.test(value.variable ?? '')) throw new InputError('A database needs an env file inside the repository and a variable name such as DATABASE_URL.');
  return { envFile: value.envFile.trim(), variable: value.variable };
}

// The connection string stays in the operator's env file; dispatch reads it per call and never shows it.
export function databaseUrl(workspace, database) {
  let text; try { text = readFileSync(join(workspace, database.envFile), 'utf8'); } catch { throw new Error(`${database.envFile} is not in this worktree. Add it under Copied from your checkout.`); }
  const line = text.split('\n').find(entry => entry.replace(/^export\s+/, '').startsWith(`${database.variable}=`));
  const url = line?.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!url || !/^postgres(ql)?:\/\//.test(url)) throw new Error(`${database.variable} in ${database.envFile} is not a postgres:// URL.`);
  return url;
}

async function connectionString(run, database, connectorUrl, signal) {
  if (database.source !== 'connector') return databaseUrl(run.workspace, database);
  if (!connectorUrl) throw new Error('Connectors are not available.');
  const url = String(await connectorUrl(run.project, database.connector, signal) ?? '').trim();
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error(`The ${database.connector} connector did not return a postgres:// URL.`);
  return url;
}

export async function sqlCall({ run, args, signal, execute = runProcess, connectorUrl }) {
  const database = run.project?.database;
  if (!database) throw new Error('This repository has no database set up for queries.');
  const url = await connectionString(run, database, connectorUrl, signal);
  const result = await execute('psql', [url, '-X', '-q', '--csv', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', '-P', `null=${nullMarker}`, '-c', args.query], { cwd: run.workspace, signal, timeoutMs, inheritEnv: false, env: localEnvironment({ PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=15000', PGCONNECT_TIMEOUT: '5' }) });
  const output = String(result.output ?? '').split(url).join('<database>'), failed = result.exitCode !== 0 || Boolean(result.timedOut);
  if (failed) return { content: [{ type: 'text', text: capped(output.trim() || 'The query failed with no output.') }], isError: true, view: { type: 'table', label: 'SQL', columns: [], rows: [], query: args.query, error: output.trim() } };
  const [columns = [], ...records] = parseCsv(output), rows = records.map(record => record.map(cell => cell === nullMarker ? null : cell));
  return { content: [{ type: 'text', text: capped(textTable(columns, rows)) }], isError: false, view: { ...tableView(columns, rows, { query: args.query }), label: 'SQL' } };
}

const nullMarker = '\\N';
const capped = text => text.length > maxOutput ? `${text.slice(0, maxOutput)}\n… ${text.length - maxOutput} more characters` : text;

// psql --csv quotes fields holding commas, quotes or newlines and doubles inner quotes (RFC 4180).
export function parseCsv(text) {
  const records = [];
  let record = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { record.push(field); field = ''; }
    else if (char === '\n') { record.push(field); records.push(record); record = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field || record.length) { record.push(field); records.push(record); }
  return records;
}

export function textTable(columns, rows) {
  if (!columns.length) return '(no rows returned)';
  const shown = cell => cell === null ? 'NULL' : cell.replaceAll('\n', '\\n');
  const widths = columns.map((column, index) => Math.min(60, Math.max(column.length, ...rows.map(row => shown(row[index]).length))));
  const line = cells => cells.map((cell, index) => shown(cell).slice(0, 60).padEnd(widths[index])).join(' | ').trimEnd();
  return [line(columns), widths.map(width => '-'.repeat(width)).join('-+-'), ...rows.map(line), `(${rows.length} row${rows.length === 1 ? '' : 's'})`].join('\n');
}

