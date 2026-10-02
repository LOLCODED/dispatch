export const snakeDirections = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

function placeFood(cols, rows, body, random) {
  const taken = new Set(body.map(({ x, y }) => y * cols + x));
  const free = Array.from({ length: cols * rows }, (_, index) => index).filter(index => !taken.has(index));
  if (!free.length) return null;
  const index = free[Math.floor(random() * free.length)];
  return { x: index % cols, y: Math.floor(index / cols) };
}

export function createSnake({ cols = 20, rows = 14, random = Math.random } = {}) {
  const y = Math.floor(rows / 2), body = [{ x: 5, y }, { x: 4, y }, { x: 3, y }];
  return { cols, rows, body, dir: snakeDirections.right, next: snakeDirections.right, food: placeFood(cols, rows, body, random), score: 0, over: false };
}

export function turnSnake(state, name) {
  const dir = snakeDirections[name];
  if (!dir || (dir.x === -state.dir.x && dir.y === -state.dir.y)) return state;
  return { ...state, next: dir };
}

export function stepSnake(state, random = Math.random) {
  if (state.over) return state;
  const dir = state.next, head = { x: state.body[0].x + dir.x, y: state.body[0].y + dir.y };
  const eats = state.food && head.x === state.food.x && head.y === state.food.y;
  const rest = eats ? state.body : state.body.slice(0, -1);
  const outside = head.x < 0 || head.y < 0 || head.x >= state.cols || head.y >= state.rows;
  if (outside || rest.some(part => part.x === head.x && part.y === head.y)) return { ...state, dir, over: true };
  const body = [head, ...rest];
  if (!eats) return { ...state, dir, body };
  const food = placeFood(state.cols, state.rows, body, random);
  return { ...state, dir, body, food, score: state.score + 1, over: !food };
}

export const snakeInterval = () => 115;
