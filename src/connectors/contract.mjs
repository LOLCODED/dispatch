export const contractVersion = 1;

export const runEvents = ['run.ready', 'run.blocked', 'run.failed', 'run.cancelled'];

export const hookNames = new Set([
  'ticket.detect', 'ticket.read', 'ticket.revision', 'ticket.comment', 'ticket.states', 'ticket.setState',
  'database.url', 'database.connect', 'database.disconnect', 'database.query', 'database.provision', 'database.release', 'database.snapshot', 'database.changes',
  'delivery.push', 'delivery.findPullRequest', 'delivery.openPullRequest', 'delivery.describe', 'delivery.checks', 'delivery.checkLogs', 'delivery.reviews',
  ...runEvents,
]);

export const connectorId = /^[a-z][a-z0-9]{1,30}$/;
const actionId = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
const settingKey = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
const toolName = /^[a-z][a-z0-9_]{0,39}$/;
// Claude Code names MCP tools mcp__dispatch__<name> and refuses names over 64 characters.
const maxExposedToolName = 48;
const reservedIds = new Set(['text', 'dispatch']);
const fail = (connector, message) => { throw new Error(`Connector ${connector?.id ?? '(unnamed)'}: ${message}`); };
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function validateSetting(connector, key, spec) {
  if (!settingKey.test(key) || !isRecord(spec) || typeof spec.label !== 'string' || !spec.label.trim()) fail(connector, `setting ${key} needs a label.`);
  if (!['string', 'boolean'].includes(spec.type)) fail(connector, `setting ${key} must be a string or boolean.`);
  if (spec.default !== undefined && typeof spec.default !== spec.type) fail(connector, `setting ${key} has a default of the wrong type.`);
  if (spec.secret !== undefined && typeof spec.secret !== 'boolean') fail(connector, `setting ${key} secret must be true or false.`);
  if (spec.pattern !== undefined) { if (typeof spec.pattern !== 'string') fail(connector, `setting ${key} pattern must be a string.`); try { new RegExp(spec.pattern); } catch { fail(connector, `setting ${key} pattern is not a valid regular expression.`); } }
}

export const exposedToolName = (connector, name) => `${connector.id}_${name}`;

function validateTool(connector, name, tool, seen) {
  if (!toolName.test(name) || exposedToolName(connector, name).length > maxExposedToolName) fail(connector, `tool ${name} needs a lowercase name, and with the connector id at most ${maxExposedToolName} characters.`);
  if (!isRecord(tool) || typeof tool.run !== 'function') fail(connector, `tool ${name} needs a run function.`);
  if (typeof tool.description !== 'string' || !tool.description.trim() || tool.description.length > 1000) fail(connector, `tool ${name} needs a description of at most 1,000 characters.`);
  if (!isRecord(tool.inputSchema) || tool.inputSchema.type !== 'object') fail(connector, `tool ${name} inputSchema must be a JSON schema of type object.`);
  if (seen.has(name)) fail(connector, `tool ${name} belongs to two actions.`);
  seen.add(name);
}

function validateAction(connector, id, action, seen, tools) {
  if (!actionId.test(id) || !isRecord(action)) fail(connector, `action ${id} must be an object with a letter-and-digit id.`);
  if (typeof action.label !== 'string' || !action.label.trim()) fail(connector, `action ${id} needs a label.`);
  if (!['read', 'write'].includes(action.access)) fail(connector, `action ${id} access must be read or write.`);
  if ((action.hooks !== undefined && !isRecord(action.hooks)) || (action.tools !== undefined && !isRecord(action.tools))) fail(connector, `action ${id} hooks and tools must be objects.`);
  if (!Object.keys(action.hooks ?? {}).length && !Object.keys(action.tools ?? {}).length) fail(connector, `action ${id} needs at least one hook or tool.`);
  for (const [name, tool] of Object.entries(action.tools ?? {})) validateTool(connector, name, tool, tools);
  for (const [name, hook] of Object.entries(action.hooks ?? {})) {
    if (!hookNames.has(name)) fail(connector, `unknown hook ${name}.`);
    if (typeof hook !== 'function') fail(connector, `hook ${name} must be a function.`);
    if (seen.has(name)) fail(connector, `hook ${name} belongs to two actions.`);
    seen.add(name);
  }
}

export function validateConnector(connector) {
  if (!isRecord(connector)) throw new Error('A connector must return an object.');
  if (typeof connector.id !== 'string' || !connectorId.test(connector.id) || reservedIds.has(connector.id)) fail(connector, 'id must be 2–31 lowercase letters or digits, start with a letter, and not be text or dispatch.');
  if (typeof connector.name !== 'string' || !connector.name.trim()) fail(connector, 'needs a name.');
  if (connector.status !== undefined && typeof connector.status !== 'function') fail(connector, 'status must be a function.');
  if (connector.icon !== undefined && (typeof connector.icon !== 'string' || connector.icon.length > 4000 || !/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(connector.icon))) fail(connector, 'icon must be SVG path data for a 24 × 24 view box.');
  if (!isRecord(connector.actions) || !Object.keys(connector.actions).length) fail(connector, 'needs at least one action.');
  const hooks = new Set(), tools = new Set();
  for (const [id, action] of Object.entries(connector.actions)) validateAction(connector, id, action, hooks, tools);
  for (const [key, spec] of Object.entries(connector.settings ?? {})) validateSetting(connector, key, spec);
  for (const [key, spec] of Object.entries(connector.databaseOptions ?? {})) validateSetting(connector, key, spec);
  if (hooks.has('ticket.detect') !== hooks.has('ticket.read')) fail(connector, 'ticket.detect and ticket.read come together.');
  if (hooks.has('ticket.setState') !== hooks.has('ticket.states')) fail(connector, 'ticket.states and ticket.setState come together.');
  if (hooks.has('database.snapshot') !== hooks.has('database.changes')) fail(connector, 'database.snapshot and database.changes come together.');
  if (hooks.has('delivery.openPullRequest') && !hooks.has('delivery.push')) fail(connector, 'delivery.openPullRequest needs delivery.push.');
  return connector;
}

export const hooksOf = connector => Object.values(connector.actions).flatMap(action => Object.keys(action.hooks ?? {}));
export const delivers = connector => hooksOf(connector).includes('delivery.push');

export function describeConnector(connector, { builtIn = false } = {}) {
  return {
    id: connector.id, name: connector.name, description: connector.description ?? null, icon: connector.icon ?? null, builtIn, delivers: delivers(connector), tickets: hooksOf(connector).includes('ticket.read'), databases: ['database.url', 'database.connect'].some(hook => hooksOf(connector).includes(hook)), databaseOptions: Object.entries(connector.databaseOptions ?? {}).map(([key, spec]) => ({ key, label: spec.label, description: spec.description ?? null, type: spec.type, default: spec.default ?? (spec.type === 'boolean' ? false : ''), pattern: spec.pattern ?? null })), queries: hooksOf(connector).includes('database.query'), provisions: hooksOf(connector).includes('database.provision'), changes: hooksOf(connector).includes('database.changes'),
    actions: Object.entries(connector.actions).map(([id, action]) => ({ id, label: action.label, description: action.description ?? null, access: action.access, hooks: Object.keys(action.hooks ?? {}), tools: Object.keys(action.tools ?? {}).map(name => exposedToolName(connector, name)) })),
    settings: Object.entries(connector.settings ?? {}).map(([key, spec]) => ({ key, label: spec.label, description: spec.description ?? null, type: spec.type, default: spec.secret ? '' : spec.default ?? (spec.type === 'boolean' ? false : ''), pattern: spec.pattern ?? null, secret: spec.secret === true })),
  };
}
