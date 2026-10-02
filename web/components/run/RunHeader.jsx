import { ArrowLeft, CircleStop, ClipboardCheck } from 'lucide-react';
import { IconButton, Tooltip } from '@/components/IconButton';
import { StatusIcon, ToneIcon } from '@/components/StatusIcon';
import { TicketActions } from '@/components/run/TicketActions';
import { HandoffActions } from '@/components/run/HandoffActions';
import { stateLabels } from '@/components/work/StateDot';
import { runEntry } from '@/lib/board.mjs';
import { openRemaining } from '../../../src/remaining.mjs';
import { Link, duration, useWorkspace } from '@/lib/workspace';
import { statusTone } from '@/lib/status.mjs';
import { shortcutLabel, usePreferences } from '@/lib/preferences';

function TileBar({ tiles, available, layout, compact }) {
  const { keybinds } = usePreferences();
  return <div className="tile-switcher" role="group" aria-label="Tiles">{available.map((tile, index) => {
    const { title, icon: Icon, live } = tiles[tile], full = layout.full === tile, shortcut = shortcutLabel(`${keybinds.tileFocus}+${index + 1}`);
    const pressed = compact ? layout.visible[0] === tile : layout.full ? full : layout.isOpen(tile);
    return <Tooltip key={tile} label={`${title} · ${shortcut}`}><button type="button" aria-label={title} aria-keyshortcuts={shortcut} className={`tile-toggle ${live ? 'is-live' : ''} ${full ? 'is-full' : ''}`} aria-pressed={pressed} onClick={() => compact ? layout.focus(tile) : layout.toggle(tile)}><Icon size={14} aria-hidden="true"/></button></Tooltip>;
  })}</div>;
}

function RunState({ run, labels, elapsed }) {
  const { state } = useWorkspace(), entry = runEntry({ runs: state.runs.filter(item => item.mode === 'live'), board: state.board }, run.id);
  const completed = entry?.latest.id === run.id && entry.state === 'completed';
  const label = run.supersededBy ? 'Continued in a newer run' : completed ? stateLabels.completed : run.handingOff ? stateLabels.reviewing : openRemaining(run) ? labels.blocked : labels[run.status] ?? run.status;
  const tone = completed ? 'completed' : run.handingOff ? 'active' : statusTone(run);
  return <span className={`run-state tone-${tone}`}>{run.handingOff ? <ToneIcon tone={tone} size={13}/> : <StatusIcon run={run} done={completed} size={13}/>}{label}{elapsed != null && <span className="run-elapsed">{duration(elapsed)}</span>}</span>;
}

export function RunHeader({ run, labels, elapsed, done, tiles, available, layout, compact, drawer, onDrawer, onCancel }) {
  return <header className="run-heading">
    <Link href="/" className="back-link" aria-label="All work"><ArrowLeft size={15} aria-hidden="true"/></Link>
    <Tooltip label={run.title}><h1 tabIndex={0}>{run.title}</h1></Tooltip>
    <RunState run={run} labels={labels} elapsed={elapsed}/>
    <div className="run-actions">
      {available.length > 1 && <TileBar tiles={tiles} available={available} layout={layout} compact={compact}/>}
      {done && !run.supersededBy && <HandoffActions run={run}/>}
      <IconButton label="Result" icon={ClipboardCheck} className={done ? `result-button tone-${statusTone(run)}` : undefined} aria-pressed={Boolean(drawer)} onClick={() => onDrawer(drawer ? null : 'manual')}/>
      {!done && <IconButton label="Cancel run" icon={CircleStop} onClick={onCancel}/>}
      <TicketActions runId={run.id}/>
    </div>
  </header>;
}
