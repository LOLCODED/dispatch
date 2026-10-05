import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from './engine.mjs';
import { localEnvironment } from './local-tools.mjs';
import { runProcess } from './process.mjs';

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
  const result = await execute('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', '-c', args.query], { cwd: run.workspace, signal, timeoutMs, inheritEnv: false, env: localEnvironment({ PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=15000', PGCONNECT_TIMEOUT: '5' }) });
  const output = String(result.output ?? '').split(url).join('<database>');
  const shown = output.length > maxOutput ? `${output.slice(0, maxOutput)}\n… ${output.length - maxOutput} more characters` : output;
  return { content: [{ type: 'text', text: shown.trim() || '(no output)' }], isError: result.exitCode !== 0 || Boolean(result.timedOut) };
}
