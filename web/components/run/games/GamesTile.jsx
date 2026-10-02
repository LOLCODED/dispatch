import { useEffect, useRef, useState } from 'react';
import { Blocks, Bomb, BrickWall, Grid2x2, Pause, Play, RotateCcw, Worm } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { preference, savePreference } from '@/lib/workspace';
import { BreakoutBoard, SnakeBoard, StackerBoard } from '@/components/run/games/CanvasBoards';
import { MergeBoard, MinesBoard } from '@/components/run/games/GridBoards';

const games = [
  { id: 'snake', label: 'Snake', icon: Worm, Board: SnakeBoard, hint: 'Arrow keys or WASD. Swipe on a phone.' },
  { id: 'stacker', label: 'Block stacker', icon: Blocks, Board: StackerBoard, hint: 'Left and right move, up rotates, space drops.' },
  { id: 'mines', label: 'Minesweeper', icon: Bomb, Board: MinesBoard, hint: 'Click to reveal. Right-click, long-press or F to flag.', turns: true },
  { id: 'breakout', label: 'Breakout', icon: BrickWall, Board: BreakoutBoard, hint: 'Move the mouse or arrow keys. Click or space to launch.' },
  { id: 'merge', label: '2048', icon: Grid2x2, Board: MergeBoard, hint: 'Arrow keys or swipe to slide matching tiles together.', turns: true },
];
const keyActions = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'action' };
const bestKey = id => `dispatch-game-best-${id}`;

function GamePicker({ current, onPick, label }) {
  return <div className="game-picker" role="group" aria-label={label}>{games.map(({ id, label: name, icon }) => <IconButton key={id} label={name} icon={icon} aria-pressed={id === current} onClick={() => onPick(id)}/>)}</div>;
}

function Overlay({ game, status, score, asking, onPick, onResume }) {
  const title = status === 'over' ? `Game over · ${score}` : status === 'won' ? `You won · ${score}` : status === 'paused' ? 'Paused' : game.label;
  const detail = asking ? 'Answer the question to keep playing.' : status === 'ready' ? game.hint : status === 'paused' ? 'Press a key or tap to keep going.' : 'Press a key or tap to play again.';
  return <div className="game-overlay" onClick={event => { if (!event.target.closest('button')) onResume(); }}>
    <strong>{title}</strong><span>{detail}</span>
    {status !== 'ready' && !asking && <GamePicker current={game.id} onPick={onPick} label="Play something else"/>}
  </div>;
}

function useSwipe(onAction) {
  const start = useRef(null);
  return {
    onPointerDown: event => { if (!event.target.closest('button, .game-overlay')) start.current = { x: event.clientX, y: event.clientY }; },
    onPointerUp: event => {
      if (!start.current) return;
      const dx = event.clientX - start.current.x, dy = event.clientY - start.current.y;
      start.current = null;
      if (Math.hypot(dx, dy) < 24) onAction('tap');
      else onAction(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    },
  };
}

export function GamesTile({ paused, onPlaying }) {
  const [gameId, setGameId] = useState(() => games.find(item => item.id === preference('dispatch-game'))?.id ?? 'snake');
  const game = games.find(item => item.id === gameId), [status, setStatus] = useState('ready'), [round, setRound] = useState(0);
  const [score, setScore] = useState(0), [best, setBest] = useState(() => Number(preference(bestKey(gameId), '0')) || 0);
  const controls = useRef(null), arena = useRef(null), running = status === 'running';
  useEffect(() => { onPlaying(running && !game.turns); }, [running, game.turns, onPlaying]);
  useEffect(() => () => onPlaying(false), [onPlaying]);
  useEffect(() => { if (paused && running) setStatus('paused'); }, [paused, running]);
  useEffect(() => { const hide = () => { if (document.hidden) setStatus(current => current === 'running' ? 'paused' : current); }; document.addEventListener('visibilitychange', hide); return () => document.removeEventListener('visibilitychange', hide); }, []);
  const restart = id => { setGameId(id); savePreference('dispatch-game', id); setBest(Number(preference(bestKey(id), '0')) || 0); setScore(0); setStatus('ready'); setRound(current => current + 1); arena.current?.focus(); };
  const resume = () => { if (paused) return false; if (status === 'over' || status === 'won') { restart(gameId); setStatus('running'); return false; } setStatus('running'); return true; };
  const act = action => {
    if (running) { controls.current?.input(action); return; }
    if (resume()) controls.current?.input(action);
  };
  const recordScore = value => { setScore(value); if (value > best) { setBest(value); savePreference(bestKey(gameId), String(value)); } };
  const end = won => setStatus(won ? 'won' : 'over');
  const swipe = useSwipe(act);
  const key = event => {
    const action = keyActions[event.code];
    if (!action || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault(); act(action);
  };
  const blur = event => { if (!game.turns && !event.currentTarget.contains(event.relatedTarget)) setStatus(current => current === 'running' ? 'paused' : current); };
  const { Board } = game;
  return <div className="games">
    <div className="games-bar">
      <GamePicker current={gameId} onPick={restart} label="Game"/>
      <IconButton label={running ? 'Pause' : 'Play'} icon={running ? Pause : Play} disabled={paused || game.turns} onClick={() => running ? setStatus('paused') : resume()}/>
      <IconButton label="Restart" icon={RotateCcw} onClick={() => restart(gameId)}/>
      <span className="games-score"><span>Score <b>{score}</b></span><span>Best <b>{best}</b></span></span>
    </div>
    <div ref={arena} className="game-arena" tabIndex={0} aria-label={`${game.label}. ${game.hint}`} onKeyDown={key} onBlur={blur} {...(game.id === 'mines' ? {} : swipe)}>
      <Board key={`${gameId}-${round}`} running={running} controls={controls} onScore={recordScore} onEnd={end} onStart={() => { if (!running) resume(); }}/>
      {(!running && !(game.turns && status === 'ready')) || paused ? <Overlay game={game} status={paused && running ? 'paused' : status} score={score} asking={paused} onPick={restart} onResume={() => act('tap')}/> : null}
    </div>
  </div>;
}
