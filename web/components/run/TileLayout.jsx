import { useEffect, useRef, useState } from 'react';
import { useScrollShadow } from '@/lib/scroll-shadow';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotionConfig, useTransform } from 'motion/react';
import { Maximize2, Minimize2, PanelLeft, X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { ease, prefersReducedMotion, settle } from '@/lib/motion';

const tileMotion = { initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 24 } };
const liftDistance = 4;
const columns = share => `minmax(0, ${share}fr) ${share < 1 ? 1 : 0}px minmax(0, ${1 - share}fr)`;

// A single tile is the same three-track grid with the side column at zero, so opening a tile can animate the split.
function useSplitColumns(split, ratio) {
  const share = useMotionValue(split ? ratio : 1), reduced = useReducedMotionConfig(), wasSplit = useRef(split);
  useEffect(() => {
    const target = split ? ratio : 1, toggled = wasSplit.current !== split;
    wasSplit.current = split;
    if (!toggled || reduced) { share.set(target); return; }
    const animation = animate(share, target, settle);
    return () => animation.stop();
  }, [split, ratio, reduced, share]);
  return useTransform(share, columns);
}

function Gutter({ ratio, onRatio, container }) {
  const drag = event => {
    const bounds = container.current.getBoundingClientRect();
    const move = moveEvent => onRatio((moveEvent.clientX - bounds.left) / bounds.width);
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    event.preventDefault();
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  };
  const key = event => {
    if (event.key === 'ArrowLeft') onRatio(ratio - 0.04);
    else if (event.key === 'ArrowRight') onRatio(ratio + 0.04);
    else return;
    event.preventDefault();
  };
  return <div className="tile-gutter" role="separator" aria-orientation="vertical" aria-label="Resize tiles" aria-valuemin={25} aria-valuemax={80} aria-valuenow={Math.round(ratio * 100)} tabIndex={0} onPointerDown={drag} onKeyDown={key}/>;
}

function tileAt(x, y, except) {
  const element = document.elementsFromPoint(x, y).map(node => node.closest('[data-tile]')).find(node => node && node.dataset.tile !== except);
  return element?.dataset.tile ?? null;
}

function settleBack(element, from) {
  if (!from || prefersReducedMotion()) return;
  element.animate([{ translate: from }, { translate: '0px 0px' }], { duration: 220, easing: `cubic-bezier(${ease.join(',')})` });
}

function useTileDrag(onSwap) {
  const [drag, setDrag] = useState({ tile: null, target: null });
  const stopRef = useRef(null);
  useEffect(() => () => stopRef.current?.(false), []);
  const start = (event, tile) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const element = event.currentTarget.closest('[data-tile]'), bounds = element.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY };
    let lifted = false, target = null;
    const move = moveEvent => {
      const dx = moveEvent.clientX - origin.x, dy = moveEvent.clientY - origin.y;
      if (!lifted && Math.hypot(dx, dy) < liftDistance) return;
      lifted = true;
      element.style.transformOrigin = `${origin.x - bounds.left}px ${origin.y - bounds.top}px`;
      element.style.translate = `${dx}px ${dy}px`;
      target = tileAt(moveEvent.clientX, moveEvent.clientY, tile);
      setDrag(current => current.tile === tile && current.target === target ? current : { tile, target });
    };
    const stop = drop => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key);
      stopRef.current = null;
      const from = element.style.translate;
      element.style.translate = '';
      setDrag({ tile: null, target: null });
      if (drop && target) onSwap(tile, target);
      else settleBack(element, from);
    };
    const up = () => stop(lifted);
    const cancel = () => stop(false);
    const key = keyEvent => { if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); stop(false); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key);
    stopRef.current = stop;
  };
  return { ...drag, start };
}

function TileBar({ tile, title, icon: Icon, primary, full, fullKey, layout, drag }) {
  return <header className={`tile-bar ${full ? '' : 'is-movable'}`} onPointerDown={full ? undefined : event => drag.start(event, tile)} title={full ? undefined : 'Drag to move this tile'}>
    <span className="tile-title"><Icon size={13} aria-hidden="true"/>{title}</span>
    <span className="tile-actions">
      {!primary && !full && <IconButton label={`Make ${title} primary`} icon={PanelLeft} onClick={() => layout.focus(tile)}/>}
      <IconButton label={full ? 'Exit full screen' : 'Full screen'} shortcut={full ? 'Escape' : fullKey} icon={full ? Minimize2 : Maximize2} aria-pressed={full} onClick={() => layout.toggleFull(tile)}/>
      {!full && <IconButton label={`Close ${title}`} icon={X} onClick={() => layout.toggle(tile)}/>}
    </span>
  </header>;
}

function Tile({ tile, index, count, tiles, layout, drag, focusMode, fullKey }) {
  const { title, icon, render, bare, className = '' } = tiles[tile], full = layout.full === tile;
  const body = useRef(null);
  useScrollShadow(body);
  const area = index === 0 ? { gridColumn: 1, gridRow: `1 / span ${Math.max(1, count - 1)}` } : { gridColumn: 3, gridRow: index };
  const focus = () => { if (layout.focused !== tile) layout.setFocused(tile); };
  const state = drag.tile === tile ? 'is-lifted' : drag.target === tile ? 'is-drop-target' : '';
  return <motion.section {...tileMotion} data-tile={tile} style={area} className={`tile tile-${tile} ${index === 0 ? 'is-primary' : ''} ${layout.focused === tile && count > 1 ? 'is-focused' : ''} ${state} ${className}`} aria-label={title}
    onPointerEnter={focusMode === 'hover' ? focus : undefined} onPointerDown={focus} onFocus={focus}>
    {(count > 1 || full) && !bare && <TileBar tile={tile} title={title} icon={icon} primary={index === 0} full={full} fullKey={fullKey} layout={layout} drag={drag}/>}
    <div ref={body} className="tile-body">{render()}</div>
  </motion.section>;
}

export function TileLayout({ tiles, layout, compact, focusMode, stroke = true, fullKey }) {
  const container = useRef(null), drag = useTileDrag(layout.swap);
  const shown = layout.full ? [layout.full] : compact ? layout.visible.slice(0, 1) : layout.visible;
  const split = shown.length > 1;
  const gridTemplateColumns = useSplitColumns(split, layout.ratio);
  const style = compact ? undefined : { gridTemplateColumns, gridTemplateRows: `repeat(${Math.max(1, shown.length - 1)}, minmax(0, 1fr))` };
  return <motion.div ref={container} className={`tiles ${split ? 'is-split' : ''} ${compact ? 'is-compact' : ''} ${layout.full ? 'is-full' : ''} ${drag.tile ? 'is-dragging' : ''} ${stroke ? '' : 'no-stroke'}`} style={style}>
    <AnimatePresence initial={false}>{shown.map((tile, index) => <Tile key={tile} tile={tile} index={index} count={shown.length} tiles={tiles} layout={layout} drag={drag} focusMode={focusMode} fullKey={fullKey}/>)}</AnimatePresence>
    {split && <div className="gutter-slot" style={{ gridColumn: 2, gridRow: `1 / span ${shown.length - 1}` }}><Gutter ratio={layout.ratio} onRatio={layout.setRatio} container={container}/></div>}
  </motion.div>;
}
