export const backendKinds = { dispatch_http: 'http', dispatch_service: 'logs', dispatch_sql: 'sql', dispatch_ci: 'ci' };
export const backendFilters = [['http', 'HTTP'], ['logs', 'Services'], ['sql', 'SQL'], ['ci', 'CI']];

export const isBackendCall = step => step.kind === 'tool.call' && Object.hasOwn(backendKinds, step.name);

const firstLine = text => String(text ?? '').trim().split('\n')[0].slice(0, 160);
const titles = {
  http: input => `${input.method ?? 'GET'} ${input.url ?? ''}`,
  logs: input => input.service ? `${input.service} · ${input.action}` : input.action ?? '',
  sql: input => firstLine(input.query),
  ci: input => `${input.action ?? 'status'} ${input.target ?? 'branch'}`,
};

// Pairs each backend tool call with its result, oldest first; a call without a result yet is still running.
export function backendEntries(steps) {
  const results = new Map(steps.filter(step => step.kind === 'tool.result').map(step => [step.callId, step]));
  return steps.filter(isBackendCall).map(call => {
    const kind = backendKinds[call.name], result = results.get(call.callId);
    return { id: call.id, kind, at: call.at, title: titles[kind](call.input ?? {}), input: call.input ?? {}, output: result?.output ?? null, data: result?.data ?? null, isError: result?.isError === true, durationMs: result?.durationMs ?? null, pending: !result };
  });
}

const tsvCell = cell => cell === null ? '' : /[\t\n"]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
const csvCell = cell => cell === null ? '' : /[,\n"]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
// Spreadsheets paste tab-separated text as cells; quoting keeps embedded tabs and newlines inside one cell.
export const gridAs = {
  tsv: ({ columns, rows }) => [columns, ...rows].map(row => row.map(tsvCell).join('\t')).join('\n'),
  csv: ({ columns, rows }) => [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\n'),
  json: ({ columns, rows }) => JSON.stringify(rows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index]]))), null, 2),
};

const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
export function curlCommand({ request }) {
  const headers = Object.entries(request.headers ?? {}).flatMap(([name, value]) => ['-H', shellQuote(`${name}: ${value}`)]);
  return ['curl', '-i', ...(request.method === 'GET' ? [] : ['-X', request.method]), ...headers, ...(request.body ? ['--data-raw', shellQuote(request.body)] : []), shellQuote(request.resolved)].join(' ');
}

const logKeys = new Set(['msg', 'message', 'level', 'time', 'timestamp', 'pid', 'hostname']);
const levels = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };
// Structured loggers (pino, bunyan, winston JSON) print one object per line; anything else stays a plain line.
export function logLines(text) {
  return String(text ?? '').split('\n').filter(line => line.trim()).map(line => {
    if (!line.trimStart().startsWith('{')) return { text: line, level: /\b(error|exception|fatal)\b/i.test(line) ? 'error' : /\bwarn/i.test(line) ? 'warn' : null };
    try {
      const entry = JSON.parse(line), level = typeof entry.level === 'number' ? levels[entry.level] : entry.level ?? null, at = entry.time ?? entry.timestamp;
      const rest = Object.fromEntries(Object.entries(entry).filter(([key]) => !logKeys.has(key)));
      return { time: at ? new Date(at).toLocaleTimeString([], { hour12: false }) : null, level, text: entry.msg ?? entry.message ?? '', fields: Object.keys(rest).length ? JSON.stringify(rest) : '' };
    } catch { return { text: line, level: null }; }
  });
}
