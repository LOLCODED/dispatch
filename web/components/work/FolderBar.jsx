import { useState } from 'react';
import { ChevronDown, Folder, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/IconButton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { folderTree } from '@/lib/board.mjs';
import { useBoardAction } from '@/lib/board-actions';

function NameInput({ initial, label, busy, onSave, onClose }) {
  const [name, setName] = useState(initial);
  return <form className="folder-name-form" onKeyDown={event => {
    // Text editing must not invoke the menu's typeahead or arrow-key navigation.
    event.stopPropagation();
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
  }} onSubmit={event => { event.preventDefault(); if (name.trim() && !busy) onSave(name.trim()); }}>
    <Folder size={14} aria-hidden="true"/>
    <Input autoFocus className="folder-name-input" value={name} disabled={busy} maxLength={60} placeholder="Folder name" aria-label={label} onChange={event => setName(event.target.value)}/>
  </form>;
}

function FolderAction({ label, icon: Icon, onClick, disabled, danger = false, ...props }) {
  return <Tooltip label={label}><button type="button" className={`folder-icon-action${danger ? ' folder-delete' : ''}`} aria-label={label} disabled={disabled} onKeyDown={event => { if (props.role !== 'menuitem') event.stopPropagation(); }} onClick={event => { event.stopPropagation(); onClick(event); }} {...props}><Icon size={14} aria-hidden="true"/></button></Tooltip>;
}

export function FolderDropdown({ folders, value, onChange, emptyLabel = 'All tasks', label, disabled, composer = false }) {
  const [open, setOpen] = useState(false), [editing, setEditing] = useState(null);
  const { busy, error, send } = useBoardAction();
  const current = folders.find(folder => folder.id === value);
  const begin = (event, edit) => { event.preventDefault(); setEditing(edit); };
  const cancel = () => { setEditing(null); setOpen(false); };
  const save = async name => {
    const result = editing.kind === 'new'
      ? await send('/api/board/folders', { name, parentId: editing.parentId })
      : await send(`/api/board/folders/${editing.id}`, { name });
    if (!result) return;
    if (editing.kind === 'new') onChange(result.id);
    cancel();
  };
  const remove = async folder => { if (await send(`/api/board/folders/${folder.id}/delete`) && folder.id === value) onChange(folder.parentId); };
  const editor = <div className="folder-editor-row">
    <p className="folder-editor-context">{editing?.kind === 'rename' ? 'Rename folder' : editing?.parentId ? `New folder in ${folders.find(folder => folder.id === editing.parentId)?.name}` : 'New folder at root'}</p>
    {editing && <NameInput key={editing.kind + (editing.id ?? editing.parentId ?? '')} initial={editing.kind === 'rename' ? editing.name : ''} label={editing.kind === 'new' ? 'New folder name' : 'Rename folder'} busy={busy} onSave={save} onClose={cancel}/>}
    <p className="folder-editor-hint">Enter to save · Esc to cancel</p>
  </div>;
  return <DropdownMenu open={open} onOpenChange={next => { if (!busy) { setOpen(next); if (!next) setEditing(null); } }}>
    <DropdownMenuTrigger disabled={disabled || busy} aria-label={composer ? 'Folder' : undefined} className={composer ? 'select-trigger folder-trigger-composer' : 'folder-trigger'}>
      <Folder size={14} aria-hidden="true"/><span>{label ?? current?.name ?? emptyLabel}</span><ChevronDown size={12} aria-hidden="true"/>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" collisionPadding={16} className="folder-menu" onEscapeKeyDown={event => { if (editing) { event.preventDefault(); if (!busy) cancel(); } }}>
      <div className="folder-menu-heading"><p className="menu-label">Folders</p><FolderAction role="menuitem" label={current ? 'New folder at root…' : 'New folder…'} icon={FolderPlus} disabled={busy || Boolean(editing)} onClick={event => begin(event, { kind: 'new', parentId: null })}/></div>
      <DropdownMenuItem disabled={busy} data-selected={!current || undefined} onSelect={() => onChange(null)}><span className="folder-menu-name"><Folder size={14} aria-hidden="true"/>{emptyLabel}</span></DropdownMenuItem>
      {folderTree(folders).map(({ folder, depth }) => editing?.kind === 'rename' && editing.id === folder.id ? <div key={folder.id}>{editor}</div> : <div className="folder-menu-row" key={folder.id} data-selected={folder.id === value || undefined} onKeyDown={event => {
        if (event.key === 'Tab' && !event.shiftKey && event.target.getAttribute('role') === 'menuitem') {
          const action = event.currentTarget.querySelector('button:not(:disabled)');
          if (action) { event.preventDefault(); event.stopPropagation(); action.focus(); }
        }
      }}>
        <DropdownMenuItem className="folder-choice" aria-label={folder.name} disabled={busy} onSelect={() => onChange(folder.id)}>
          <span className="folder-menu-name">{Array.from({ length: depth }, (_, index) => <span key={index} className="folder-indent" aria-hidden="true"/>)}{depth > 0 && <span className="folder-branch" aria-hidden="true">↳</span>}<Folder size={14} aria-hidden="true"/><span className="folder-row-title">{folder.name}</span></span>
        </DropdownMenuItem>
        {!editing && <span className="folder-row-actions">
          <FolderAction label={`New folder in ${folder.name}…`} icon={FolderPlus} disabled={busy} onClick={event => begin(event, { kind: 'new', parentId: folder.id })}/>
          <FolderAction label={`Rename ${folder.name}`} icon={Pencil} disabled={busy} onClick={event => begin(event, { kind: 'rename', id: folder.id, name: folder.name })}/>
          <FolderAction label={`Delete ${folder.name}`} icon={Trash2} danger disabled={busy} onClick={() => remove(folder)}/>
        </span>}
      </div>)}
      {editing?.kind === 'new' && editor}
      {error && <p className="error folder-menu-error" role="alert">{error}</p>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function FolderBar({ folders, scope, onScope }) {
  return <div className="folder-bar"><FolderDropdown folders={folders} value={scope} onChange={onScope}/></div>;
}
