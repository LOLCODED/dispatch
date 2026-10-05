import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/Checkbox';
import { useAction } from '@/lib/use-action';
import { api } from '@/lib/workspace';
import { commandLine } from '@/lib/recipe-text.mjs';
import { repositoryInput } from '../../../src/repository-setup.mjs';

const listed = steps => steps.map(commandLine).join(', ') || 'none';

function Candidate({ item, onToggle }) {
  if (item.error) return <li className="batch-candidate"><div className="switch-text"><code className="break-all">{item.path}</code><small className="error">{item.error}</small></div></li>;
  const input = repositoryInput(item.info);
  return <li className="batch-candidate">
    <Checkbox checked={item.selected} onChange={onToggle}><strong>{input.name}</strong> <code className="break-all">{input.repositoryPath}</code></Checkbox>
    <small className="muted">{item.saved ? 'Already saved; it stays as it is.' : `Checks: ${listed(input.validation)} · Setup: ${listed(input.setup)}${input.network.hosts.length ? ` · Agent network: ${input.network.hosts.join(', ')}` : ''}`}</small>
  </li>;
}

// Several folders picked at once are added with the settings the setup form would suggest; each can be tuned afterwards.
export function BatchAdd({ projects, onAdded }) {
  const [items, setItems] = useState([]), { busy, error, perform } = useAction();
  const saved = path => projects.some(project => project.repositoryPath === path);
  const pick = () => perform(async () => {
    const { paths = [] } = await api('/api/folders/pick', { multiple: true });
    setItems(await Promise.all(paths.map(path => api('/api/projects/inspect', { repositoryPath: path }).then(
      info => ({ path, info, saved: saved(info.repositoryPath), selected: !saved(info.repositoryPath) }),
      failure => ({ path, error: failure.message, selected: false })))));
  });
  const chosen = items.filter(item => item.selected && item.info && !item.saved);
  const add = () => perform(async () => {
    for (const item of chosen) await api('/api/projects/add', { repositoryPath: item.info.repositoryPath, confirmed: true });
    window.dispatchEvent(new Event('dispatch-refresh')); setItems([]); onAdded?.(chosen.length);
  });
  return <section className="panel batch-add" aria-label="Add several repositories">
    <Button type="button" variant="outline" disabled={busy} onClick={pick}><FolderOpen aria-hidden="true"/>Choose folders…</Button>
    {items.length > 0 && <>
      <ul className="row-list">{items.map((item, index) => <Candidate key={item.path} item={item} onToggle={selected => setItems(items.map((other, position) => position === index ? { ...other, selected } : other))}/>)}</ul>
      {chosen.length > 0 && <p className="save-warning">dispatch will run each repository's setup commands on your machine before its tasks.</p>}
      <Button type="button" disabled={busy || !chosen.length} onClick={add}>Add {chosen.length} {chosen.length === 1 ? 'repository' : 'repositories'}</Button>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
