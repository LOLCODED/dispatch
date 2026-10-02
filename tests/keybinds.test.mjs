import test from 'node:test';
import assert from 'node:assert/strict';
import { comboOf, conflictOf, formatCombo, keybindDefaults, matches, readKeybinds, tileIndex, usesCommandModifier } from '../web/lib/keybinds.mjs';

const press = (code, key, modifiers = {}) => ({ code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers });

test('records combos from physical keys so Alt+letter survives layouts that remap the character', () => {
  assert.equal(comboOf(press('KeyF', 'ƒ', { altKey: true })), 'Alt+F');
  assert.equal(comboOf(press('Enter', 'Enter', { ctrlKey: true })), 'Ctrl+Enter');
  assert.equal(comboOf(press('ShiftLeft', 'Shift', { shiftKey: true })), null);
  assert.equal(comboOf(press('Slash', '?', { shiftKey: true })), '?');
});

test('Mod matches either Ctrl or Cmd but not both, and other modifiers must match exactly', () => {
  assert.equal(matches(press('Enter', 'Enter', { ctrlKey: true }), 'Mod+Enter'), true);
  assert.equal(matches(press('Enter', 'Enter', { metaKey: true }), 'Mod+Enter'), true);
  assert.equal(matches(press('Enter', 'Enter'), 'Mod+Enter'), false);
  assert.equal(matches(press('Enter', 'Enter', { ctrlKey: true, shiftKey: true }), 'Mod+Enter'), false);
  assert.equal(matches(press('KeyF', 'f', { altKey: true }), 'Alt+F'), true);
  assert.equal(matches(press('KeyF', 'f', { altKey: true, ctrlKey: true }), 'Alt+F'), false);
});

test('symbol keys ignore Shift because the layout decides whether the symbol needs it', () => {
  assert.equal(matches(press('Digit7', '/', { shiftKey: true }), '/'), true);
  assert.equal(matches(press('Slash', '/'), '/'), true);
  assert.equal(matches(press('Slash', '/', { ctrlKey: true }), '/'), false);
});

test('tile focus uses the bound modifiers with digits one to nine', () => {
  assert.equal(tileIndex(press('Digit3', '3', { altKey: true }), 'Alt'), 2);
  assert.equal(tileIndex(press('Digit3', '3', { altKey: true }), 'Ctrl+Shift'), -1);
  assert.equal(tileIndex(press('Digit3', '#', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift'), 2);
  assert.equal(tileIndex(press('KeyA', 'a', { altKey: true }), 'Alt'), -1);
});

test('reads saved bindings over defaults and migrates the old full screen letter', () => {
  assert.deepEqual(readKeybinds(null, ''), keybindDefaults);
  assert.equal(readKeybinds(null, 'g').fullScreen, 'Alt+G');
  assert.equal(readKeybinds({ fullScreen: 'Alt+K' }, 'g').fullScreen, 'Alt+K');
  assert.deepEqual(readKeybinds({ unknown: 'X', send: '' }, ''), keybindDefaults);
});

test('reports conflicts, command modifiers and platform labels', () => {
  assert.equal(conflictOf(keybindDefaults, 'fullScreen', '/'), 'Focus the composer');
  assert.equal(conflictOf(keybindDefaults, 'fullScreen', 'Alt+G'), null);
  assert.equal(usesCommandModifier('/'), false);
  assert.equal(usesCommandModifier('Alt+F'), true);
  assert.equal(formatCombo('Mod+Enter', true), '⌘+Enter');
  assert.equal(formatCombo('Mod+Enter', false), 'Ctrl+Enter');
});
