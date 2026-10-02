import { radius } from '@/lib/force.mjs';

const kindColors = { rule: '--primary', preference: '--attention', connector: '--danger', note: '--active' };
const labelZoom = 2.8, labelLength = 42, drift = { reach: 1.8, period: 8000 };

export function graphColors(element) {
  const style = getComputedStyle(element), read = name => style.getPropertyValue(name).trim();
  return { ...Object.fromEntries(Object.entries(kindColors).map(([kind, name]) => [kind, read(name)])), scope: read('--foreground'), run: read('--muted-foreground'), link: read('--muted-foreground'), background: read('--card') };
}

const colorOf = (node, colors) => node.type === 'entry' ? colors[node.kind] ?? colors.run : colors[node.type];
const shortLabel = text => text.length > labelLength ? `${text.slice(0, labelLength - 1)}…` : text;

function faded(node, { focus, matched, disabled }) {
  if (focus) return !focus.has(node.id);
  if (matched) return node.type !== 'scope' && !matched.has(node.id);
  return disabled.has(node.id);
}

function drawLinks(ctx, sim, state, view) {
  ctx.lineWidth = 0.7 / view.k; ctx.strokeStyle = state.colors.link;
  for (const pass of [false, true]) {
    ctx.globalAlpha = pass ? 0.75 : state.focus || state.matched ? 0.06 : 0.22;
    ctx.beginPath();
    for (const link of sim.links) {
      const a = sim.byId.get(link.source), b = sim.byId.get(link.target);
      if (!a || !b) continue;
      const lit = Boolean(state.focus?.has(a.id) && state.focus?.has(b.id) && (a.id === state.focusId || b.id === state.focusId));
      if (lit !== pass) continue;
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
}

function drawNodes(ctx, sim, state, view) {
  for (const node of sim.nodes) {
    const r = radius(node);
    ctx.globalAlpha = faded(node, state) ? 0.18 : 1;
    ctx.fillStyle = colorOf(node, state.colors);
    ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2); ctx.fill();
    if (node.id === state.selected) { ctx.lineWidth = 2 / view.k; ctx.strokeStyle = state.colors.scope; ctx.beginPath(); ctx.arc(node.x, node.y, r + 3 / view.k, 0, Math.PI * 2); ctx.stroke(); }
  }
}

function drawLabels(ctx, sim, state, view) {
  ctx.font = `${11 / view.k}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = state.colors.scope;
  for (const node of sim.nodes) {
    const shown = node.type === 'scope' || state.focus?.has(node.id) || node.id === state.selected || view.k >= labelZoom && node.type === 'entry' && !faded(node, state);
    if (!shown || node.type === 'run') continue;
    ctx.globalAlpha = state.focus && !state.focus.has(node.id) ? 0.3 : node.type === 'scope' || node.id === state.focusId ? 1 : 0.8;
    ctx.fillText(shortLabel(node.label ?? ''), node.x, node.y + radius(node) + 4 / view.k);
  }
}

// Each node sways on its own phase so the settled graph keeps breathing; positions in the simulation stay untouched.
function drifted(sim, time) {
  if (time == null) return sim;
  const nodes = sim.nodes.map((node, index) => {
    const reach = node.type === 'scope' ? drift.reach / 3 : drift.reach, phase = index * 2.399963, t = time / drift.period * Math.PI * 2;
    return { ...node, x: node.x + Math.sin(t + phase) * reach, y: node.y + Math.cos(t * 0.8 + phase * 1.3) * reach };
  });
  return { nodes, links: sim.links, byId: new Map(nodes.map(node => [node.id, node])) };
}

export function drawGraph(canvas, source, view, state) {
  const sim = drifted(source, state.time), ctx = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1, width = canvas.width / dpr, height = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  ctx.translate(width / 2 + view.x, height / 2 + view.y); ctx.scale(view.k, view.k);
  drawLinks(ctx, sim, state, view); drawNodes(ctx, sim, state, view); drawLabels(ctx, sim, state, view);
  ctx.globalAlpha = 1;
}

export function toWorld(canvas, view, clientX, clientY) {
  const box = canvas.getBoundingClientRect();
  return { x: (clientX - box.left - box.width / 2 - view.x) / view.k, y: (clientY - box.top - box.height / 2 - view.y) / view.k };
}

export function nodeAt(sim, view, point) {
  let best = null, bestDistance = Infinity;
  for (const node of sim.nodes) {
    const distance = Math.hypot(node.x - point.x, node.y - point.y), reach = radius(node) + 5 / view.k;
    if (distance <= reach && distance < bestDistance) { best = node; bestDistance = distance; }
  }
  return best;
}

export function fitView(sim, width, height) {
  if (!sim.nodes.length) return { x: 0, y: 0, k: 1 };
  const xs = sim.nodes.map(node => node.x), ys = sim.nodes.map(node => node.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min(2.4, Math.max(0.2, Math.min(width / (maxX - minX + 120), height / (maxY - minY + 120))));
  return { x: -(minX + maxX) / 2 * k, y: -(minY + maxY) / 2 * k, k };
}
