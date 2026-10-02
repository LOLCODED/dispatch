import { useImperativeHandle, useRef, useState } from 'react';
import { useReport } from '@/components/run/games/use-report';
import { Bomb, Flag } from 'lucide-react';
import { createMines, flagMine, revealMine } from '@/lib/games/mines.mjs';
import { createMerge, slideMerge } from '@/lib/games/merge.mjs';

const holdMs = 450;

function MineCell({ cell, index, onReveal, onFlag }) {
  const hold = useRef(null);
  const press = () => { hold.current = setTimeout(() => { hold.current = 'flagged'; onFlag(index); }, holdMs); };
  const release = () => { if (hold.current !== 'flagged') clearTimeout(hold.current); };
  const click = () => { if (hold.current === 'flagged') { hold.current = null; return; } onReveal(index); };
  const label = cell.revealed ? cell.mine ? 'Mine' : cell.near ? `${cell.near} nearby` : 'Clear' : cell.flagged ? 'Flagged' : 'Hidden';
  return <button type="button" className={`mine-cell ${cell.revealed ? 'is-revealed' : ''} ${cell.mine && cell.revealed ? 'is-mine' : ''}`} data-near={cell.revealed && !cell.mine ? cell.near : undefined} aria-label={label}
    onClick={click} onContextMenu={event => { event.preventDefault(); onFlag(index); }} onPointerDown={press} onPointerUp={release} onPointerLeave={release}
    onKeyDown={event => { if (event.key === 'f' || event.key === 'F') { event.preventDefault(); onFlag(index); } }}>
    {cell.revealed ? cell.mine ? <Bomb size={12} aria-hidden="true"/> : cell.near || '' : cell.flagged ? <Flag size={12} aria-hidden="true"/> : ''}
  </button>;
}

export function MinesBoard({ controls, onScore, onEnd, onStart }) {
  const [state, setState] = useState(() => createMines());
  useImperativeHandle(controls, () => ({ input: () => {} }), []);
  useReport(state.score, state.over || state.won, state.won, onScore, onEnd);
  const reveal = index => { onStart(); setState(current => revealMine(current, index)); };
  const flag = index => { onStart(); setState(current => flagMine(current, index)); };
  return <div className="mine-grid" style={{ gridTemplateColumns: `repeat(${state.cols}, 1fr)` }} role="group" aria-label="Minesweeper. Click to reveal, right-click, long-press or F to flag">
    {state.cells.map((cell, index) => <MineCell key={index} cell={cell} index={index} onReveal={reveal} onFlag={flag}/>)}
  </div>;
}

export function MergeBoard({ controls, onScore, onEnd }) {
  const [state, setState] = useState(() => createMerge());
  useImperativeHandle(controls, () => ({ input: action => setState(current => slideMerge(current, action)) }), []);
  useReport(state.score, state.over, false, onScore, onEnd);
  return <div className="merge-grid" role="grid" aria-label={`2048, score ${state.score}. Arrow keys or swipe to slide`}>
    {state.grid.map((value, index) => <span key={index} role="gridcell" className="merge-cell" data-value={value || undefined} style={value ? { '--level': Math.min(11, Math.log2(value)) } : undefined}>{value || ''}</span>)}
  </div>;
}
