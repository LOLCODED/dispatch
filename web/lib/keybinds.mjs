export const keybindDefaults = { focusComposer: '/', send: 'Mod+Enter', sendAndStay: 'Mod+Shift+Enter', fullScreen: 'Alt+F', tileFocus: 'Alt' };
export const keybindActions = [
  { id: 'focusComposer', label: 'Focus the composer' },
  { id: 'send', label: 'Dispatch or send a reply' },
  { id: 'sendAndStay', label: 'Dispatch and stay on home' },
  { id: 'fullScreen', label: 'Tile full screen' },
  { id: 'tileFocus', label: 'Focus a tile by its number', modifiersOnly: true },
];

const modifierKeys = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS']);
const commandModifiers = ['Mod', 'Ctrl', 'Alt', 'Meta'];

export function keyName({ code = '', key = '', ctrlKey, altKey, metaKey }) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code) && (/^\d$/.test(key) || ctrlKey || altKey || metaKey)) return code.slice(5);
  if (key === ' ') return 'Space';
  if (key === '+') return 'Plus';
  return key.length === 1 ? key.toUpperCase() : key;
}

// A symbol's character already reflects Shift on the operator's layout, so Shift is not part of its binding.
const symbolKey = key => key.length === 1 && !/[A-Z0-9]/.test(key);

function modifiersOf(event, key) {
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && !symbolKey(key) && 'Shift', event.metaKey && 'Meta'].filter(Boolean);
}

export function comboOf(event) {
  if (modifierKeys.has(event.key)) return null;
  const key = keyName(event);
  return [...modifiersOf(event, key), key].join('+');
}

export function modifiersFrom(event) {
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta'].filter(Boolean).join('+');
}

function modifiersMatch(event, wanted, key = '') {
  const shift = symbolKey(key) ? event.shiftKey : wanted.includes('Shift');
  if (event.altKey !== wanted.includes('Alt') || event.shiftKey !== shift) return false;
  if (wanted.includes('Mod')) return event.ctrlKey !== event.metaKey;
  return event.ctrlKey === wanted.includes('Ctrl') && event.metaKey === wanted.includes('Meta');
}

export function matches(event, combo) {
  if (!combo) return false;
  const parts = combo.split('+'), key = parts.pop();
  return keyName(event) === key && modifiersMatch(event, parts, key);
}

export function submitOnShortcut(event, combo) {
  if (!matches(event, combo)) return;
  event.preventDefault(); event.currentTarget.form.requestSubmit();
}

export function tileIndex(event, modifiers) {
  if (!modifiers || !/^Digit[1-9]$/.test(event.code ?? '')) return -1;
  return modifiersMatch(event, modifiers.split('+')) ? Number(event.code.slice(5)) - 1 : -1;
}

export const usesCommandModifier = combo => combo.split('+').slice(0, -1).some(part => commandModifiers.includes(part));

export function formatCombo(combo, mac = false) {
  return combo.split('+').map(part => part === 'Mod' ? (mac ? '⌘' : 'Ctrl') : part === 'Meta' && mac ? '⌘' : part === 'Plus' ? '+' : part).join('+');
}

export function readKeybinds(saved, legacyFullScreenLetter) {
  const legacy = /^[a-z]$/.test(legacyFullScreenLetter ?? '') ? { fullScreen: `Alt+${legacyFullScreenLetter.toUpperCase()}` } : {};
  const stored = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const valid = Object.fromEntries(Object.entries(stored).filter(([id, value]) => id in keybindDefaults && typeof value === 'string' && value.trim()));
  return { ...keybindDefaults, ...legacy, ...valid };
}

export function conflictOf(keybinds, id, combo) {
  const clash = keybindActions.find(action => action.id !== id && !action.modifiersOnly && keybinds[action.id] === combo);
  return clash?.label ?? null;
}
