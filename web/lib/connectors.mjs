export const actionDefault = (connector, action) => action.enabled ?? action.access === 'read';

export function effectiveAction(settings, connector, action) {
  return settings?.[connector.id]?.actions?.[action.id] ?? actionDefault(connector, action);
}

export const overridden = (settings, connector, action) => typeof settings?.[connector.id]?.actions?.[action.id] === 'boolean';

// A repository keeps an override only while it differs from the global default, so changing the default still reaches it.
export function setAction(settings, connector, action, value) {
  const current = settings?.[connector.id] ?? { enabled: false, actions: {}, settings: {} };
  const actions = { ...current.actions };
  if (value === actionDefault(connector, action)) delete actions[action.id]; else actions[action.id] = value;
  return { ...settings, [connector.id]: { ...current, actions } };
}

export function setUsed(settings, connector, enabled) {
  const current = settings?.[connector.id] ?? { actions: {}, settings: {} };
  return { ...settings, [connector.id]: { ...current, enabled } };
}

export function settingValue(settings, connector, setting) {
  return settings?.[connector.id]?.settings?.[setting.key] ?? setting.default;
}

export function setSetting(settings, connector, setting, value) {
  const current = settings?.[connector.id] ?? { enabled: false, actions: {}, settings: {} };
  const values = { ...current.settings };
  if (value === setting.default) delete values[setting.key]; else values[setting.key] = value;
  return { ...settings, [connector.id]: { ...current, settings: values } };
}

export const usedConnectors = (connectors, settings) => (connectors ?? []).filter(connector => settings?.[connector.id]?.enabled === true);
export const ticketReader = (connectors, settings) => usedConnectors(connectors, settings).find(connector => connector.tickets);
