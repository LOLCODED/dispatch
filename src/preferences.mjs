// Personal settings for this dispatch install, shared by the server (which stores them) and the browser (which caches
// them under its old localStorage names so a page never flashes the wrong theme while it loads).

const enumOf = (values, cache, description) => ({ type: 'enum', values, default: values[0], cache, description });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const shortJson = value => JSON.stringify(value).length <= 4000;

export const preferenceSpecs = {
  'appearance.theme': enumOf(['system', 'dark', 'light'], 'dispatch-theme', 'Colour theme: follow the system, dark or light.'),
  'appearance.motion': enumOf(['system', 'reduce', 'full'], 'dispatch-motion', 'Animation: follow the system, reduce or full.'),
  'runs.layout': enumOf(['default', 'vibe', 'technical'], 'dispatch-run-layout', 'How a run page arranges its tiles.'),
  'runs.tileFocus': enumOf(['hover', 'click'], 'dispatch-tile-focus', 'A tile takes focus when the mouse moves over it, or on click.'),
  'runs.tileStroke': enumOf(['on', 'off'], 'dispatch-tile-stroke', 'Outline the focused tile.'),
  'home.list': enumOf(['reveal', 'open'], 'dispatch-home-list', 'Show tasks under the composer on scroll, or always.'),
  'composer.afterDispatch': enumOf(['open', 'stay'], 'dispatch-after-dispatch', 'Open the run after dispatching, or stay on the composer.'),
  'composer.model': { type: 'json', default: null, cache: 'dispatch-execution', description: 'The model the composer starts with: { provider, model, effort }, or null for Auto.', valid: value => value === null || value === 'auto' || (record(value) && typeof value.provider === 'string' && shortJson(value)) },
  editor: { type: 'string', default: '', cache: 'dispatch-editor', description: 'Editor command used to open worktrees; empty uses the first one found.', valid: value => typeof value === 'string' && value.length <= 200 },
  'attention.sound': enumOf(['off', 'on'], 'dispatch-attention-sound', 'Play a sound when a task needs you.'),
  'attention.volume': { type: 'integer', default: 60, cache: 'dispatch-attention-volume', description: 'Sound volume, 0 to 100.', valid: value => Number.isInteger(value) && value >= 0 && value <= 100 },
  alerts: { type: 'json', default: {}, cache: 'dispatch-alerts', description: 'Banners to show: { usage, review, storage, folders } as true or false.', valid: value => record(value) && Object.values(value).every(item => typeof item === 'boolean') },
  keybinds: { type: 'json', default: {}, cache: 'dispatch-keybinds', description: 'Keyboard shortcuts by action, e.g. { "fullScreen": "Alt+F" }.', valid: value => record(value) && Object.values(value).every(item => typeof item === 'string' && item.length <= 40) && shortJson(value) },
};

export function validPreference(key, value) {
  const spec = preferenceSpecs[key];
  if (!spec) return false;
  return spec.type === 'enum' ? spec.values.includes(value) : spec.valid(value);
}

export const preferenceValue = (stored, key) => stored && Object.hasOwn(stored, key) && validPreference(key, stored[key]) ? stored[key] : preferenceSpecs[key].default;

// The cache keeps the string forms the browser always used, so older cached values still read.
export const cacheText = (key, value) => preferenceSpecs[key].type === 'json' ? JSON.stringify(value) : String(value);
export function fromCache(key, text) {
  if (text === null || text === undefined) return undefined;
  const spec = preferenceSpecs[key];
  let value = text;
  if (spec.type === 'json') { try { value = JSON.parse(text); } catch { return undefined; } }
  if (spec.type === 'integer') value = Number(text);
  return validPreference(key, value) ? value : undefined;
}

// What a browser keeps for itself — drafts, dismissed banners, last-used choices, tile positions — and the page's own event and class names.
// None is a setting; anything else the web code stores must be a preference above (tests/settings.test.mjs).
export const browserStateKeys = ['dispatch-draft', 'dispatch-text-attachments', 'dispatch-followup-', 'dispatch-question-', 'dispatch-game', 'dispatch-game-best-', 'dispatch-tiles', 'dispatch-tiles-', 'dispatch-board-folder', 'dispatch-select-collapsed', 'dispatch-seen-version', 'dispatch-land-strategy', 'dispatch-pr-base-', 'dispatch-usage-alert-dismissed', 'dispatch-review-alert-dismissed-until', 'dispatch-storage-alert-dismissed-until', 'dispatch-folder-alert-dismissed-until', 'dispatch-browser-dismissed-', 'dispatch-full-screen-key'];
export const browserEvents = ['dispatch-refresh', 'dispatch-flight'];
