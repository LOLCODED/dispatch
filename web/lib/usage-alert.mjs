export const nearLimitPercent = 90;

export function nearLimitWindows(limits, providerIds) {
  return providerIds.flatMap(providerId => (limits?.[providerId]?.windows ?? [])
    .filter(window => window.usedPercent >= nearLimitPercent)
    .map(window => ({ providerId, ...window })));
}

export function usageAlertKey(windows) {
  return windows.map(window => `${window.providerId}:${window.label}`).sort().join('|');
}

export function dismissUntil(windows, now = Date.now()) {
  const resets = windows.map(window => Date.parse(window.resetsAt)).filter(at => at > now);
  return resets.length ? Math.min(...resets) : now + 5 * 60 * 60 * 1000;
}
