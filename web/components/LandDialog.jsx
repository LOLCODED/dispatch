import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { GitBranch, GitMerge, X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Select } from '@/components/Select';
import { SearchSelect } from '@/components/SearchSelect';
import { useAction } from '@/lib/use-action';
import { branchLimit } from '@/lib/branches.mjs';
import { api, navigate, preference, savePreference, useWorkspace } from '@/lib/workspace';

const strategyKey = 'dispatch-land-strategy';
const strategies = { squash: 'Squash: one commit per task', rebase: 'Rebase: replay each task\'s commits', merge: 'Merge: a merge commit per task' };

// Every repository the selected tasks will move: the primary first, then linked repositories with tested commits.
export function landingRepositories(runs) {
  const seen = new Map();
  for (const run of runs) for (const item of run.repositories ?? [{ projectId: run.projectId, name: run.project?.name, primary: true }]) if (!seen.has(item.projectId)) seen.set(item.projectId, item);
  return [...seen.values()].sort((a, b) => Number(b.primary) - Number(a.primary));
}

function TargetBranch({ repository, value, onChange }) {
  const [branches, setBranches] = useState(null), { state } = useWorkspace();
  useEffect(() => {
    const controller = new AbortController();
    api(`/api/projects/${repository.projectId}/branches`, undefined, controller.signal).then(result => { setBranches(result.branches); onChange(repository.projectId, result.base); }).catch(() => setBranches([]));
    return () => controller.abort();
  }, [repository.projectId, onChange]);
  return <SearchSelect aria-label={repository.primary ? 'Target branch' : `Target branch for ${repository.name}`} icon={GitBranch} limit={branchLimit(state.projects.find(project => project.id === repository.projectId))} searchLabel="Search branches" value={value ?? ''} disabled={!branches?.length} onChange={event => onChange(repository.projectId, event.target.value)}>{(branches ?? []).map(name => <option key={name} value={name}>{name}</option>)}</SearchSelect>;
}

function landingNote(repositories, targets, target) {
  if (repositories.length === 1) return `The repository's checks run once on the combined result, and ${target || 'the branch'} moves only if they pass. `;
  return `Each repository's checks run once on its combined result; no branch moves unless every repository passes: ${repositories.map(repository => `${repository.name} on ${targets[repository.projectId] || '…'}`).join(', ')}. `;
}

export function LandForm({ runs, onLanded, noteId, note = true }) {
  const repositories = landingRepositories(runs), [targets, setTargets] = useState({});
  const chooseTarget = useRef((projectId, branch) => setTargets(current => ({ ...current, [projectId]: branch }))).current;
  const [strategy, setStrategy] = useState(() => strategies[preference(strategyKey)] ? preference(strategyKey) : 'squash'), { busy, error, perform } = useAction();
  const chooseStrategy = value => { setStrategy(value); savePreference(strategyKey, value); };
  const primary = repositories.find(repository => repository.primary) ?? null, linked = repositories.filter(repository => !repository.primary);
  const target = primary ? targets[primary.projectId] : undefined, landingOn = target ?? linked.map(repository => targets[repository.projectId]).find(Boolean), ready = repositories.every(repository => targets[repository.projectId]);
  const land = () => perform(async () => {
    const landing = await api('/api/landings', { runIds: runs.map(run => run.id), target, targets: Object.fromEntries(linked.map(repository => [repository.projectId, targets[repository.projectId]])), strategy });
    window.dispatchEvent(new Event('dispatch-refresh')); onLanded?.(); navigate(`/runs/${landing.id}`);
  });
  return <>
    {(linked.length > 0 || !primary) && <ul className="land-targets" aria-label="Target branches">{repositories.map(repository => <li key={repository.projectId}><span>{repository.name}</span><TargetBranch repository={repository} value={targets[repository.projectId]} onChange={chooseTarget}/></li>)}</ul>}
    <div className="land-options">
      {primary && !linked.length && <TargetBranch repository={primary} value={target} onChange={chooseTarget}/>}
      <Select aria-label="How to land" value={strategy} onChange={event => chooseStrategy(event.target.value)}>{Object.entries(strategies).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
      <IconButton label={`Land on ${landingOn || 'branch'}`} icon={GitMerge} variant="default" disabled={busy || !ready} onClick={land}/>
    </div>
    {note && <p id={noteId} className="muted">Oldest first. A conflict goes back to that task's agent. {landingNote(repositories, targets, landingOn)}Nothing is pushed.</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}

export function LandDialog({ runs, onClose }) {
  const returnFocus = useRef(document.activeElement);
  const title = runs.length === 1 ? 'Land this task' : `Land ${runs.length} tasks`;
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="attachment-overlay"/>
      <Dialog.Content className="land-dialog" aria-describedby="land-note" onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
        <div className="section-heading"><Dialog.Title>{title}</Dialog.Title><IconButton label="Close" icon={X} onClick={onClose}/></div>
        <ul className="land-tasks">{runs.map(run => <li key={run.id}>{run.title}</li>)}</ul>
        <LandForm runs={runs} onLanded={onClose} noteId="land-note"/>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
