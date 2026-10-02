import { ease, prefersReducedMotion } from '@/lib/motion';

const waitLimit = 3000, flightDuration = 650, curve = `cubic-bezier(${ease.join(',')})`;

function findLanding(runId) {
  const row = document.querySelector(`.board-row[data-run="${CSS.escape(runId)}"]`);
  if (row) return { element: row, rect: (row.querySelector('.board-title') ?? row).getBoundingClientRect() };
  const cue = !document.getElementById('tasks') && document.querySelector('.history-cue');
  return cue ? { element: cue, rect: cue.getBoundingClientRect() } : null;
}

function waitForLanding(runId) {
  const started = performance.now();
  return new Promise(resolve => {
    const look = () => {
      const landing = findLanding(runId);
      if (landing || performance.now() - started > waitLimit) resolve(landing);
      else requestAnimationFrame(look);
    };
    look();
  });
}

function createGhost(text, from) {
  const ghost = document.createElement('div');
  ghost.className = 'dispatch-flight';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.textContent = text;
  Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px` });
  document.body.append(ghost);
  return ghost;
}

function land(element) {
  element.classList.add('is-arrived');
  element.addEventListener('animationend', () => element.classList.remove('is-arrived'), { once: true });
}

export async function flyToTask(source, runId, text) {
  const title = text.trim().split('\n')[0];
  if (!source || !title || prefersReducedMotion()) return;
  const landing = await waitForLanding(runId);
  if (!landing || !source.isConnected) return;
  const box = source.getBoundingClientRect(), from = { left: box.left, top: box.top, width: box.width };
  const ghost = createGhost(title, from), to = landing.rect, height = ghost.offsetHeight;
  const flight = ghost.animate([
    { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, fontSize: '16px', opacity: 1 },
    { left: `${to.left}px`, top: `${to.top + (to.height - height) / 2}px`, width: `${to.width}px`, fontSize: '14px', opacity: 0.4 },
  ], { duration: flightDuration, easing: curve, fill: 'forwards' });
  await flight.finished;
  ghost.remove();
  land(landing.element);
}
