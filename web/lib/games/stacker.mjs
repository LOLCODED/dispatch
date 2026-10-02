export const stackerCols = 10, stackerRows = 20;
const shapes = [
  [[1, 1, 1, 1]],
  [[1, 1], [1, 1]],
  [[0, 1, 0], [1, 1, 1]],
  [[1, 0, 0], [1, 1, 1]],
  [[0, 0, 1], [1, 1, 1]],
  [[0, 1, 1], [1, 1, 0]],
  [[1, 1, 0], [0, 1, 1]],
];
const lineScores = [0, 100, 300, 500, 800];
const kicks = [0, -1, 1, -2, 2];

const emptyBoard = () => Array.from({ length: stackerRows }, () => Array(stackerCols).fill(0));
const rotate = shape => shape[0].map((_, column) => shape.map(row => row[column]).reverse());

function spawn(kind) {
  const shape = shapes[kind];
  return { kind, shape, x: Math.floor((stackerCols - shape[0].length) / 2), y: 0 };
}

export function fits(board, piece) {
  return piece.shape.every((row, dy) => row.every((cell, dx) => {
    if (!cell) return true;
    const x = piece.x + dx, y = piece.y + dy;
    return x >= 0 && x < stackerCols && y < stackerRows && (y < 0 || !board[y][x]);
  }));
}

export function createStacker({ random = Math.random, board = emptyBoard() } = {}) {
  const pick = () => Math.floor(random() * shapes.length);
  return { board, piece: spawn(pick()), next: pick(), score: 0, lines: 0, over: false };
}

function lock(state, random) {
  const board = state.board.map(row => [...row]);
  state.piece.shape.forEach((row, dy) => row.forEach((cell, dx) => { if (cell && state.piece.y + dy >= 0) board[state.piece.y + dy][state.piece.x + dx] = state.piece.kind + 1; }));
  const kept = board.filter(row => row.some(cell => !cell)), cleared = stackerRows - kept.length;
  const settled = [...Array.from({ length: cleared }, () => Array(stackerCols).fill(0)), ...kept];
  const piece = spawn(state.next);
  return { ...state, board: settled, piece, next: Math.floor(random() * shapes.length), score: state.score + lineScores[cleared], lines: state.lines + cleared, over: !fits(settled, piece) };
}

export function stepStacker(state, random = Math.random) {
  if (state.over) return state;
  const lower = { ...state.piece, y: state.piece.y + 1 };
  return fits(state.board, lower) ? { ...state, piece: lower } : lock(state, random);
}

export function moveStacker(state, action, random = Math.random) {
  if (state.over) return state;
  if (action === 'down') return stepStacker(state, random);
  if (action === 'drop') {
    let piece = state.piece;
    while (fits(state.board, { ...piece, y: piece.y + 1 })) piece = { ...piece, y: piece.y + 1 };
    return lock({ ...state, piece, score: state.score + 2 * (piece.y - state.piece.y) }, random);
  }
  if (action === 'rotate') {
    const shape = rotate(state.piece.shape);
    const placed = kicks.map(offset => ({ ...state.piece, shape, x: state.piece.x + offset })).find(piece => fits(state.board, piece));
    return placed ? { ...state, piece: placed } : state;
  }
  const shift = { left: -1, right: 1 }[action];
  if (!shift) return state;
  const moved = { ...state.piece, x: state.piece.x + shift };
  return fits(state.board, moved) ? { ...state, piece: moved } : state;
}

export const stackerInterval = state => Math.max(110, 560 - state.lines * 18);
