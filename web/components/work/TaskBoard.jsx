import { useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, CornerUpLeft, FolderInput, GitMerge, GitPullRequest, Pencil } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { DecisionGroup } from '@/components/work/DecisionGroup';
import { FolderBar } from '@/components/work/FolderBar';
import { LandingMark } from '@/components/work/LandingMark';
import { StateDot, stateLabels } from '@/components/work/StateDot';
import { LandDialog } from '@/components/LandDialog';
import { PullRequestDialog } from '@/components/PullRequestDialog';
import { ListControls, Pager, useListControls, usePage } from '@/components/ListControls';
import { activityAt, boardView, editTarget } from '@/lib/board.mjs';
import { unfiledSuggestions } from '@/lib/folder-suggestion.mjs';
import { ascending, byText, filterSort, textMatches } from '@/lib/list-view.mjs';
import { boardScopeKey, useBoardAction } from '@/lib/board-actions';
import { relativeTime } from '@/lib/status.mjs';
import { useNow } from '@/lib/run-hooks';
import { duration, Link, preference, savePreference } from '@/lib/workspace';

function RowTime({ at, label, children }) {
  if (!at) return null;
  return <time className="board-row-time" dateTime={at} title={`${label} ${new Date(at).toLocaleString()}`}>{children ?? relativeTime(at)}</time>;
}

function RunningTime({ since }) {
  const now = useNow(true);
  return <RowTime at={since} label="Running since">{duration(Math.max(0, now - Date.parse(since)))}</RowTime>;
}

function EntryTime({ entry }) {
  const { state, latest } = entry;
  if (state === 'active') return <RunningTime since={entry.startedAt ?? latest.startedAt ?? latest.createdAt}/>;
  if (state === 'queued' || state === 'todo') return <RowTime at={latest?.createdAt ?? entry.createdAt} label="Sent"/>;
  return <RowTime at={latest?.finishedAt} label="Last reply"/>;
}

function TaskRow({ entry, folders, suggestions, onEdit, selection }) {
  const { busy, error, send } = useBoardAction(), edit = editTarget(entry), suggestion = suggestions?.get(entry.key);
  return <li className="board-row" data-run={entry.latest?.id}>
    {selection && <IconButton label={`Select ${entry.title} ${entry.latest.landable ? 'to land' : 'for a pull request'}`} icon={Check} size="icon-xs" className="board-row-select" aria-pressed={selection.checked} onClick={() => selection.onChange(!selection.checked)}/>}
    <StateDot entry={entry} folders={folders} busy={busy} onAction={send}/>
    <LandingMark entry={entry}/>
    {entry.latest ? <Link href={`/runs/${entry.latest.id}`} className="board-title">{entry.title}</Link> : <span className="board-title">{entry.title}</span>}
    {!entry.latest && entry.sourceRunId && <IconButton label="Open the run this task came from" icon={CornerUpLeft} href={`/runs/${entry.sourceRunId}`}/>}
    {suggestion && <IconButton label={`Move to ${suggestion.folder.name} · ${suggestion.reason}`} icon={FolderInput} size="icon-xs" className="board-row-suggest" disabled={busy} onClick={() => send(`/api/board/items/${entry.key}`, { folderId: suggestion.folder.id })}/>}
    {edit && <IconButton label="Edit" icon={Pencil} size="icon-xs" className="board-row-edit" disabled={busy} onClick={() => onEdit(edit)}/>}
    <EntryTime entry={entry}/>
    {error && <p className="error" role="alert">{error}</p>}
  </li>;
}

const selectable = run => Boolean(run?.landable || run?.publishable);

function useSelection(entries) {
  const [chosen, setChosen] = useState([]);
  const runs = entries.map(entry => entry.latest).filter(run => selectable(run) && chosen.includes(run.id));
  const landable = runs.length > 0 && runs.every(run => run.landable && run.projectId === runs[0].projectId), publishable = runs.length > 0 && runs.every(run => run.publishable);
  const selection = ({ latest }) => selectable(latest) ? { checked: chosen.includes(latest.id), onChange: on => setChosen(current => on ? [...current, latest.id] : current.filter(id => id !== latest.id)) } : null;
  return { runs, landable, publishable, selection, clear: () => setChosen([]) };
}

function SelectionActions({ runs, landable, publishable, onAction }) {
  return <>
    {landable && <IconButton label={`Land ${runs.length} selected`} icon={GitMerge} className="board-land" onClick={() => onAction('land')}/>}
    {publishable && <IconButton label={`Open ${runs.length === 1 ? 'a pull request' : `${runs.length} pull requests`}`} icon={GitPullRequest} className="board-land" onClick={() => onAction('pull-request')}/>}
  </>;
}

const groupPageSize = 10;
const taskSorts = [
  { value: 'recent', label: 'Latest activity' },
  { value: 'oldest', label: 'Oldest first', compare: ascending(activityAt) },
  { value: 'name', label: 'Name', compare: byText(entry => entry.title) },
];
const entryMatches = (entry, query) => textMatches([entry.title, entry.request], query);

function Group({ state, entries, folders, suggestions, onEdit, resetKey }) {
  const { runs, landable, publishable, selection, clear } = useSelection(entries), [dialog, setDialog] = useState(null), review = state === 'review';
  const close = () => { setDialog(null); clear(); };
  const paged = usePage(entries, groupPageSize, resetKey);
  if (!entries.length) return null;
  return <section className="board-group" aria-labelledby={`group-${state}`}>
    <div className="board-group-head">
      <h2 id={`group-${state}`}><span className={`board-dot state-${state}`} aria-hidden="true"/>{stateLabels[state]}{review && <SelectionActions runs={runs} landable={landable} publishable={publishable} onAction={setDialog}/>}</h2>
      <Pager paged={paged} label={`${stateLabels[state]} pages`}/>
    </div>
    <ul>{paged.items.map(entry => <TaskRow key={entry.key} entry={entry} folders={folders} suggestions={suggestions} onEdit={onEdit} selection={review ? selection(entry) : null}/>)}</ul>
    {dialog === 'land' && <LandDialog runs={runs} onClose={close}/>}
    {dialog === 'pull-request' && <PullRequestDialog runs={runs} onClose={close}/>}
  </section>;
}

function Collapsed({ state, entries, folders, suggestions, onEdit, resetKey }) {
  const [open, setOpen] = useState(false), paged = usePage(entries, groupPageSize, resetKey);
  if (!entries.length) return null;
  return <section className={`board-collapsed board-${state}`}>
    <div className="board-group-head">
      <button type="button" className="collapsed-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{entries.length} {state}<ChevronDown size={12} aria-hidden="true"/></button>
      {open && <Pager paged={paged} label={`${stateLabels[state]} pages`}/>}
    </div>
    {open && <ul>{paged.items.map(entry => <TaskRow key={entry.key} entry={entry} folders={folders} suggestions={suggestions} onEdit={onEdit}/>)}</ul>}
  </section>;
}

function useScope(folders) {
  const [scope, setScope] = useState(() => preference(boardScopeKey) || null);
  const choose = id => { setScope(id); savePreference(boardScopeKey, id ?? ''); };
  return [folders.some(folder => folder.id === scope) ? scope : null, choose];
}

export function TaskBoard({ runs, tasks, board, projects, onEdit }) {
  const folders = board?.folders ?? [], [scope, setScope] = useScope(folders), controls = useListControls(taskSorts);
  const view = Object.fromEntries(Object.entries(boardView({ runs, tasks, board, folderId: scope })).map(([group, entries]) => [group, filterSort(entries, { query: controls.query, matches: entryMatches, compare: controls.compare })]));
  const suggestions = new Map(unfiledSuggestions(Object.values(boardView({ runs, tasks, board })).flat(), folders).map(({ entry, folder, reason }) => [entry.key, { folder, reason }]));
  const resetKey = `${scope}|${controls.query}|${controls.sort}`, empty = !runs.length && !tasks.length;
  if (empty) return <div className="empty"><ArrowUpRight aria-hidden="true"/><p>No work yet. {projects.length ? 'Drop a ticket above and give it a direction.' : <Link href="/admin/projects/new">Connect your first repository to get moving.</Link>}</p></div>;
  return <div className="task-board" role="region" aria-label="Tasks">
    <div className="board-toolbar"><FolderBar folders={folders} scope={scope} onScope={setScope}/><ListControls controls={controls} sorts={taskSorts} searchLabel="Search tasks" placeholder="Search tasks…"/></div>
    {controls.query.trim() && !Object.values(view).some(entries => entries.length) && <p className="muted">Nothing matches the search.</p>}
    <DecisionGroup entries={view.decision} folders={folders} reviewing={view.review.length > 0}/>
    {['active', 'reviewing', 'queued', 'review', 'awaiting', 'todo'].map(state => <Group key={state} state={state} entries={view[state]} folders={folders} suggestions={suggestions} onEdit={onEdit} resetKey={resetKey}/>)}
    <Collapsed state="completed" entries={view.completed} folders={folders} suggestions={suggestions} onEdit={onEdit} resetKey={resetKey}/>
    <Collapsed state="archived" entries={view.archived} folders={folders} resetKey={resetKey}/>
  </div>;
}
