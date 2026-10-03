import { createContext, useContext, useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { preference, savePreference } from '@/lib/workspace';
import { formatCombo, keybindDefaults, readKeybinds } from '@/lib/keybinds.mjs';
import { settle } from '@/lib/motion';
import { clampVolume } from '@/lib/attention.mjs';
import { layoutModes } from '@/lib/run-layouts.mjs';

const keys = { keybinds: 'dispatch-keybinds', legacyFullScreen: 'dispatch-full-screen-key', motion: 'dispatch-motion', home: 'dispatch-home-list', attentionSound: 'dispatch-attention-sound', attentionVolume: 'dispatch-attention-volume', afterDispatch: 'dispatch-after-dispatch', editor: 'dispatch-editor', layout: 'dispatch-run-layout', alerts: 'dispatch-alerts' };
export const motionModes = ['system', 'reduce', 'full'];
export const homeModes = ['reveal', 'open'];
export const afterDispatchModes = ['open', 'stay'];
export const alertKinds = ['usage', 'review', 'storage', 'folders'];
const motionConfig = { system: 'user', reduce: 'always', full: 'never' };

const PreferencesContext = createContext(null);

function choice(key, options) {
  const value = preference(key);
  return options.includes(value) ? value : options[0];
}

function storedKeybinds() {
  try { return readKeybinds(JSON.parse(preference(keys.keybinds, 'null')), preference(keys.legacyFullScreen)); } catch { return readKeybinds(null, preference(keys.legacyFullScreen)); }
}

function storedAlerts() {
  try {
    const saved = JSON.parse(preference(keys.alerts, '{}')) ?? {};
    return Object.fromEntries(alertKinds.map(kind => [kind, saved[kind] !== false]));
  } catch { return Object.fromEntries(alertKinds.map(kind => [kind, true])); }
}

export function useStored(key, read, write = value => value) {
  const [value, setValue] = useState(read);
  return [value, next => { savePreference(key, write(next)); setValue(next); }];
}

export function PreferencesProvider({ children }) {
  const [keybinds, saveKeybinds] = useStored(keys.keybinds, storedKeybinds, JSON.stringify);
  const [motion, setMotion] = useStored(keys.motion, () => choice(keys.motion, motionModes));
  const [homeList, setHomeList] = useStored(keys.home, () => choice(keys.home, homeModes));
  const [attentionSound, setAttentionSound] = useStored(keys.attentionSound, () => preference(keys.attentionSound) === 'on', on => on ? 'on' : 'off');
  const [attentionVolume, setAttentionVolume] = useStored(keys.attentionVolume, () => clampVolume(preference(keys.attentionVolume)), String);
  const [afterDispatch, setAfterDispatch] = useStored(keys.afterDispatch, () => choice(keys.afterDispatch, afterDispatchModes));
  const [editor, setEditor] = useStored(keys.editor, () => preference(keys.editor));
  const [layout, setLayout] = useStored(keys.layout, () => choice(keys.layout, layoutModes));
  const [alerts, saveAlerts] = useStored(keys.alerts, storedAlerts, JSON.stringify);
  useEffect(() => { document.documentElement.dataset.motion = motion; }, [motion]);
  const value = {
    keybinds, motion, setMotion, homeList, setHomeList, attentionSound, setAttentionSound, attentionVolume, setAttentionVolume, afterDispatch, setAfterDispatch, editor, setEditor, layout, setLayout, alerts,
    setAlert: (kind, on) => saveAlerts({ ...alerts, [kind]: on }),
    setKeybind: (id, combo) => saveKeybinds({ ...keybinds, [id]: combo }),
    resetKeybinds: () => saveKeybinds(keybindDefaults),
  };
  return <PreferencesContext.Provider value={value}><MotionConfig reducedMotion={motionConfig[motion]} transition={settle}>{children}</MotionConfig></PreferencesContext.Provider>;
}

export const usePreferences = () => useContext(PreferencesContext);

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
export const shortcutLabel = combo => formatCombo(combo, mac);
