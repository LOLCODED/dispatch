import { useMemo, useState } from 'react';
import { ArrowLeftRight, CircleCheck, CircleX, Database, GitPullRequest, LoaderCircle, ScrollText } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { useRunSteps } from '@/lib/steps';
import { useFollowLatest } from '@/lib/follow-latest';
import { duration } from '@/lib/workspace';
import { backendEntries, backendFilters } from '../../../src/backend-steps.mjs';

const kindIcons = { http: ArrowLeftRight, logs: ScrollText, sql: Database, ci: GitPullRequest };

function EntryRow({ entry }) {
  const Kind = kindIcons[entry.kind], Status = entry.pending ? LoaderCircle : entry.isError ? CircleX : CircleCheck;
  return <details className={`check-result check-${entry.pending ? 'running' : entry.isError ? 'failed' : 'passed'}`}>
    <summary><Kind size={14} aria-label={entry.kind}/><span className="check-name">{entry.title}</span><Status size={12} aria-label={entry.pending ? 'running' : entry.isError ? 'error' : 'done'} className="check-icon"/><small>{entry.pending ? '' : duration(entry.durationMs)}</small></summary>
    <pre>{entry.output ?? 'Waiting for the result…'}</pre>
  </details>;
}

export function BackendTile({ run }) {
  const { steps, error } = useRunSteps(run.id, run.stepCount ?? 0), [only, setOnly] = useState(null);
  const entries = useMemo(() => backendEntries(steps), [steps]), kinds = new Set(entries.map(entry => entry.kind));
  const shown = only ? entries.filter(entry => entry.kind === only) : entries, list = useFollowLatest(shown.length);
  return <div className="timeline-tile backend-tile">
    <div className="timeline-toolbar"><span className="timeline-filters">{backendFilters.filter(([kind]) => kinds.has(kind)).map(([kind, label]) => <IconButton key={kind} label={`${label} only`} icon={kindIcons[kind]} aria-pressed={only === kind} onClick={() => setOnly(only === kind ? null : kind)}/>)}</span></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div ref={list.ref} className="timeline-feed" onScroll={list.onScroll}>{shown.length ? shown.map(entry => <EntryRow key={entry.id} entry={entry}/>) : <p className="muted">HTTP calls, service logs, SQL results and CI reads appear here as the agent makes them.</p>}</div>
  </div>;
}
