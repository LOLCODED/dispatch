import { connectorId } from './contract.mjs';

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const actionKey = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;

function booleans(value, name) {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.entries(value).some(([key, flag]) => !actionKey.test(key) || typeof flag !== 'boolean')) throw new Error(`${name} must map action ids to true or false.`);
  return { ...value };
}

function settingValues(value, spec, id) {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`Settings for ${id} must be an object.`);
  const result = {};
  for (const [key, setting] of Object.entries(value)) {
    const schema = spec?.[key];
    if (spec && !schema) throw new Error(`${id} has no setting ${key}.`);
    if (!['string', 'boolean'].includes(typeof setting) || (schema && typeof setting !== schema.type)) throw new Error(`${id} setting ${key} must be a ${schema?.type ?? 'string or boolean'}.`);
    if (typeof setting === 'string' && (setting.length > 200 || (schema?.pattern && !new RegExp(schema.pattern).test(setting)))) throw new Error(`${schema?.label ?? key} is not valid for ${id}.`);
    result[key] = setting;
  }
  return result;
}

export function projectConnectors(value = {}, registry = null) {
  if (!isRecord(value)) throw new Error('Connector settings must be an object.');
  const result = {};
  for (const [id, raw] of Object.entries(value)) {
    const entry = typeof raw === 'boolean' ? { enabled: raw } : raw;
    if (!connectorId.test(id)) throw new Error(`Unknown connector id ${id}.`);
    if (!isRecord(entry) || Object.keys(entry).some(key => !['enabled', 'actions', 'settings'].includes(key))) throw new Error(`Settings for ${id} support enabled, actions and settings.`);
    if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') throw new Error(`${id}.enabled must be true or false.`);
    const connector = registry?.get(id);
    const actions = booleans(entry.actions, `${id}.actions`);
    if (connector) for (const key of Object.keys(actions)) if (!connector.actions[key]) delete actions[key];
    result[id] = { enabled: entry.enabled === true, actions, settings: settingValues(entry.settings, connector?.settings, id) };
  }
  return result;
}

export function globalConnectorSettings(value = {}) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id]) => connectorId.test(id)).map(([id, entry]) => [id, typeof entry === 'boolean' ? { enabled: entry, actions: {} } : { enabled: entry?.enabled === true, actions: isRecord(entry?.actions) ? Object.fromEntries(Object.entries(entry.actions).filter(([key, flag]) => actionKey.test(key) && typeof flag === 'boolean')) : {} }]));
}

export function updateGlobal(settings, connector, input) {
  if (!connector) throw new Error('Unknown connector.');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('Enabled must be true or false.');
  const actions = booleans(input.actions, 'actions');
  for (const key of Object.keys(actions)) if (!connector.actions[key]) throw new Error(`${connector.name} has no action ${key}.`);
  const current = settings[connector.id] ?? { enabled: false, actions: {} };
  return { ...settings, [connector.id]: { enabled: input.enabled ?? current.enabled, actions: { ...current.actions, ...actions } } };
}

export const defaultFor = action => action.access === 'read';
export const globalAction = (global, connector, action) => global?.[connector.id]?.actions?.[action] ?? defaultFor(connector.actions[action]);
export const permitted = (project, global, connector, action) => Boolean(connector?.actions[action]) && (project?.connectors?.[connector.id]?.actions?.[action] ?? globalAction(global, connector, action));
export const active = (project, connector) => project?.connectors?.[connector?.id]?.enabled === true;

export function connectorSetting(project, connector, key) {
  const value = project?.connectors?.[connector.id]?.settings?.[key];
  return value === undefined ? connector.settings?.[key]?.default : value;
}
