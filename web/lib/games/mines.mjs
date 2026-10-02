function neighbours(cols, rows, index) {
  const x = index % cols, y = Math.floor(index / cols), around = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if ((dx || dy) && nx >= 0 && ny >= 0 && nx < cols && ny < rows) around.push(ny * cols + nx);
  }
  return around;
}

export function createMines({ cols = 12, rows = 9, mines = 16 } = {}) {
  return { cols, rows, mines, cells: Array.from({ length: cols * rows }, () => ({ mine: false, revealed: false, flagged: false, near: 0 })), placed: false, over: false, won: false, score: 0 };
}

// Mines are placed on the first reveal, away from that cell and its neighbours, so the opening move is always safe.
function placeMines(state, first, random) {
  const keep = new Set([first, ...neighbours(state.cols, state.rows, first)]);
  const spots = state.cells.map((_, index) => index).filter(index => !keep.has(index));
  const count = Math.min(state.mines, spots.length);
  for (let index = 0; index < count; index++) {
    const swap = index + Math.floor(random() * (spots.length - index));
    [spots[index], spots[swap]] = [spots[swap], spots[index]];
  }
  const chosen = new Set(spots.slice(0, count));
  const cells = state.cells.map((cell, index) => ({ ...cell, mine: chosen.has(index) }));
  for (const [index, cell] of cells.entries()) cell.near = neighbours(state.cols, state.rows, index).filter(other => cells[other].mine).length;
  return { ...state, cells, placed: true };
}

export function revealMine(state, index, random = Math.random) {
  if (state.over || state.won || state.cells[index]?.revealed || state.cells[index]?.flagged) return state;
  const ready = state.placed ? state : placeMines(state, index, random);
  const cells = ready.cells.map(cell => ({ ...cell }));
  if (cells[index].mine) return { ...ready, cells: cells.map(cell => cell.mine ? { ...cell, revealed: true } : cell), over: true };
  const queue = [index];
  while (queue.length) {
    const current = queue.pop();
    if (cells[current].revealed || cells[current].flagged) continue;
    cells[current].revealed = true;
    if (!cells[current].near) queue.push(...neighbours(ready.cols, ready.rows, current));
  }
  const score = cells.filter(cell => cell.revealed).length;
  return { ...ready, cells, score, won: cells.every(cell => cell.mine || cell.revealed) };
}

export function flagMine(state, index) {
  if (state.over || state.won || state.cells[index].revealed) return state;
  return { ...state, cells: state.cells.map((cell, position) => position === index ? { ...cell, flagged: !cell.flagged } : cell) };
}
