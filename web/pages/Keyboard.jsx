import { useEffect, useState } from 'react';
import { Keyboard as KeyboardIcon, Lock, RotateCcw, X } from 'lucide-react';
import { SettingsLayout } from '@/components/SettingsLayout';
import { SettingsTabs } from '@/components/SettingsTabs';
import { IconButton } from '@/components/IconButton';
import { comboOf, conflictOf, keybindActions, keybindDefaults, modifiersFrom } from '@/lib/keybinds.mjs';
import { shortcutLabel, usePreferences } from '@/lib/preferences';

const fixed = [
  ['Escape', 'Leave full screen, close the drawer or a preview'],
  ['Tab', 'Accept the suggested reply'],
  ['←  →', 'Step through the timeline or previews'],
];

function Keys({ combo }) {
  return <span className="keys">{shortcutLabel(combo).split('+').map((part, index) => <kbd key={index}>{part}</kbd>)}</span>;
}

function captured(action, event) {
  if (action.modifiersOnly) return /^Digit\d$/.test(event.code) ? modifiersFrom(event) || null : null;
  return comboOf(event);
}

function useRecorder(onCapture) {
  const [recording, setRecording] = useState(null);
  useEffect(() => {
    if (!recording) return;
    const key = event => {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { setRecording(null); return; }
      const combo = captured(recording, event);
      if (combo) { onCapture(recording, combo); setRecording(null); }
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [recording, onCapture]);
  return [recording, setRecording];
}

function ShortcutRow({ action, combo, recording, onRecord, onCancel, onReset }) {
  const display = action.modifiersOnly ? `${combo}+1–4` : combo;
  return <li className="shortcut-row">
    <span>{action.label}</span>
    {recording ? <span className="keys is-recording" role="status">{action.modifiersOnly ? 'Hold modifiers and press a digit…' : 'Press the new shortcut…'}</span> : <Keys combo={display}/>}
    <span className="shortcut-actions">
      {recording ? <IconButton label="Cancel recording" icon={X} onClick={onCancel}/> : <IconButton label={`Change shortcut: ${action.label}`} icon={KeyboardIcon} onClick={onRecord}/>}
      <IconButton label={`Reset shortcut: ${action.label}`} icon={RotateCcw} disabled={combo === keybindDefaults[action.id]} onClick={onReset}/>
    </span>
  </li>;
}

function FixedKeys() {
  return <section className="panel"><h2>Fixed keys</h2>
    <ul className="shortcut-list">{fixed.map(([keys, label]) => <li key={keys} className="shortcut-row"><span>{label}</span><span className="keys"><kbd>{keys}</kbd></span></li>)}</ul>
  </section>;
}

export function Keyboard() {
  const { keybinds, setKeybind, resetKeybinds } = usePreferences(), [error, setError] = useState('');
  const capture = (action, combo) => {
    const clash = conflictOf(keybinds, action.id, combo);
    if (clash) { setError(`${shortcutLabel(combo)} already does “${clash}”.`); return; }
    setError(''); setKeybind(action.id, combo);
  };
  const [recording, setRecording] = useRecorder(capture);
  const shortcuts = <section className="panel"><h2>Shortcuts</h2>
    <ul className="shortcut-list">{keybindActions.map(action => <ShortcutRow key={action.id} action={action} combo={keybinds[action.id]} recording={recording?.id === action.id} onRecord={() => { setError(''); setRecording(action); }} onCancel={() => setRecording(null)} onReset={() => setKeybind(action.id, keybindDefaults[action.id])}/>)}</ul>
    {error && <p className="error" role="alert">{error}</p>}
    <p className="muted">Shortcuts without Ctrl, Alt or ⌘ are ignored while typing. Some browsers keep Alt+letter shortcuts for their own menus.</p>
  </section>;
  return <SettingsLayout title="Keyboard" description="Shortcuts supplement the visible controls; every action also has a button." actions={<IconButton label="Reset all shortcuts" icon={RotateCcw} variant="outline" onClick={() => { setError(''); resetKeybinds(); }}/>}>
    <SettingsTabs label="Keyboard sections" tabs={[
      { value: 'shortcuts', label: 'Shortcuts', icon: KeyboardIcon, count: keybindActions.length, content: shortcuts },
      { value: 'fixed', label: 'Fixed keys', icon: Lock, count: fixed.length, content: <FixedKeys/> },
    ]}/>
  </SettingsLayout>;
}
