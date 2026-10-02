import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useReport } from '@/components/run/games/use-report';
import { createSnake, snakeInterval, stepSnake, turnSnake } from '@/lib/games/snake.mjs';
import { createStacker, moveStacker, stackerCols, stackerInterval, stackerRows, stepStacker } from '@/lib/games/stacker.mjs';
import { breakoutSize, createBreakout, launchBall, movePaddle, stepBreakout } from '@/lib/games/breakout.mjs';

function palette() {
  const style = getComputedStyle(document.documentElement), token = name => style.getPropertyValue(name).trim();
  return { ground: token('--card'), check: token('--secondary'), line: token('--border'), primary: token('--primary'), strong: token('--success'), danger: token('--danger'), muted: token('--muted-foreground'), active: token('--active'), attention: token('--attention') };
}

// Draws in logical units scaled to fit the arena, and repaints on resize or a theme change.
function useFitCanvas(width, height, paint) {
  const ref = useRef(null), paintRef = useRef(paint);
  paintRef.current = paint;
  const draw = useCallback(() => {
    const canvas = ref.current, arena = canvas?.parentElement;
    if (!arena) return;
    const scale = Math.max(0.25, Math.min((arena.clientWidth - 16) / width, (arena.clientHeight - 16) / height)), ratio = devicePixelRatio || 1;
    canvas.style.width = `${width * scale}px`; canvas.style.height = `${height * scale}px`;
    canvas.width = Math.round(width * scale * ratio); canvas.height = Math.round(height * scale * ratio);
    const context = canvas.getContext('2d');
    context.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0);
    paintRef.current(context, palette());
  }, [width, height]);
  useLayoutEffect(draw);
  useEffect(() => {
    const resize = new ResizeObserver(draw), theme = new MutationObserver(draw);
    resize.observe(ref.current.parentElement);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => { resize.disconnect(); theme.disconnect(); };
  }, [draw]);
  return ref;
}

function useTicker(running, interval, onTick) {
  const tick = useRef(onTick);
  tick.current = onTick;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick.current(), interval);
    return () => clearInterval(timer);
  }, [running, interval]);
}

function useFrames(running, onFrame) {
  const frame = useRef(onFrame);
  frame.current = onFrame;
  useEffect(() => {
    if (!running) return;
    let id, last = performance.now();
    const loop = now => { frame.current(Math.min(0.05, (now - last) / 1000)); last = now; id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [running]);
}

export function SnakeBoard({ running, controls, onScore, onEnd }) {
  const [state, setState] = useState(() => createSnake());
  useImperativeHandle(controls, () => ({ input: action => setState(current => turnSnake(current, action)) }), []);
  useTicker(running, snakeInterval(), () => setState(current => stepSnake(current)));
  useReport(state.score, state.over, !state.food, onScore, onEnd);
  const canvas = useFitCanvas(state.cols, state.rows, (context, colors) => {
    context.fillStyle = colors.ground; context.fillRect(0, 0, state.cols, state.rows);
    context.fillStyle = colors.check;
    for (let x = 0; x < state.cols; x++) for (let y = 0; y < state.rows; y++) if ((x + y) % 2) context.fillRect(x, y, 1, 1);
    if (state.food) { context.fillStyle = colors.danger; context.beginPath(); context.arc(state.food.x + 0.5, state.food.y + 0.5, 0.32, 0, Math.PI * 2); context.fill(); }
    state.body.forEach((part, index) => { context.fillStyle = index ? colors.primary : colors.strong; context.fillRect(part.x + 0.06, part.y + 0.06, 0.88, 0.88); });
  });
  return <canvas ref={canvas} aria-label={`Snake, score ${state.score}`} role="img"/>;
}

export function StackerBoard({ running, controls, onScore, onEnd }) {
  const [state, setState] = useState(() => createStacker());
  const actions = { left: 'left', right: 'right', down: 'down', up: 'rotate', action: 'drop' };
  useImperativeHandle(controls, () => ({ input: action => actions[action] && setState(current => moveStacker(current, actions[action])) }), []);
  useTicker(running, stackerInterval(state), () => setState(current => stepStacker(current)));
  useReport(state.score, state.over, false, onScore, onEnd);
  const colors = ['primary', 'active', 'attention', 'strong', 'danger', 'muted', 'primary'];
  const canvas = useFitCanvas(stackerCols, stackerRows, (context, tokens) => {
    context.fillStyle = tokens.ground; context.fillRect(0, 0, stackerCols, stackerRows);
    context.strokeStyle = tokens.check; context.lineWidth = 0.04;
    for (let x = 1; x < stackerCols; x++) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, stackerRows); context.stroke(); }
    const cell = (x, y, kind) => { context.fillStyle = tokens[colors[kind]]; context.fillRect(x + 0.05, y + 0.05, 0.9, 0.9); };
    state.board.forEach((row, y) => row.forEach((value, x) => { if (value) cell(x, y, value - 1); }));
    state.piece.shape.forEach((row, dy) => row.forEach((value, dx) => { if (value) cell(state.piece.x + dx, state.piece.y + dy, state.piece.kind); }));
  });
  return <canvas ref={canvas} aria-label={`Block stacker, score ${state.score}`} role="img"/>;
}

export function BreakoutBoard({ running, controls, onScore, onEnd }) {
  const [state, setState] = useState(() => createBreakout());
  useImperativeHandle(controls, () => ({ input: action => {
    if (action === 'left' || action === 'right') setState(current => movePaddle(current, current.paddle.x + (action === 'left' ? -22 : 22)));
    if (action === 'up' || action === 'action' || action === 'tap') setState(current => launchBall(current));
  } }), []);
  useFrames(running, seconds => setState(current => stepBreakout(current, seconds)));
  useReport(state.score, state.over, false, onScore, onEnd);
  const rows = ['danger', 'attention', 'primary', 'strong', 'active'];
  const canvas = useFitCanvas(breakoutSize.width, breakoutSize.height, (context, tokens) => {
    context.fillStyle = tokens.ground; context.fillRect(0, 0, breakoutSize.width, breakoutSize.height);
    for (const brick of state.bricks) { context.fillStyle = tokens[rows[brick.row]]; context.fillRect(brick.x, brick.y, brick.width, brick.height); }
    context.fillStyle = tokens.muted; context.fillRect(state.paddle.x - state.paddle.width / 2, state.paddle.y, state.paddle.width, 5);
    context.beginPath(); context.arc(state.ball.x, state.ball.y, state.ball.radius, 0, Math.PI * 2); context.fill();
    context.font = '9px ui-monospace, monospace'; context.fillText('●'.repeat(state.lives), 6, 12);
  });
  const follow = event => {
    const box = event.currentTarget.getBoundingClientRect();
    setState(current => movePaddle(current, (event.clientX - box.left) / box.width * breakoutSize.width));
  };
  return <canvas ref={canvas} aria-label={`Breakout, score ${state.score}`} role="img" onPointerMove={follow} onPointerDown={follow}/>;
}
