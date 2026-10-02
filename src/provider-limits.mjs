const namedWindows = { 300: '5-hour', 10080: 'Weekly' };
const windowMinutes = { five_hour: 300, seven_day: 10080 };

export function windowLabel(minutes) {
  if (namedWindows[minutes]) return namedWindows[minutes];
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`;
  return minutes % 60 === 0 ? `${minutes / 60}-hour` : `${minutes}-minute`;
}

const percent = value => Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;
const epoch = seconds => Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
const plan = value => typeof value === 'string' && /^[\w-]{1,40}$/.test(value) ? value : null;

function codexWindow(window) {
  if (!window || !Number.isInteger(window.windowDurationMins) || window.windowDurationMins <= 0) return null;
  return { label: windowLabel(window.windowDurationMins), usedPercent: percent(window.usedPercent), resetsAt: epoch(window.resetsAt) };
}

export function codexLimits(limits, now = new Date()) {
  const windows = [limits?.primary, limits?.secondary].map(codexWindow).filter(Boolean);
  return { available: windows.length > 0, source: 'live', plan: plan(limits?.planType), windows, limited: Boolean(limits?.rateLimitReachedType), observedAt: now.toISOString(), message: windows.length ? 'Reported by your Codex CLI.' : 'Codex reported no plan limits.' };
}

function claudeWindowLabel(key) {
  const [, base, scope] = key.match(/^(five_hour|seven_day)(?:_([a-z]+))?$/) ?? [];
  if (!base) return null;
  const label = windowLabel(windowMinutes[base]);
  return scope ? `${label} · ${scope[0].toUpperCase()}${scope.slice(1)}` : label;
}

// Claude Code reports utilization as a 0–1 fraction per window, only during a turn.
export function claudeLimits(info, now = new Date()) {
  const windows = Object.entries(info?.unifiedWindows ?? {}).map(([key, window]) => {
    const label = claudeWindowLabel(key);
    return label && { label, usedPercent: percent(window?.utilization * 100), resetsAt: epoch(window?.resetsAt) };
  }).filter(Boolean);
  return { available: windows.length > 0, source: 'observed', plan: null, windows, limited: info?.status === 'rejected', observedAt: now.toISOString(), message: 'Last reported by Claude Code during a run.' };
}

const usageLine = /^(Current [^:]{1,80}): (\d{1,3})% used(?: · resets (.{1,80}))?$/;

// `claude -p /usage` is a local command: no model turn, no tokens. Its text is the only read-only source.
export function claudeUsageText(text, now = new Date()) {
  const windows = String(text ?? '').split('\n').map(line => line.trim().match(usageLine)).filter(Boolean)
    .map(([, label, used, resets]) => ({ label, usedPercent: percent(Number(used)), resetsAt: null, resetsText: resets ? `Resets ${resets}` : null }));
  return { available: windows.length > 0, source: 'live', plan: null, windows, limited: windows.some(window => window.usedPercent >= 100), observedAt: now.toISOString(), message: windows.length ? 'Reported by your Claude Code CLI.' : 'Claude Code did not report plan usage. Check your login, then refresh.' };
}
