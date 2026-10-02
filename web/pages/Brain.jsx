import { useEffect, useMemo, useState } from 'react';
import { List, Waypoints, X } from 'lucide-react';
import { SettingsLayout } from '@/components/SettingsLayout';
import { BrainEntry } from '@/components/brain/BrainEntry';
import { BrainGraph } from '@/components/brain/BrainGraph';
import { TestingDecisions } from '@/components/brain/TestingDecisions';
import { MemoryList } from '@/components/brain/MemoryList';
import { SettingsTabs } from '@/components/SettingsTabs';
import { IconButton } from '@/components/IconButton';
import { SearchInput } from '@/components/ListControls';
import { api, useWorkspace } from '@/lib/workspace';
import { useAction } from '@/lib/use-action';
import { kindLabels, kindOrder, matchesFilter, scopeName } from '@/lib/brain.mjs';
import { buildGraph, linkedEntries } from '@/lib/brain-graph.mjs';

const listLimit = 8;

function useBrain() {
  const [data, setData] = useState({ entries: [], ladder: null }), { busy, error, perform } = useAction();
  const load = () => perform(async () => setData(await api('/api/brain')));
  useEffect(() => { load(); }, []);
  const change = (entry, patch, operation) => {
    setData(current => ({ ...current, entries: patch ? current.entries.map(item => item.id === entry.id ? { ...item, ...patch } : item) : current.entries.filter(item => item.id !== entry.id) }));
    return perform(async () => { await operation(); setData(await api('/api/brain')); });
  };
  return { ...data, busy, error, toggle: (entry, enabled) => change(entry, { enabled }, () => api(`/api/brain/${entry.id}`, { enabled })), mode: (entry, mode) => change(entry, { mode, pinned: true }, () => api(`/api/brain/${entry.id}`, { mode })), forget: entry => change(entry, null, () => api(`/api/brain/${entry.id}/delete`, {})) };
}

// The layout only depends on which memories exist and where they live, so toggles and the workspace poll do not reshuffle it.
function useGraph(entries, projects) {
  const shape = entries.map(entry => `${entry.id}:${entry.scope}:${entry.label}`).join('|'), places = projects.map(project => `${project.id}:${project.name}`).join('|');
  return useMemo(() => buildGraph(entries, projects), [shape, places]);
}

function KindLegend({ hidden, onToggle }) {
  return <div className="brain-legend" role="group" aria-label="Kinds">{kindOrder.map(kind => <button key={kind} type="button" className={`brain-kind kind-${kind}`} aria-pressed={!hidden.has(kind)} onClick={() => onToggle(kind)}><span aria-hidden="true"/>{kindLabels[kind]}</button>)}</div>;
}

function EntryLinks({ label, entries, onSelect }) {
  if (!entries.length) return null;
  return <nav className="brain-links" aria-label={label}><h3>{label}</h3><ul>{entries.slice(0, listLimit).map(entry => <li key={entry.id}><button type="button" className={`kind-${entry.kind}`} onClick={() => onSelect(entry.id)}><span aria-hidden="true"/>{entry.label}</button></li>)}</ul>{entries.length > listLimit && <p className="muted">{entries.length - listLimit} more</p>}</nav>;
}

function Detail({ entry, linked, projects, brain, onSelect }) {
  return <aside className="brain-detail" aria-label="Selected memory">
    <div className="section-heading"><h2>{kindLabels[entry.kind]} · {scopeName(entry.scope, projects)}</h2><IconButton label="Close" icon={X} onClick={() => onSelect(null)}/></div>
    <ul className="brain-list"><BrainEntry entry={entry} busy={brain.busy} onToggle={brain.toggle} onMode={brain.mode} onForget={brain.forget}/></ul>
    <EntryLinks label="Linked memories" entries={linked} onSelect={onSelect}/>
  </aside>;
}

const emptyBrain = <section className="panel"><p className="empty">Nothing remembered yet. Rules, answers and agent notes appear here as you work.</p></section>;

function Filters({ filter, onFilter, legend, matches, onSelect }) {
  return <section className="panel brain-filters">
    <SearchInput label="Filter" value={filter} onChange={onFilter} placeholder="Search memory…"/>
    {legend}
    {matches && (matches.length ? <EntryLinks label="Matches" entries={matches} onSelect={onSelect}/> : <p className="empty">Nothing matches the filter.</p>)}
  </section>;
}

export function Brain() {
  const { state } = useWorkspace(), brain = useBrain();
  const [filter, setFilter] = useState(''), [hidden, setHidden] = useState(() => new Set()), [selected, setSelected] = useState(null);
  const shown = brain.entries.filter(entry => !hidden.has(entry.kind)), graph = useGraph(shown, state.projects);
  const matches = filter.trim() ? shown.filter(entry => matchesFilter(entry, filter)) : null;
  const matched = useMemo(() => matches && new Set(matches.map(entry => entry.id)), [matches?.map(entry => entry.id).join()]);
  const disabled = useMemo(() => new Set(shown.filter(entry => !entry.enabled).map(entry => entry.id)), [shown.map(entry => `${entry.id}${entry.enabled}`).join()]);
  const entry = shown.find(item => item.id === selected), linkedIds = entry ? linkedEntries(graph, entry.id) : null;
  const toggleKind = kind => setHidden(current => { const next = new Set(current); next.has(kind) ? next.delete(kind) : next.add(kind); return next; });
  const scopes = new Set(shown.map(item => item.scope)).size, legend = <KindLegend hidden={hidden} onToggle={toggleKind}/>;
  const map = brain.entries.length ? <><Filters filter={filter} onFilter={setFilter} legend={legend} matches={matches} onSelect={setSelected}/><div className="brain-stage">
    <BrainGraph graph={graph} matched={matched} disabled={disabled} selected={entry?.id ?? null} onSelect={setSelected} label={`Memory graph: ${shown.length} memories across ${scopes} ${scopes === 1 ? 'scope' : 'scopes'}`}/>
    {entry && <Detail entry={entry} linked={shown.filter(item => linkedIds.has(item.id))} projects={state.projects} brain={brain} onSelect={setSelected}/>}
  </div></> : emptyBrain;
  return <SettingsLayout title="Brain" className="brain-page" description="Everything dispatch remembers, linked by repository, the run that taught it and shared words. Select a memory to turn it off or forget it, or type /forget in the composer.">
    {brain.error && <p className="error" role="alert">{brain.error}</p>}
    <SettingsTabs label="Brain views" tabs={[
      { value: 'map', label: 'Map', icon: Waypoints, content: map },
      { value: 'testing', label: 'Testing decisions', icon: List, count: brain.riskDecisions?.length ?? 0, content: <TestingDecisions decisions={brain.riskDecisions ?? []} projects={state.projects}/> },
      { value: 'memories', label: 'Memories', icon: List, count: shown.length, content: brain.entries.length ? <MemoryList entries={shown} brain={brain} legend={legend} resetKey={[...hidden].join()}/> : emptyBrain },
    ]}/>
    {brain.ladder && <p className="muted brain-ladder">Preferences move from ask to suggest after {brain.ladder.suggest} matching answers and to auto after {brain.ladder.auto}; a different answer or an undo starts over. Pin a mode to stop the ladder.</p>}
  </SettingsLayout>;
}
