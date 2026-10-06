import { useEffect, useState } from 'react';
import { Slider } from 'radix-ui';
import { ArrowUpRight, Bell, BellOff, ChevronsDown, Code, Database, FolderOpen, GitBranch, MessageCircleQuestion, Sparkles, HardDrive, House, Info, LayoutGrid, ScrollText, ListOrdered, Palette, ShieldCheck, MousePointer2, MousePointerClick, PanelBottomOpen, Square, SquareDashed, Volume1, Volume2 } from 'lucide-react';
import { SettingsLayout } from '@/components/SettingsLayout';
import { SettingsTabs } from '@/components/SettingsTabs';
import { StorageSettings } from '@/components/StorageSettings';
import { ChangelogDialog } from '@/components/ChangelogDialog';
import { IconButton } from '@/components/IconButton';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/Select';
import { LayoutPicker } from '@/components/LayoutDemo';
import { MotionChoice, ThemeChoice } from '@/components/AppearanceChoices';
import { maxConcurrency } from '../../src/catalog.mjs';
import { useAction } from '@/lib/use-action';
import { api, Link, useWorkspace } from '@/lib/workspace';
import { usePreferences } from '@/lib/preferences';
import { setPreference, usePreference } from '@/lib/server-preferences';
import { playPing } from '@/lib/ping';
import { version } from '../../package.json';

function About() {
  const [notes, setNotes] = useState(false);
  return <section className="panel" id="about"><h2>About dispatch</h2>
    <div className="setting-row"><span>Version</span><span className="setting-value">{version}<IconButton label="Release notes" icon={ScrollText} onClick={() => setNotes(true)}/></span></div>
    {notes && <ChangelogDialog all onClose={() => setNotes(false)}/>}
  </section>;
}

function Appearance() {
  return <section className="panel"><h2>Appearance</h2>
    <div className="setting-row"><span>Theme</span><ThemeChoice/></div>
    <div className="setting-row"><span>Motion</span><MotionChoice/></div>
  </section>;
}

function Home() {
  const { homeList, setHomeList, afterDispatch, setAfterDispatch } = usePreferences();
  return <section className="panel"><h2>Home</h2>
    <div className="setting-row"><span>Task list</span><div className="segmented" role="group" aria-label="Task list">
      <IconButton label="Reveal the task list by scrolling" icon={ChevronsDown} aria-pressed={homeList === 'reveal'} onClick={() => setHomeList('reveal')}/>
      <IconButton label="Show the task list open" icon={PanelBottomOpen} aria-pressed={homeList === 'open'} onClick={() => setHomeList('open')}/>
    </div></div>
    <div className="setting-row"><span>After dispatch</span><div className="segmented" role="group" aria-label="After dispatch">
      <IconButton label="Open the run" icon={ArrowUpRight} aria-pressed={afterDispatch === 'open'} onClick={() => setAfterDispatch('open')}/>
      <IconButton label="Stay on home" icon={House} aria-pressed={afterDispatch === 'stay'} onClick={() => setAfterDispatch('stay')}/>
    </div></div>
  </section>;
}

const alertSettings = [
  { kind: 'usage', label: 'Plan usage', subject: 'when a provider plan limit is almost used up' },
  { kind: 'review', label: 'Review backlog', subject: 'when more than five tasks wait for review' },
  { kind: 'storage', label: 'Storage', subject: 'when old completed tasks pile up' },
  { kind: 'folders', label: 'Folder suggestions', subject: 'when unfiled tasks have a suggested folder' },
];

function AlertRow({ kind, label, subject, on, onChange }) {
  return <div className="setting-row"><span>{label}</span><div className="segmented" role="group" aria-label={`${label} alert`}>
    <IconButton label={`Never alert ${subject}`} icon={BellOff} aria-pressed={!on} onClick={() => onChange(kind, false)}/>
    <IconButton label={`Alert on home ${subject}`} icon={Bell} aria-pressed={on} onClick={() => onChange(kind, true)}/>
  </div></div>;
}

function HomeAlerts() {
  const { alerts, setAlert } = usePreferences();
  return <section className="panel" id="alerts"><h2>Home alerts</h2>
    {alertSettings.map(setting => <AlertRow key={setting.kind} {...setting} on={alerts[setting.kind]} onChange={setAlert}/>)}
  </section>;
}

function Notifications() {
  const { attentionSound, setAttentionSound, attentionVolume, setAttentionVolume } = usePreferences();
  return <><section className="panel" id="notifications"><h2>Notifications</h2>
    <div className="setting-row"><span>Sound</span><div className="segmented" role="group" aria-label="Sound">
      <IconButton label="Stay silent" icon={BellOff} aria-pressed={!attentionSound} onClick={() => setAttentionSound(false)}/>
      <IconButton label="Ping when a task needs you or is ready for review" icon={Bell} aria-pressed={attentionSound} onClick={() => setAttentionSound(true)}/>
    </div></div>
    <div className="setting-row"><span>Volume</span><div className="volume-control">
      <Slider.Root className="slider volume-slider" min={0} max={100} step={5} value={[attentionVolume]} onValueChange={([next]) => setAttentionVolume(next)}>
        <Slider.Track className="slider-track"><Slider.Range className="slider-range"/></Slider.Track>
        <Slider.Thumb className="slider-thumb" aria-label="Ping volume" aria-valuetext={`${attentionVolume}%`}/>
      </Slider.Root>
      <IconButton label="Play the decision ping" icon={Volume2} onClick={() => playPing(attentionVolume)}/>
      <IconButton label="Play the ready for review ping" icon={Volume1} onClick={() => playPing(attentionVolume, 'review')}/>
    </div></div>
    <p className="muted">The tab title shows how many tasks need you. A decision adds “!” and a red dot to the tab, and the title alternates while the tab is in the background.</p>
  </section><HomeAlerts/></>;
}

function Tiles() {
  const focus = usePreference('runs.tileFocus'), setFocus = value => setPreference('runs.tileFocus', value), stroke = usePreference('runs.tileStroke'), setStroke = value => setPreference('runs.tileStroke', value), { layout, setLayout } = usePreferences();
  return <section className="panel" id="tiles"><h2>Tiles</h2>
    <div className="setting-row is-stacked"><span>Layout</span><LayoutPicker value={layout} onChange={setLayout}/></div>
    <div className="setting-row"><span>Focus</span><div className="segmented" role="group" aria-label="Tile focus">
      <IconButton label="Focus follows the mouse" icon={MousePointer2} aria-pressed={focus === 'hover'} onClick={() => setFocus('hover')}/>
      <IconButton label="Focus on click" icon={MousePointerClick} aria-pressed={focus === 'click'} onClick={() => setFocus('click')}/>
    </div></div>
    <div className="setting-row"><span>Focus outline</span><div className="segmented" role="group" aria-label="Tile focus outline">
      <IconButton label="Outline the focused tile" icon={Square} aria-pressed={stroke === 'on'} onClick={() => setStroke('on')}/>
      <IconButton label="Hide the focus outline" icon={SquareDashed} aria-pressed={stroke === 'off'} onClick={() => setStroke('off')}/>
    </div></div>
    <p className="muted">Tile shortcuts live in <Link href="/setup/keyboard">Keyboard</Link>.</p>
  </section>;
}

function Editor() {
  const { editor, setEditor } = usePreferences(), [detected, setDetected] = useState(null), [error, setError] = useState('');
  useEffect(() => { api('/api/editors').then(setDetected, failure => setError(failure.message)); }, []);
  const editors = detected?.editors ?? [], fallback = editors[0]?.name;
  const missing = editor && detected && !editors.some(item => item.command === editor);
  return <section className="panel" id="editor"><h2>Editor</h2>
    <div className="setting-row"><label htmlFor="editor">Open in editor uses</label><Select id="editor" value={editor} disabled={!detected || detected.override} onChange={event => setEditor(event.target.value)}>
      <option value="">{fallback ? `Automatic (${fallback})` : 'Automatic'}</option>
      {editors.map(item => <option key={item.command} value={item.command}>{item.name} ({item.command})</option>)}
      {missing && <option value={editor}>{editor} (not found)</option>}
    </Select></div>
    {detected?.override && <p className="muted">DISPATCH_EDITOR is set to {detected.default}, so it takes precedence.</p>}
    {detected && !detected.override && !editors.length && <p className="error">No supported editor was found on dispatch’s PATH. Install one, or set DISPATCH_EDITOR for the dispatch server.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="muted">Automatic uses the first editor found on PATH. The list shows editors dispatch can launch.</p>
  </section>;
}

const accessNotes = {
  home: 'Agents can write in the run’s worktree and anywhere in your home folder. The OS sandbox stays on and network access stays off.',
  full: 'No sandbox: agents can write anywhere your user can, including the dispatch checkout, its data and hidden folders like ~/.ssh, and can use the network.',
};

function AgentAccess({ busy, onChange }) {
  const { state } = useWorkspace(), mode = state.accessMode ?? 'home';
  return <section className="panel" id="access"><h2>Agent access</h2><div className="segmented" role="group" aria-label="Agent access">
    <IconButton label="Home folder" icon={FolderOpen} aria-pressed={mode === 'home'} disabled={busy} onClick={() => onChange('home')}/>
    <IconButton label="Full access" icon={HardDrive} aria-pressed={mode === 'full'} disabled={busy} onClick={() => onChange('full')}/>
  </div><p className={mode === 'full' ? 'error' : 'muted'}>{accessNotes[mode]}</p><p className="muted">Applies to runs started after the change. dispatch checks and commits only the worktree.</p></section>;
}

const branchNotes = {
  auto: 'Branches are named dispatch/<run>, or what the ticket’s connector proposes when you turn that on in the connector’s settings. A branch.template preference in the Brain overrides both.',
  ask: 'Before a task you send from the composer starts, dispatch suggests branch names and you pick one or type your own. Saved tasks started from the list use the automatic name.',
};

function Branches({ busy, onChange }) {
  const { state } = useWorkspace(), mode = state.branchNaming ?? 'auto';
  return <section className="panel" id="branches"><h2>Branch names</h2><div className="segmented" role="group" aria-label="Branch names">
    <Button variant="ghost" aria-pressed={mode === 'auto'} disabled={busy} onClick={() => onChange('auto')}><Sparkles aria-hidden="true"/>Pick automatically</Button>
    <Button variant="ghost" aria-pressed={mode === 'ask'} disabled={busy} onClick={() => onChange('ask')}><MessageCircleQuestion aria-hidden="true"/>Ask me each time</Button>
  </div><p className="muted">{branchNotes[mode]}</p></section>;
}

function Queue({ busy, onChange }) {
  const { state } = useWorkspace();
  return <section className="panel" id="queue"><h2>Queue</h2>
    <div className="setting-row"><label htmlFor="concurrency">Tasks at a time</label><Select id="concurrency" value={state.concurrency ?? 1} disabled={busy} onChange={event => onChange(Number(event.target.value))}>
      {Array.from({ length: maxConcurrency }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}
    </Select></div>
    <p className="muted">Each task works in its own worktree; the rest wait as Queued. Start a queued task early from its state menu on Home.</p>
  </section>;
}

export function Setup() {
  const { busy, error, perform } = useAction();
  const tabs = [
    { value: 'appearance', label: 'Appearance', icon: Palette, content: <Appearance/> },
    { value: 'home', label: 'Home', icon: House, content: <Home/> },
    { value: 'notifications', label: 'Notifications', icon: Bell, content: <Notifications/> },
    { value: 'tiles', label: 'Tiles', icon: LayoutGrid, content: <Tiles/> },
    { value: 'editor', label: 'Editor', icon: Code, content: <Editor/> },
    { value: 'access', label: 'Agent access', icon: ShieldCheck, content: <AgentAccess busy={busy} onChange={mode => perform(async () => { await api('/api/access', { mode }); window.dispatchEvent(new Event('dispatch-refresh')); })}/> },
    { value: 'branches', label: 'Branches', icon: GitBranch, content: <Branches busy={busy} onChange={mode => perform(async () => { await api('/api/branch-naming', { mode }); window.dispatchEvent(new Event('dispatch-refresh')); })}/> },
    { value: 'queue', label: 'Queue', icon: ListOrdered, content: <Queue busy={busy} onChange={concurrency => perform(async () => { await api('/api/concurrency', { concurrency }); window.dispatchEvent(new Event('dispatch-refresh')); })}/> },
    { value: 'storage', label: 'Storage', icon: Database, content: <StorageSettings/> },
    { value: 'about', label: 'About', icon: Info, content: <About/> },
  ];
  return <SettingsLayout title="Settings" description="Appearance, home, notifications, tiles, editor, agent access, branches, queue and storage.">
    <SettingsTabs label="Settings sections" tabs={tabs}/>
    {error && <p role="alert" className="error">{error}</p>}
  </SettingsLayout>;
}
