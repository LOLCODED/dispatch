import { createContext, useContext, useEffect, useMemo } from 'react';
import { MotionConfig } from 'motion/react';
import { preference } from '@/lib/workspace';
import { setPreference, usePreference } from '@/lib/server-preferences';
import { formatCombo, keybindDefaults, readKeybinds } from '@/lib/keybinds.mjs';
import { settle } from '@/lib/motion';
import { clampVolume } from '@/lib/attention.mjs';

const legacyFullScreenKey = 'dispatch-full-screen-key';
export const motionModes = ['system', 'reduce', 'full'];
export const homeModes = ['reveal', 'open'];
export const afterDispatchModes = ['open', 'stay'];
export const alertKinds = ['usage', 'review', 'storage', 'folders'];
const motionConfig = { system: 'user', reduce: 'always', full: 'never' };

const PreferencesContext = createContext(null);

// Each preference is a dispatch setting (src/preferences.mjs) so a task or the CLI can change it; this keeps the shapes the UI has always used.
const setting = key => [usePreference(key), value => setPreference(key, value)];

export function PreferencesProvider({ children }) {
  const [savedKeybinds, saveKeybinds] = setting('keybinds'), keybinds = useMemo(() => readKeybinds(Object.keys(savedKeybinds).length ? savedKeybinds : null, preference(legacyFullScreenKey)), [savedKeybinds]);
  const [motion, setMotion] = setting('appearance.motion'), [homeList, setHomeList] = setting('home.list'), [afterDispatch, setAfterDispatch] = setting('composer.afterDispatch');
  const [sound, setSound] = setting('attention.sound'), [volume, setVolume] = setting('attention.volume'), [editor, setEditor] = setting('editor'), [layout, setLayout] = setting('runs.layout');
  const [savedAlerts, saveAlerts] = setting('alerts'), alerts = useMemo(() => Object.fromEntries(alertKinds.map(kind => [kind, savedAlerts[kind] !== false])), [savedAlerts]);
  useEffect(() => { document.documentElement.dataset.motion = motion; }, [motion]);
  const value = {
    keybinds, motion, setMotion, homeList, setHomeList, attentionSound: sound === 'on', setAttentionSound: on => setSound(on ? 'on' : 'off'), attentionVolume: clampVolume(volume), setAttentionVolume: next => setVolume(clampVolume(next)), afterDispatch, setAfterDispatch, editor, setEditor, layout, setLayout, alerts,
    setAlert: (kind, on) => saveAlerts({ ...alerts, [kind]: on }),
    setKeybind: (id, combo) => saveKeybinds({ ...keybinds, [id]: combo }),
    resetKeybinds: () => saveKeybinds(keybindDefaults),
  };
  return <PreferencesContext.Provider value={value}><MotionConfig reducedMotion={motionConfig[motion]} transition={settle}>{children}</MotionConfig></PreferencesContext.Provider>;
}

export const usePreferences = () => useContext(PreferencesContext);

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
export const shortcutLabel = combo => formatCombo(combo, mac);
