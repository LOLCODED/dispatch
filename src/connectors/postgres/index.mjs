import { tmpdir } from 'node:os';

const failed = result => result.exitCode !== 0 || result.timedOut || result.cancelled;
const nullMarker = '\\N', queryTimeoutMs = 20000;

export function postgresUrl(env, variable) {
  const url = env[variable] ?? Object.values(env).find(value => /^postgres(ql)?:\/\//.test(value));
  if (!url || !/^postgres(ql)?:\/\//.test(url)) throw new Error(`${variable} is not a postgres:// URL.`);
  return url;
}

function createPostgres(dispatch) {
  const psql = (args, { signal, env = {}, timeoutMs = queryTimeoutMs } = {}) => dispatch.runProcess('psql', ['-X', '-q', ...args], { cwd: tmpdir(), signal, timeoutMs, inheritEnv: false, env: dispatch.localEnvironment({ PGCONNECT_TIMEOUT: '5', ...env }) });

  // The session is read-only with a statement limit, whatever the query says; changes go in migrations.
  async function query({ sql, env }, ctx) {
    const url = postgresUrl(env, ctx.settings.variable);
    const result = await psql([url, '--csv', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', '-P', `null=${nullMarker}`, '-c', sql], { signal: ctx.signal, env: { PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=15000' } });
    if (failed(result)) throw new Error(String(result.output ?? '').trim() || 'psql failed with no output.');
    const [columns = [], ...records] = dispatch.parseDelimited(String(result.output ?? ''));
    return { columns, rows: records.map(record => record.map(cell => cell === nullMarker ? null : cell)) };
  }

  async function status() {
    const version = await dispatch.runProcess('psql', ['--version'], { cwd: tmpdir(), timeoutMs: 10000, inheritEnv: false, env: dispatch.localEnvironment() });
    return failed(version) ? { available: false, authenticated: false, detail: 'Install the PostgreSQL client (psql) to query a development database.' } : { available: true, authenticated: true, version: version.output.trim(), detail: 'psql is installed.' };
  }

  return {
    id: 'postgres', name: 'PostgreSQL', description: 'Runs read-only queries against a PostgreSQL development database with psql.',
    status,
    settings: {
      variable: { label: 'Connection variable', description: 'The variable holding the postgres:// connection string.', type: 'string', default: 'DATABASE_URL', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' },
    },
    actions: {
      query: { label: 'Run read-only queries', description: 'Read rows for the agent and show them in the run. The session is read-only with a 15 s statement limit.', access: 'read', hooks: { 'database.query': query } },
    },
  };
}

export default createPostgres;
