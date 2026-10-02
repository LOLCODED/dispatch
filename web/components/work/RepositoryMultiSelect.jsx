import { useId, useState } from 'react';
import { Popover } from 'radix-ui';
import { Check, ChevronDown, FolderGit2 } from 'lucide-react';
import { keepMovedFocus } from '@/components/Select';

export const agentChoice = 'all', chooseFolder = '__choose_folder__', typePath = '__type_path__';

export const blankSelection = { mode: 'manual', ids: [] };

function triggerText(value, projects) {
  if (value.mode === 'agent') return 'Agent decides';
  const names = value.ids.map(id => projects.find(project => project.id === id)?.name).filter(Boolean);
  return names.length ? names.join(', ') : 'Choose repository';
}

function rowsFor(value, projects) {
  const picked = value.mode === 'agent' ? [] : value.ids;
  return [
    { value: agentChoice, label: 'Agent decides (all repositories)', checked: value.mode === 'agent' },
    ...projects.map(project => ({ value: project.id, label: project.name, checked: picked.includes(project.id), tag: picked.length > 1 && picked[0] === project.id ? 'primary' : null })),
    { value: chooseFolder, label: 'Choose a folder…', checked: false },
    { value: typePath, label: 'Type a path…', checked: false },
  ];
}

function PathField({ onSubmit }) {
  const [path, setPath] = useState('');
  return <form className="repository-path" onSubmit={event => { event.preventDefault(); if (path.trim()) onSubmit(path.trim()); }}>
    <input autoFocus aria-label="Repository path" placeholder="/path/to/repository" value={path} onChange={event => setPath(event.target.value)}/>
  </form>;
}

// Several repositories can be ticked; the first picked is the primary, where the agent starts. "Agent decides" puts every saved repository in reach.
export function RepositoryMultiSelect({ projects, value, disabled, onChange, onChooseFolder, onUsePath, id = 'composer-repository' }) {
  const listId = useId(), [open, setOpen] = useState(false), [active, setActive] = useState(agentChoice), [typing, setTyping] = useState(false);
  const rows = rowsFor(value, projects);
  const toggle = row => {
    if (row.value === agentChoice) { onChange({ mode: 'agent', ids: [] }); setOpen(false); return; }
    if (row.value === chooseFolder) { setOpen(false); onChooseFolder(); return; }
    if (row.value === typePath) { setTyping(true); return; }
    const ids = value.mode === 'agent' ? [] : value.ids;
    onChange({ mode: 'manual', ids: ids.includes(row.value) ? ids.filter(item => item !== row.value) : [...ids, row.value] });
  };
  const onKeyDown = event => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key], index = rows.findIndex(row => row.value === active);
    if (step) { event.preventDefault(); setActive(rows[(index + step + rows.length) % rows.length].value); return; }
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (rows[index]) toggle(rows[index]);
    if (event.key === 'Enter' && rows[index]?.value !== typePath) setOpen(false);
  };
  const usePath = path => { setOpen(false); onUsePath(path); };
  const changeOpen = next => { setOpen(next); setTyping(false); if (next) setActive(value.mode === 'agent' ? agentChoice : value.ids[0] ?? projects[0]?.id ?? agentChoice); };
  return <Popover.Root open={open} onOpenChange={changeOpen}>
    <Popover.Trigger id={id} disabled={disabled} data-value={value.mode === 'agent' ? agentChoice : value.ids.join(',')} className="select-trigger"><FolderGit2 size={14} aria-hidden="true" className="select-icon"/><span>{triggerText(value, projects)}</span><ChevronDown size={13} aria-hidden="true"/></Popover.Trigger>
    <Popover.Portal><Popover.Content align="start" sideOffset={6} className="select-popup repository-select" onCloseAutoFocus={keepMovedFocus}>
      {typing ? <PathField onSubmit={usePath}/> : <div id={listId} role="listbox" aria-multiselectable="true" aria-label="Repositories" tabIndex={0} className="select-viewport" onKeyDown={onKeyDown}>
        {rows.map(row => <div key={row.value} role="option" aria-selected={row.checked} data-value={row.value} data-state={row.checked ? 'checked' : 'unchecked'} data-highlighted={row.value === active ? '' : undefined} className="select-option" onPointerMove={() => setActive(row.value)} onClick={() => toggle(row)}>
          <span>{row.label}{row.tag && <small className="repository-tag" aria-label={row.tag}> {row.tag}</small>}</span>{row.checked && <Check size={13}/>}
        </div>)}
      </div>}
      {!typing && projects.length > 1 && <p className="repository-select-note">Tick several to change them in one task; the first picked is where the agent starts. Git repositories get their own worktree and commit, folders are edited in place; each runs its own checks.</p>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
