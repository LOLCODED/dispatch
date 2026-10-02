export const mergeSize = 4;

function addTile(grid, random) {
  const empty = grid.flatMap((value, index) => value ? [] : [index]);
  if (!empty.length) return grid;
  const next = [...grid];
  next[empty[Math.floor(random() * empty.length)]] = random() < 0.9 ? 2 : 4;
  return next;
}

export function createMerge({ random = Math.random } = {}) {
  return { grid: addTile(addTile(Array(mergeSize * mergeSize).fill(0), random), random), score: 0, over: false };
}

function slideLine(line) {
  const values = line.filter(Boolean), merged = [];
  let points = 0;
  for (let index = 0; index < values.length; index++) {
    if (values[index] === values[index + 1]) { merged.push(values[index] * 2); points += values[index] * 2; index++; }
    else merged.push(values[index]);
  }
  return { line: [...merged, ...Array(line.length - merged.length).fill(0)], points };
}

const lineIndexes = (direction, position) => Array.from({ length: mergeSize }, (_, step) => {
  if (direction === 'left') return position * mergeSize + step;
  if (direction === 'right') return position * mergeSize + (mergeSize - 1 - step);
  if (direction === 'up') return step * mergeSize + position;
  return (mergeSize - 1 - step) * mergeSize + position;
});

function canMove(grid) {
  return grid.some((value, index) => !value || (index % mergeSize < mergeSize - 1 && value === grid[index + 1]) || (index + mergeSize < grid.length && value === grid[index + mergeSize]));
}

export function slideMerge(state, direction, random = Math.random) {
  if (state.over || !['left', 'right', 'up', 'down'].includes(direction)) return state;
  const grid = [...state.grid];
  let points = 0;
  for (let position = 0; position < mergeSize; position++) {
    const indexes = lineIndexes(direction, position), slid = slideLine(indexes.map(index => state.grid[index]));
    indexes.forEach((index, step) => { grid[index] = slid.line[step]; });
    points += slid.points;
  }
  if (grid.every((value, index) => value === state.grid[index])) return state;
  const next = addTile(grid, random);
  return { grid: next, score: state.score + points, over: !canMove(next) };
}
