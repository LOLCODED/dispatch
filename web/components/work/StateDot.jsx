import { Folder, CirclePause, GitPullRequest } from 'lucide-react';
import { ToneIcon } from '@/components/StatusIcon';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { activeStatuses, folderTree } from '@/lib/board.mjs';

export const stateLabels = { todo: 'Todo', active: 'Active', reviewing: 'Reviewing', queued: 'Queued', decision: 'Needs decision', paused: 'Paused', review: 'Ready for review', awaiting: 'Awaiting merge', completed: 'Completed', archived: 'Archived' };

const stateMarks = { todo: { tone: 'waiting' }, active: { tone: 'active' }, reviewing: { tone: 'active' }, queued: { tone: 'waiting' }, decision: { tone: 'attention' }, paused: { tone: 'attention', icon: CirclePause }, review: { tone: 'success' }, awaiting: { tone: 'waiting', icon: GitPullRequest }, completed: { tone: 'completed' }, archived: { tone: 'muted' } };

export function StateMark({ state }) {
  return <ToneIcon {...stateMarks[state]} size={13}/>;
}

export function stateActions({ state, item, latest }, key) {
  if (state === 'reviewing') return [];
  const running = Boolean(latest && activeStatuses.has(latest.status)), stopped = latest && !running;
  const update = data => ({ path: `/api/board/items/${key}`, data });
  return [
    state === 'todo' && { label: 'Start', path: `/api/tasks/${key}/start` },
    latest?.status === 'queued' && { label: 'Start now', path: `/api/runs/${latest.id}/start` },
    (running || state === 'decision') && { label: 'Pause', path: `/api/board/items/${key}/pause` },
    running && { label: 'Stop', path: `/api/runs/${latest.id}/cancel` },
    state === 'paused' && { label: 'Resume', path: `/api/board/items/${key}/resume` },
    stopped && ['decision', 'paused', 'review', 'awaiting'].includes(state) && { label: 'Mark done', ...update({ done: true }) },
    state === 'completed' && item.done && !latest?.worktreeRemovedAt && { label: 'Reopen', ...update({ done: false }) },
    !running && state !== 'archived' && { label: 'Archive', ...update({ archived: true }) },
    state === 'archived' && { label: 'Unarchive', ...update({ archived: false }) },
  ].filter(Boolean);
}

function MoveMenu({ entry, folders, onAction }) {
  const move = folderId => onAction(`/api/board/items/${entry.key}`, { folderId });
  return <DropdownMenuSub>
    <DropdownMenuSubTrigger>Move to folder</DropdownMenuSubTrigger>
    <DropdownMenuSubContent>
      <DropdownMenuItem disabled={!entry.item.folderId} onSelect={() => move(null)}>No folder</DropdownMenuItem>
      {folderTree(folders).map(({ folder, depth }) => <DropdownMenuItem key={folder.id} aria-label={folder.name} data-selected={entry.item.folderId === folder.id || undefined} onSelect={() => move(folder.id)}><span className="folder-menu-name">{Array.from({ length: depth }, (_, index) => <span key={index} className="folder-indent" aria-hidden="true"/>)}{depth > 0 && <span className="folder-branch" aria-hidden="true">↳</span>}<Folder size={14} aria-hidden="true"/>{folder.name}</span></DropdownMenuItem>)}
    </DropdownMenuSubContent>
  </DropdownMenuSub>;
}

export function StateDot({ entry, folders, busy, onAction }) {
  return <DropdownMenu>
    <DropdownMenuTrigger className="board-dot-button" disabled={busy} aria-label={`Change state: ${entry.title}`}><StateMark state={entry.state}/></DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <p className="menu-label">{stateLabels[entry.state]}</p>
      {stateActions(entry, entry.key).map(action => <DropdownMenuItem key={action.label} onSelect={() => onAction(action.path, action.data)}>{action.label}</DropdownMenuItem>)}
      <DropdownMenuSeparator/>
      <MoveMenu entry={entry} folders={folders} onAction={onAction}/>
    </DropdownMenuContent>
  </DropdownMenu>;
}
