import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { GitBranch, GitPullRequest, X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Select } from '@/components/Select';
import { useAction } from '@/lib/use-action';
import { api, preference, savePreference } from '@/lib/workspace';

const baseKey = projectId => `dispatch-pr-base-${projectId}`;

function BaseBranch({ projectId, name, value, onChange }) {
  const [branches, setBranches] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    api(`/api/projects/${projectId}/branches?remote=1`, undefined, controller.signal).then(result => {
      const saved = preference(baseKey(projectId));
      setBranches(result.branches); onChange(projectId, result.branches.includes(saved) ? saved : result.base);
    }).catch(() => setBranches([]));
    return () => controller.abort();
  }, [projectId, onChange]);
  return <Select aria-label={`Base branch for ${name}`} icon={GitBranch} value={value ?? ''} disabled={!branches?.length} onChange={event => onChange(projectId, event.target.value)}>{(branches ?? []).map(branch => <option key={branch} value={branch}>{branch}</option>)}</Select>;
}

const openedItems = runs => runs.flatMap(run => [{ key: run.id, title: run.title, delivery: run.delivery }, ...(run.linked ?? []).filter(member => member.delivery).map(member => ({ key: `${run.id}:${member.projectId}`, title: `${run.title} · ${member.name}`, delivery: member.delivery }))]);

function Outcome({ runs }) {
  return <ul className="land-tasks">{openedItems(runs).map(item => <li key={item.key}>{item.title}: {item.delivery?.pr?.url ? <a href={item.delivery.pr.url} target="_blank" rel="noopener">#{item.delivery.pr.number ?? '?'}{item.delivery.pr.reused ? ' (existing)' : ''}</a> : <span className="error">{item.delivery?.error?.message ?? 'not opened'}</span>}</li>)}</ul>;
}

// One group per repository a pull request will be opened in: a task's primary and every linked repository it committed to.
function byRepository(runs) {
  const groups = new Map();
  for (const run of runs) for (const item of run.repositories ?? [{ projectId: run.projectId, name: run.project?.name, primary: true }]) {
    const group = groups.get(item.projectId) ?? { projectId: item.projectId, name: item.name ?? 'Repository', runs: [] };
    group.runs.push(run); groups.set(item.projectId, group);
  }
  return [...groups.values()];
}

export const pullRequestTitle = runs => runs.length === 1 ? 'Open a pull request' : `Open ${runs.length} pull requests`;

export function PullRequestForm({ runs, noteId, listTasks = true }) {
  const [bases, setBases] = useState({}), [opened, setOpened] = useState(null), { busy, error, perform } = useAction();
  const chooseBase = useRef((projectId, branch) => setBases(current => ({ ...current, [projectId]: branch }))).current;
  const repositories = byRepository(runs), several = repositories.length > 1, ready = repositories.every(({ projectId }) => bases[projectId]);
  const open = () => perform(async () => {
    for (const [projectId, branch] of Object.entries(bases)) savePreference(baseKey(projectId), branch);
    const result = await api('/api/pull-requests', { runIds: runs.map(run => run.id), bases });
    window.dispatchEvent(new Event('dispatch-refresh')); setOpened(result.runs);
  });
  return <>
    {opened ? <Outcome runs={opened}/> : repositories.map(repository => (listTasks || several) && <section key={repository.projectId} className="pr-repository" aria-label={repository.name}>
      {several && <h3>{repository.name}</h3>}
      {listTasks && <ul className="land-tasks">{repository.runs.map(run => <li key={run.id}>{run.title}</li>)}</ul>}
      {several && <BaseBranch projectId={repository.projectId} name={repository.name} value={bases[repository.projectId]} onChange={chooseBase}/>}
    </section>)}
    {!opened && <div className="land-options">
      {!several && <BaseBranch projectId={repositories[0].projectId} name={repositories[0].name} value={bases[repositories[0].projectId]} onChange={chooseBase}/>}
      <IconButton label={pullRequestTitle(runs)} icon={GitPullRequest} variant="default" disabled={busy || !ready} onClick={open}/>
    </div>}
    <p id={noteId} className="muted">{opened ? 'Each pull request body lists the SQL to run, where to look and the checks that passed.' : `Each task is pushed on its own branch and opened as a draft pull request into the branch you pick${several ? ' for each repository' : ''}.${runs.length > 1 || several ? ' Pull requests opened together link to each other, across repositories too.' : ''}`}</p>
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}

export function PullRequestDialog({ runs, onClose }) {
  const returnFocus = useRef(document.activeElement);
  return <Dialog.Root open onOpenChange={state => { if (!state) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="attachment-overlay"/>
      <Dialog.Content className="land-dialog" aria-describedby="pr-note" onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
        <div className="section-heading"><Dialog.Title>{pullRequestTitle(runs)}</Dialog.Title><IconButton label="Close" icon={X} onClick={onClose}/></div>
        <PullRequestForm runs={runs} noteId="pr-note"/>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
