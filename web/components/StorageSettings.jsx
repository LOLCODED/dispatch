import { useEffect, useState } from 'react';
import { Check, RefreshCw, Trash2, X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { ListControls, Pager, useFittedPageSize, useListControls, usePage } from '@/components/ListControls';
import { Select } from '@/components/Select';
import { StatusIcon } from '@/components/StatusIcon';
import { useAction } from '@/lib/use-action';
import { byText, descending, filterSort, textMatches, timeOf } from '@/lib/list-view.mjs';
import { relativeTime } from '@/lib/status.mjs';
import { api, Link, useWorkspace } from '@/lib/workspace';
import { formatBytes, purgeTargets } from '../../src/storage-plan.mjs';

const ageLabels = { 0: 'Any time', 1: 'Over a day ago', 7: 'Over a week ago', 30: 'Over a month ago' };
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const taskPageSize = 25;
const taskSorts = [
  { value: 'largest', label: 'Largest', compare: descending(task => task.bytes) },
  { value: 'recent', label: 'Recent activity', compare: descending(task => timeOf(task.lastActivityAt)) },
  { value: 'title', label: 'Title', compare: byText(task => task.title) },
];
const taskMatches = (task, query) => textMatches([task.title, task.project], query);

function ConfirmButton({ label, confirmLabel, icon, disabled, onConfirm }) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <IconButton label={label} icon={icon} disabled={disabled} onClick={() => setArmed(true)}/>;
  return <span className="confirm-actions">
    <IconButton label={confirmLabel} icon={Check} variant="destructive" disabled={disabled} onClick={() => { setArmed(false); onConfirm(); }}/>
    <IconButton label="Cancel" icon={X} onClick={() => setArmed(false)}/>
  </span>;
}

function Usage({ usage, busy, onMeasure, onClearBrowser }) {
  return <section className="panel" id="storage"><div className="section-heading"><h2>Storage</h2><IconButton label="Measure again" icon={RefreshCw} disabled={busy} onClick={onMeasure}/></div>
    {!usage ? <p className="muted" role="status">Measuring…</p> : <>
      <p className="muted">dispatch uses {formatBytes(usage.totalBytes)} in <code>{usage.dataDir}</code>{usage.freeBytes !== null && `; ${formatBytes(usage.freeBytes)} free on this disk`}.</p>
      {usage.categories.map(category => <div className="setting-row" key={category.id}><span>{category.label}</span><span className="storage-size">{formatBytes(category.bytes)}
        {category.id === 'browser' && <ConfirmButton label="Clear browser profiles" confirmLabel="Clear browser profiles, including their sign-ins" icon={Trash2} disabled={busy || category.bytes === 0} onConfirm={onClearBrowser}/>}
      </span></div>)}
    </>}
  </section>;
}

function Purge({ tasks, busy, onPurge }) {
  const [scope, setScope] = useState('worktrees'), [age, setAge] = useState(7);
  const targets = purgeTargets(tasks, { scope, olderThanDays: age }), bytes = targets.reduce((sum, task) => sum + (scope === 'tasks' ? task.bytes : task.worktreeBytes), 0);
  return <section className="panel" id="purge"><h2>Clean up</h2>
    <div className="setting-row"><label htmlFor="purge-scope">Remove</label><Select id="purge-scope" value={scope} disabled={busy} onChange={event => setScope(event.target.value)}>
      <option value="worktrees">Worktrees only</option><option value="tasks">Whole tasks</option>
    </Select></div>
    <div className="setting-row"><label htmlFor="purge-age">Finished</label><Select id="purge-age" value={age} disabled={busy} onChange={event => setAge(Number(event.target.value))}>
      {Object.entries(ageLabels).map(([days, label]) => <option key={days} value={days}>{label}</option>)}
    </Select></div>
    <div className="setting-row"><span role="status">{targets.length ? `${plural(targets.length, 'task')}, about ${formatBytes(bytes)}` : 'Nothing to remove'}</span>
      <ConfirmButton label="Purge" confirmLabel={`Remove ${scope === 'tasks' ? '' : 'the worktrees of '}${plural(targets.length, 'task')}`} icon={Trash2} disabled={busy || !targets.length} onConfirm={() => onPurge({ scope, olderThanDays: age })}/></div>
    <p className="muted">{scope === 'tasks' ? 'Deletes finished tasks with their worktrees, images, evidence and logs.' : 'Removes worktrees of finished tasks; their history, evidence and logs stay.'} Branches with unpushed commits and repository memory are kept. Running tasks are never touched.</p>
  </section>;
}

function TaskRow({ task, busy, onDelete }) {
  const { state } = useWorkspace();
  return <li className="history-row"><StatusIcon run={task}/>
    <span className="history-title"><Link href={`/runs/${task.latestId}`}>{task.title}</Link><small>{[task.project, state.labels[task.status] ?? task.status, relativeTime(task.lastActivityAt)].filter(Boolean).join(' · ')}</small></span>
    <span className="history-stats">{formatBytes(task.bytes)}</span>
    <ConfirmButton label={task.finished ? 'Delete task' : 'Stop this task before deleting it'} confirmLabel={`Delete “${task.title}” and its files`} icon={Trash2} disabled={busy || !task.finished} onConfirm={() => onDelete(task.id)}/>
  </li>;
}

function TaskList({ usage, busy, onDelete }) {
  const controls = useListControls(taskSorts), all = usage?.tasks ?? [];
  const tasks = filterSort(all, { query: controls.query, matches: taskMatches, compare: controls.compare });
  const [listRef, pageSize] = useFittedPageSize(taskPageSize, tasks.length > 0);
  const paged = usePage(tasks, pageSize, `${controls.query}|${controls.sort}`);
  return <section className="panel" id="storage-tasks">
    <div className="section-heading"><h2>Tasks</h2><ListControls controls={controls} sorts={taskSorts} searchLabel="Search tasks" placeholder="Search tasks…"/></div>
    {tasks.length > 0 && <ul ref={listRef} className="history-list fit-list fit-list-floor">{paged.items.map(task => <TaskRow key={task.id} task={task} busy={busy} onDelete={onDelete}/>)}</ul>}
    <Pager paged={paged} label="Task pages"/>
    {all.length > 0 && !tasks.length && <p className="muted">Nothing matches the search.</p>}
    {!all.length && <p className="muted">{usage ? 'No tasks yet.' : 'Measuring…'}</p>}
  </section>;
}

export function StorageSettings() {
  const { busy, error, perform } = useAction(), [usage, setUsage] = useState(null), [notice, setNotice] = useState('');
  const measure = () => perform(async () => setUsage(await api('/api/storage')));
  const act = (path, input, describe) => perform(async () => {
    const result = await api(path, input);
    setNotice(describe(result)); window.dispatchEvent(new Event('dispatch-refresh'));
    setUsage(await api('/api/storage'));
  });
  useEffect(() => { measure(); }, []);
  const tasks = usage?.tasks ?? [];
  return <>
    <Usage usage={usage} busy={busy} onMeasure={measure} onClearBrowser={() => act('/api/storage/browser-profiles/clear', {}, () => 'Browser profiles cleared.')}/>
    <Purge tasks={tasks} busy={busy || !usage} onPurge={input => act('/api/storage/purge', input, result => `Removed ${plural(result.removed, 'task')}.${result.failed.length ? ` ${result.failed.length} could not be removed: ${result.failed.map(item => `${item.title} (${item.message})`).join('; ')}` : ''}`)}/>
    <TaskList usage={usage} busy={busy} onDelete={id => act(`/api/storage/tasks/${id}/delete`, {}, () => 'Task deleted.')}/>
    {notice && <p className="muted" role="status">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </>;
}
