import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databaseChanges } from './changes.mjs';

const failed = result => result.exitCode !== 0 || result.timedOut || result.cancelled;
const nullMarker = '\\N', queryTimeoutMs = 20000, adminTimeoutMs = 120_000, copyTimeoutMs = 900_000, snapshotTimeoutMs = 120_000, snapshotOutput = 64_000_000;
const withDatabase = (url, name) => { const target = new URL(url); target.pathname = `/${name}`; return target.href; };
const identifier = name => `"${name.replaceAll('"', '""')}"`;

export function postgresUrl(env, variable) {
  const url = env[variable] ?? Object.values(env).find(value => /^postgres(ql)?:\/\//.test(value));
  if (!url || !/^postgres(ql)?:\/\//.test(url)) throw new Error(`${variable} is not a postgres:// URL.`);
  return url;
}

function createPostgres(dispatch) {
  const psql = (args, { signal, env = {}, timeoutMs = queryTimeoutMs, maxOutput } = {}) => dispatch.runProcess('psql', ['-X', '-q', ...args], { cwd: tmpdir(), signal, timeoutMs, maxOutput, inheritEnv: false, env: dispatch.localEnvironment({ PGCONNECT_TIMEOUT: '5', ...env }) });

  // A read-only database gets a read-only session with a statement limit, whatever the query says.
  async function query({ sql, env, readOnly = true }, ctx) {
    const url = postgresUrl(env, ctx.settings.variable);
    const result = await psql([url, '--csv', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', '-P', `null=${nullMarker}`, '-c', sql], { signal: ctx.signal, env: { PGOPTIONS: `${readOnly ? '-c default_transaction_read_only=on ' : ''}-c statement_timeout=15000` } });
    if (failed(result)) throw new Error(String(result.output ?? '').trim() || 'psql failed with no output.');
    const [columns = [], ...records] = dispatch.parseDelimited(String(result.output ?? ''));
    return { columns, rows: records.map(record => record.map(cell => cell === nullMarker ? null : cell)) };
  }

  async function admin(url, sql, signal) {
    const result = await psql([withDatabase(url, 'postgres'), '-v', 'ON_ERROR_STOP=1', '-c', sql], { signal, timeoutMs: adminTimeoutMs });
    if (failed(result)) throw new Error(String(result.output ?? '').trim() || 'psql failed.');
  }
  async function copy(source, target, signal) {
    const dir = await mkdtemp(join(tmpdir(), 'dispatch-postgres-')), file = join(dir, 'source.dump'), options = { cwd: tmpdir(), signal, timeoutMs: copyTimeoutMs, inheritEnv: false, env: dispatch.localEnvironment() };
    try {
      for (const [command, args] of [['pg_dump', [source, '-Fc', '--no-owner', '--no-acl', '-f', file]], ['pg_restore', ['--no-owner', '--no-acl', '-d', target, file]]]) {
        const result = await dispatch.runProcess(command, args, options);
        if (failed(result)) throw new Error(`${command} failed: ${String(result.output ?? '').trim().slice(-2000)}`);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  }

  // A template clone is a fast file copy but needs the source to have no other sessions, which a running app usually holds; a dump works regardless.
  async function provision({ task, env }, ctx) {
    const source = postgresUrl(env, ctx.settings.variable), sourceName = decodeURIComponent(new URL(source).pathname.slice(1)), target = withDatabase(source, task.name);
    await admin(source, `drop database if exists ${identifier(task.name)} with (force)`, ctx.signal);
    try { await admin(source, `create database ${identifier(task.name)} template ${identifier(sourceName)}`, ctx.signal); }
    catch {
      await admin(source, `create database ${identifier(task.name)}`, ctx.signal);
      await copy(source, target, ctx.signal);
    }
    return { env: { [ctx.settings.variable]: target } };
  }
  async function release({ task, env }, ctx) {
    await admin(postgresUrl(env, ctx.settings.variable), `drop database if exists ${identifier(task.name)} with (force)`, ctx.signal);
  }

  async function readJson(sql, ctx, env) {
    const result = await psql([postgresUrl(env, ctx.settings.variable), '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { signal: ctx.signal, timeoutMs: snapshotTimeoutMs, maxOutput: snapshotOutput, env: { PGOPTIONS: '-c default_transaction_read_only=on' } });
    if (failed(result)) throw new Error(String(result.output ?? '').trim() || 'psql failed with no output.');
    return String(result.output ?? '');
  }

  async function status() {
    const version = await dispatch.runProcess('psql', ['--version'], { cwd: tmpdir(), timeoutMs: 10000, inheritEnv: false, env: dispatch.localEnvironment() });
    return failed(version) ? { available: false, authenticated: false, detail: 'Install the PostgreSQL client (psql) to query a development database.' } : { available: true, authenticated: true, version: version.output.trim(), detail: 'psql is installed.' };
  }

  return {
    id: 'postgres', name: 'PostgreSQL', description: 'Runs read-only queries against a PostgreSQL development database with psql, and can give each task its own clone of it.',
    status,
    settings: {
      variable: { label: 'Connection variable', description: 'The variable holding the postgres:// connection string.', type: 'string', default: 'DATABASE_URL', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' },
    },
    actions: {
      query: { label: 'Run queries', description: 'Run the agent’s queries and show the rows in the run, in a read-only session unless the repository gives that database write access; 15 s statement limit.', access: 'read', hooks: { 'database.query': query } },
      changes: { label: 'Show a task’s database changes', description: 'Keep a copy of the task database’s rows when it is created, when a service starts or when the agent asks, and show the rows inserted, updated and deleted since. Tables over 20,000 rows are compared by row count.', access: 'read', hooks: databaseChanges(dispatch, readJson) },
      taskDatabases: { label: 'Give each task its own database', description: 'Clone the development database for each task on the same server, and drop the clone when the task’s worktree is removed. The development database itself is only read.', access: 'write', hooks: { 'database.provision': provision, 'database.release': release } },
    },
  };
}

export default createPostgres;
