import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotionConfig } from 'motion/react';
import { Maximize } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { createSimulation } from '@/lib/force.mjs';
import { neighbours } from '@/lib/brain-graph.mjs';
import { drawGraph, fitView, graphColors, nodeAt, toWorld } from '@/components/brain/graph-draw';

const zoomLimits = [0.15, 6], dragThreshold = 4;

function useCanvasSize(canvasRef) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const canvas = canvasRef.current, observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect, dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      setSize({ width, height });
    });
    observer.observe(canvas); return () => observer.disconnect();
  }, [canvasRef]);
  return size;
}

function useSimulation(graph, reduced) {
  const [sim, setSim] = useState(null), previous = useRef(new Map());
  useEffect(() => {
    const next = createSimulation(graph, previous.current);
    next.settle(reduced ? 400 : previous.current.size ? 0 : 80);
    previous.current = next.byId; setSim(next);
  }, [graph, reduced]);
  return sim;
}

function useRenderLoop(render) {
  const frame = useRef(0), latest = useRef(render);
  useLayoutEffect(() => { latest.current = render; });
  const wake = useCallback(() => {
    if (frame.current) return;
    const loop = () => { frame.current = 0; if (latest.current()) frame.current = requestAnimationFrame(loop); };
    frame.current = requestAnimationFrame(loop);
  }, []);
  useEffect(() => { wake(); }, [render, wake]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return wake;
}

function useWheelZoom(canvasRef, view, wake) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const zoom = event => {
      event.preventDefault();
      const current = view.current, box = canvas.getBoundingClientRect();
      const k = Math.min(zoomLimits[1], Math.max(zoomLimits[0], current.k * Math.exp(-event.deltaY * 0.0015)));
      const px = event.clientX - box.left - box.width / 2, py = event.clientY - box.top - box.height / 2;
      view.current = { k, x: px - (px - current.x) * k / current.k, y: py - (py - current.y) * k / current.k };
      wake();
    };
    canvas.addEventListener('wheel', zoom, { passive: false }); return () => canvas.removeEventListener('wheel', zoom);
  }, [canvasRef, view, wake]);
}

function usePointer({ canvasRef, sim, view, wake, onHover, onSelect }) {
  const drag = useRef(null);
  const at = event => sim && nodeAt(sim, view.current, toWorld(canvasRef.current, view.current, event.clientX, event.clientY));
  const down = event => { canvasRef.current.setPointerCapture(event.pointerId); drag.current = { node: at(event), x: event.clientX, y: event.clientY, moved: false }; };
  const move = event => {
    const current = drag.current;
    if (!current) { onHover(at(event)?.id ?? null); return; }
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < dragThreshold) return;
    current.moved = true;
    if (current.node) { Object.assign(current.node, toWorld(canvasRef.current, view.current, event.clientX, event.clientY), { fixed: true }); sim.reheat(0.15); }
    else view.current = { ...view.current, x: view.current.x + event.movementX, y: view.current.y + event.movementY };
    wake();
  };
  const up = () => {
    const current = drag.current; drag.current = null;
    if (!current) return;
    if (current.node) current.node.fixed = false;
    if (!current.moved) onSelect(current.node?.type === 'entry' ? current.node.id : null);
  };
  return { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up, onPointerLeave: () => { if (!drag.current) onHover(null); } };
}

export function BrainGraph({ graph, matched, disabled, selected, onSelect, label }) {
  const canvasRef = useRef(null), view = useRef({ x: 0, y: 0, k: 1 }), fitted = useRef(false), reduced = useReducedMotionConfig();
  const size = useCanvasSize(canvasRef), sim = useSimulation(graph, reduced), [hover, setHover] = useState(null);
  const focusId = hover ?? selected;
  const render = useCallback(() => {
    if (!sim || !size.width) return false;
    if (!fitted.current && sim.nodes.length) { view.current = fitView(sim, size.width, size.height); fitted.current = true; }
    if (!reduced && sim.active()) sim.tick();
    drawGraph(canvasRef.current, sim, view.current, { colors: graphColors(canvasRef.current), focus: focusId ? neighbours(graph, focusId) : null, focusId, matched, disabled, selected, time: reduced ? null : performance.now() });
    return !reduced;
  }, [sim, size, reduced, focusId, graph, matched, disabled, selected]);
  const wake = useRenderLoop(render);
  useWheelZoom(canvasRef, view, wake);
  const pointer = usePointer({ canvasRef, sim, view, wake, onHover: setHover, onSelect });
  const fit = () => { if (sim) { view.current = fitView(sim, size.width, size.height); wake(); } };
  return <div className="brain-graph">
    <canvas ref={canvasRef} role="img" aria-label={label} className={hover ? 'is-pointing' : ''} {...pointer}/>
    <IconButton label="Fit to view" icon={Maximize} className="brain-graph-fit" onClick={fit}/>
  </div>;
}
