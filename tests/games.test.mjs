import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnake, stepSnake, turnSnake } from '../web/lib/games/snake.mjs';
import { createStacker, moveStacker, stackerCols, stackerRows } from '../web/lib/games/stacker.mjs';
import { createBreakout, launchBall, movePaddle, stepBreakout } from '../web/lib/games/breakout.mjs';
import { createMines, flagMine, revealMine } from '../web/lib/games/mines.mjs';
import { createMerge, slideMerge } from '../web/lib/games/merge.mjs';

const fixed = value => () => value;

test('snake grows on food, ignores reversing, and ends at the wall', () => {
  let state = { ...createSnake({ cols: 10, rows: 5, random: fixed(0) }), food: { x: 6, y: 2 } };
  assert.equal(turnSnake(state, 'left'), state);
  state = stepSnake(state, fixed(0));
  assert.equal(state.score, 1); assert.equal(state.body.length, 4);
  for (let step = 0; step < 4 && !state.over; step++) state = stepSnake({ ...state, food: { x: 0, y: 0 } });
  assert.equal(state.over, true);
});

test('block stacker clears a full line and scores it', () => {
  const board = Array.from({ length: stackerRows }, (_, y) => Array(stackerCols).fill(y === stackerRows - 1 ? 1 : 0));
  board[stackerRows - 1][0] = 0;
  const state = { ...createStacker({ random: fixed(0), board }), piece: { kind: 0, shape: [[1], [1], [1], [1]], x: 0, y: 0 } };
  const dropped = moveStacker(state, 'drop', fixed(0));
  assert.equal(dropped.lines, 1); assert.ok(dropped.score >= 100);
  assert.equal(dropped.board[stackerRows - 1].filter(Boolean).length, 1);
});

test('block stacker keeps pieces inside the walls', () => {
  let state = createStacker({ random: fixed(0) });
  for (let move = 0; move < 20; move++) state = moveStacker(state, 'left');
  assert.equal(state.piece.x, 0);
});

test('breakout waits for a launch, then loses a life past the paddle', () => {
  let state = createBreakout();
  assert.equal(stepBreakout(state, 0.1), state);
  state = launchBall(movePaddle(state, 0));
  state = { ...state, ball: { ...state.ball, x: 300, y: 215, vx: 0, vy: 200 } };
  state = stepBreakout(state, 0.1);
  assert.equal(state.lives, 2); assert.equal(state.launched, false);
});

test('minesweeper keeps the first reveal safe and opens empty areas', () => {
  const state = revealMine(createMines({ cols: 6, rows: 6, mines: 4 }), 0, fixed(0.99));
  assert.equal(state.over, false); assert.ok(state.score >= 1);
  assert.equal(state.cells.filter(cell => cell.mine).length, 4);
  const flagged = flagMine(state, state.cells.findIndex(cell => !cell.revealed));
  assert.equal(flagged.cells.filter(cell => cell.flagged).length, 1);
});

test('2048 merges matching tiles once per move, adds a tile, and ignores moves that change nothing', () => {
  const slid = slideMerge({ grid: [2, 2, 2, 0, ...Array(12).fill(0)], score: 0, over: false }, 'left', fixed(0));
  assert.deepEqual(slid.grid.slice(0, 4), [4, 2, 2, 0]);
  assert.equal(slid.score, 4);
  const stuck = { grid: [2, 4, 8, 16, ...Array(12).fill(0)], score: 0, over: false };
  assert.equal(slideMerge(stuck, 'left'), stuck);
  assert.equal(createMerge({ random: fixed(0) }).grid.filter(Boolean).length, 2);
});
