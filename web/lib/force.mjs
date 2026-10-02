const settings = { cell: 45, repulsion: 700, gravity: 0.012, damping: 0.62, decay: 0.985, rest: 0.004 };
const linkShape = { scope: { length: 150, strength: 0.05 }, memory: { length: 55, strength: 0.06 }, run: { length: 35, strength: 0.08 }, term: { length: 70, strength: 0.02 } };

export function radius(node) {
  if (node.type === 'scope') return 7 + Math.min(9, Math.sqrt(node.degree));
  if (node.type === 'run') return 2.5;
  return 3 + Math.min(4, node.degree * 0.4);
}

// A golden-angle spiral seeds positions deterministically, so the same memory lays out the same way on every visit.
function seed(nodes, previous) {
  return nodes.map((node, index) => {
    const kept = previous.get(node.id), angle = index * 2.399963, distance = 12 * Math.sqrt(index + 1);
    return { ...node, x: kept?.x ?? Math.cos(angle) * distance, y: kept?.y ?? Math.sin(angle) * distance, vx: 0, vy: 0, fixed: false };
  });
}

const cellOf = value => Math.floor(value / settings.cell);
const cellKey = (x, y) => (x + 32768) * 65536 + (y + 32768);

function grid(nodes) {
  const cells = new Map();
  for (const node of nodes) {
    const key = cellKey(cellOf(node.x), cellOf(node.y)), cell = cells.get(key);
    if (cell) cell.push(node); else cells.set(key, [node]);
  }
  return cells;
}

function repel(nodes, alpha) {
  const cells = grid(nodes), reach = settings.cell * settings.cell, strength = settings.repulsion * alpha;
  for (const node of nodes) {
    const cx = cellOf(node.x), cy = cellOf(node.y);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const cell = cells.get(cellKey(cx + dx, cy + dy));
      if (!cell) continue;
      for (const other of cell) {
        const x = node.x - other.x, y = node.y - other.y, squared = x * x + y * y;
        if (other === node || squared > reach) continue;
        const force = strength / Math.max(1, squared) / Math.sqrt(Math.max(1, squared));
        node.vx += x * force; node.vy += y * force;
      }
    }
  }
}

// Like d3-force, springs weaken with degree and move the lighter end more, so hubs with hundreds of memories do not oscillate.
function attract(links, byId, alpha) {
  for (const link of links) {
    const a = byId.get(link.source), b = byId.get(link.target), shape = linkShape[link.kind] ?? linkShape.memory;
    if (!a || !b) continue;
    const x = b.x - a.x, y = b.y - a.y, distance = Math.max(1, Math.hypot(x, y));
    const pull = (distance - shape.length) / distance * shape.strength * 20 / Math.min(Math.max(1, a.degree), Math.max(1, b.degree)) * alpha;
    const bias = Math.max(1, a.degree) / (Math.max(1, a.degree) + Math.max(1, b.degree));
    b.vx -= x * pull * bias; b.vy -= y * pull * bias; a.vx += x * pull * (1 - bias); a.vy += y * pull * (1 - bias);
  }
}

export function createSimulation(graph, previous = new Map()) {
  const nodes = seed(graph.nodes, previous), byId = new Map(nodes.map(node => [node.id, node]));
  let alpha = previous.size ? 0.3 : 1;
  const tick = () => {
    repel(nodes, alpha); attract(graph.links, byId, alpha);
    for (const node of nodes) {
      if (node.fixed) { node.vx = node.vy = 0; continue; }
      node.vx = (node.vx - node.x * settings.gravity * alpha) * settings.damping;
      node.vy = (node.vy - node.y * settings.gravity * alpha) * settings.damping;
      node.x += node.vx; node.y += node.vy;
    }
    alpha *= settings.decay;
  };
  return {
    nodes, byId, links: graph.links,
    tick,
    active: () => alpha > settings.rest,
    reheat: (to = 0.3) => { alpha = Math.max(alpha, to); },
    settle: (steps = 120) => { for (let step = 0; step < steps; step++) tick(); },
  };
}
