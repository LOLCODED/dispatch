// A small vocabulary any tool result can use to be shown as more than text, so connector output gets the same views as dispatch's own tools.
export const viewTypes = ['table', 'http', 'log', 'checks', 'text'];
export const checkStates = ['ok', 'bad', 'pending', 'muted'];

const tableBudget = 12_000, cellLength = 500, bodyLength = 8_000, textLength = 12_000;
const str = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : value === undefined || value === null ? '' : String(value).slice(0, limit);
const clip = (text, limit) => text.length > limit ? text.slice(0, limit) : text;
const tailOf = (text, limit) => text.length > limit ? text.slice(-limit) : text;
const headers = value => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).slice(0, 40).map(([name, entry]) => [str(name, 100), str(entry, 300)]));

export class ToolOutput {
  constructor(value, view) { this.value = value; this.view = view; }
}
export const withView = (value, view) => new ToolOutput(value, view);

// Keeps the first rows that fit in one step record (a line holds 32k); rowCount says how many there were.
export function tableView(columns, rows, extra = {}) {
  const names = columns.slice(0, 100).map(column => str(column, 200)), kept = [];
  let size = JSON.stringify(names).length;
  for (const row of rows) {
    const cells = names.map((_, index) => row[index] === null || row[index] === undefined ? null : clip(str(row[index], cellLength + 1), cellLength));
    size += JSON.stringify(cells).length + 1;
    if (size > tableBudget) break;
    kept.push(cells);
  }
  return { type: 'table', columns: names, rows: kept, rowCount: Number.isInteger(extra.rowCount) ? extra.rowCount : rows.length, truncated: kept.length < rows.length, ...(extra.query ? { query: str(extra.query, 4000) } : {}) };
}

function httpView(view) {
  const request = view.request ?? {}, response = view.response ?? {}, body = str(response.body, Infinity);
  return {
    type: 'http',
    request: { method: str(request.method, 10).toUpperCase() || 'GET', url: str(request.url, 2000), resolved: str(request.resolved ?? request.url, 2000), headers: headers(request.headers), body: clip(str(request.body, Infinity), 2000) },
    response: { status: Number(response.status) || 0, statusText: str(response.statusText, 100), headers: headers(response.headers), body: clip(body, bodyLength), bodyLength: Number.isInteger(response.bodyLength) ? response.bodyLength : body.length },
  };
}

const checksView = view => ({ type: 'checks', items: (Array.isArray(view.items) ? view.items : []).slice(0, 50).map(item => ({ name: str(item?.name, 200), state: checkStates.includes(item?.state) ? item.state : 'muted', detail: str(item?.detail, 200) })), ...(view.detail ? { detail: tailOf(str(view.detail, Infinity), textLength) } : {}) });

const shapes = {
  table: view => tableView(Array.isArray(view.columns) ? view.columns : [], Array.isArray(view.rows) ? view.rows.filter(Array.isArray) : [], view),
  http: httpView,
  log: view => ({ type: 'log', text: tailOf(str(view.text, Infinity), textLength) }),
  checks: checksView,
  text: view => ({ type: 'text', text: clip(str(view.text, Infinity), textLength), format: view.format === 'json' ? 'json' : 'plain' }),
};

// Unknown or malformed views are dropped rather than refused; the agent's text result never depends on them.
export function boundedView(view) {
  if (!view || typeof view !== 'object' || !viewTypes.includes(view.type)) return null;
  const shaped = shapes[view.type](view);
  return { ...shaped, ...(view.label ? { label: str(view.label, 16) } : {}), ...(view.title ? { title: str(view.title, 160) } : {}), ...(view.error ? { error: str(view.error, 4000) } : {}) };
}
