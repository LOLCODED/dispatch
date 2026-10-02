import { Archive, ArchiveRestore, Check, RotateCcw } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { stateActions } from '@/components/work/StateDot';
import { runEntry } from '@/lib/board.mjs';
import { useBoardAction } from '@/lib/board-actions';
import { useWorkspace } from '@/lib/workspace';

const icons = { 'Mark done': Check, Reopen: RotateCcw, Archive, Unarchive: ArchiveRestore };

export function TicketActions({ runId }) {
  const { state } = useWorkspace(), { busy, error, send } = useBoardAction();
  const entry = runEntry({ runs: state.runs.filter(run => run.mode === 'live'), board: state.board }, runId);
  if (!entry) return null;
  const actions = stateActions(entry, entry.key).filter(action => icons[action.label]);
  return <>
    {actions.map(action => <IconButton key={action.label} label={action.label} icon={icons[action.label]} disabled={busy} onClick={() => send(action.path, action.data)}/>)}
    {error && <span className="error" role="alert">{error}</span>}
  </>;
}
