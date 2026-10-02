export const breakoutSize = { width: 320, height: 220 };
const brickRows = 5, brickCols = 8, brickGap = 4, brickTop = 24, brickHeight = 10;
const paddleWidth = 52, paddleY = breakoutSize.height - 14, ballRadius = 4, startSpeed = 150;

function bricksFor() {
  const width = (breakoutSize.width - brickGap * (brickCols + 1)) / brickCols;
  return Array.from({ length: brickRows * brickCols }, (_, index) => ({
    x: brickGap + (index % brickCols) * (width + brickGap), y: brickTop + Math.floor(index / brickCols) * (brickHeight + brickGap), width, height: brickHeight, row: Math.floor(index / brickCols),
  }));
}

const restingBall = (paddle, speed) => ({ x: paddle.x, y: paddleY - ballRadius - 1, vx: speed * 0.6, vy: -speed * 0.8, radius: ballRadius });

export function createBreakout() {
  const paddle = { x: breakoutSize.width / 2, width: paddleWidth, y: paddleY };
  return { paddle, ball: restingBall(paddle, startSpeed), bricks: bricksFor(), speed: startSpeed, launched: false, lives: 3, score: 0, over: false };
}

export function movePaddle(state, x) {
  const half = state.paddle.width / 2, paddle = { ...state.paddle, x: Math.min(breakoutSize.width - half, Math.max(half, x)) };
  return { ...state, paddle, ball: state.launched ? state.ball : restingBall(paddle, state.speed) };
}

export const launchBall = state => state.over ? state : { ...state, launched: true };

function bounceWalls(ball) {
  const { width } = breakoutSize;
  if (ball.x < ball.radius) return { ...ball, x: ball.radius, vx: Math.abs(ball.vx) };
  if (ball.x > width - ball.radius) return { ...ball, x: width - ball.radius, vx: -Math.abs(ball.vx) };
  if (ball.y < ball.radius) return { ...ball, y: ball.radius, vy: Math.abs(ball.vy) };
  return ball;
}

function bouncePaddle(ball, paddle, speed) {
  const hit = ball.vy > 0 && ball.y + ball.radius >= paddle.y && ball.y + ball.radius <= paddle.y + 8 && Math.abs(ball.x - paddle.x) <= paddle.width / 2 + ball.radius;
  if (!hit) return ball;
  const angle = (ball.x - paddle.x) / (paddle.width / 2) * 1.05;
  return { ...ball, y: paddle.y - ball.radius, vx: speed * Math.sin(angle), vy: -speed * Math.cos(angle) };
}

function hitBrick(ball, bricks) {
  const index = bricks.findIndex(brick => ball.x + ball.radius > brick.x && ball.x - ball.radius < brick.x + brick.width && ball.y + ball.radius > brick.y && ball.y - ball.radius < brick.y + brick.height);
  if (index < 0) return null;
  const brick = bricks[index], overlapX = Math.min(ball.x + ball.radius - brick.x, brick.x + brick.width - (ball.x - ball.radius)), overlapY = Math.min(ball.y + ball.radius - brick.y, brick.y + brick.height - (ball.y - ball.radius));
  return { ball: overlapX < overlapY ? { ...ball, vx: -ball.vx } : { ...ball, vy: -ball.vy }, bricks: bricks.filter((_, position) => position !== index), points: (brickRows - brick.row) * 10 };
}

export function stepBreakout(state, seconds) {
  if (state.over || !state.launched) return state;
  let ball = { ...state.ball, x: state.ball.x + state.ball.vx * seconds, y: state.ball.y + state.ball.vy * seconds };
  ball = bouncePaddle(bounceWalls(ball), state.paddle, state.speed);
  if (ball.y - ball.radius > breakoutSize.height) {
    const lives = state.lives - 1;
    return { ...state, lives, launched: false, ball: restingBall(state.paddle, state.speed), over: lives <= 0 };
  }
  const hit = hitBrick(ball, state.bricks);
  if (!hit) return { ...state, ball };
  if (hit.bricks.length) return { ...state, ball: hit.ball, bricks: hit.bricks, score: state.score + hit.points };
  const speed = state.speed * 1.15;
  return { ...state, speed, bricks: bricksFor(), launched: false, ball: restingBall(state.paddle, speed), score: state.score + hit.points };
}
