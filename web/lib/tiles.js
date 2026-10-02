import { useCallback, useEffect, useState } from 'react';
import { preference, savePreference } from '@/lib/workspace';
import { layoutPolicy, managedTiles } from '@/lib/run-layouts.mjs';

const storageKey = mode => mode === 'default' ? 'dispatch-tiles' : `dispatch-tiles-${mode}`;
export const tileFocusKey = 'dispatch-tile-focus';
export const tileFocusModes = ['hover', 'click'];
export const tileStrokeKey = 'dispatch-tile-stroke';
export const tileStrokeModes = ['on', 'off'];

function defaultsFor(mode) {
  const { order, open, ratio } = layoutPolicy(mode);
  return { order, open, ratio };
}

// The layout's automation decides when the diff and browser open, so a saved layout keeps only the tiles you chose.
function readLayout(mode) {
  const defaults = defaultsFor(mode), chosen = tile => defaults.order.includes(tile) && !managedTiles.includes(tile);
  try {
    const saved = JSON.parse(preference(storageKey(mode), 'null'));
    if (!saved || !Array.isArray(saved.order) || !Array.isArray(saved.open)) return defaults;
    const order = [...saved.order.filter(tile => defaults.order.includes(tile)), ...defaults.order.filter(tile => !saved.order.includes(tile))];
    return { order, open: saved.open.filter(chosen), ratio: clampRatio(saved.ratio ?? defaults.ratio) };
  } catch { return defaults; }
}

export const clampRatio = ratio => Math.min(0.8, Math.max(0.25, Number(ratio) || 0.56));
export const tileFocusMode = () => tileFocusModes.includes(preference(tileFocusKey)) ? preference(tileFocusKey) : 'hover';
export const tileStrokeMode = () => tileStrokeModes.includes(preference(tileStrokeKey)) ? preference(tileStrokeKey) : 'on';

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query), update = () => setMatches(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function withOpen(layout, tile) {
  return layout.open.includes(tile) ? layout : { ...layout, open: [...layout.open, tile] };
}

function withoutOpen(layout, tile, available) {
  const remaining = layout.open.filter(item => item !== tile && available.includes(item));
  return remaining.length ? { ...layout, open: layout.open.filter(item => item !== tile) } : layout;
}

// Master/stack tiling: the first visible tile is primary, the rest share the side column. One tile can take the whole run area.
export function useTiles(available, mode = 'default') {
  const [layout, setLayout] = useState(() => readLayout(mode)), [focused, setFocused] = useState(null), [full, setFull] = useState(null);
  useEffect(() => { savePreference(storageKey(mode), JSON.stringify(layout)); }, [layout, mode]);
  const visible = layout.order.filter(tile => available.includes(tile) && layout.open.includes(tile));
  const shown = visible.length ? visible : ['chat'];
  const fullTile = full && available.includes(full) ? full : null;
  const focusedTile = shown.includes(focused) || focused === fullTile ? focused : shown[0];
  const focus = useCallback(tile => setLayout(current => withOpen({ ...current, order: [tile, ...current.order.filter(item => item !== tile)] }, tile)), []);
  const swap = useCallback((tile, target) => setLayout(current => {
    if (tile === target || !current.order.includes(tile) || !current.order.includes(target)) return current;
    return { ...current, order: current.order.map(item => item === tile ? target : item === target ? tile : item) };
  }), []);
  const open = useCallback(tile => setLayout(current => withOpen(current, tile)), []);
  const show = useCallback(tile => { setLayout(current => withOpen(current, tile)); setFocused(tile); setFull(current => current ? tile : null); }, []);
  const toggle = useCallback(tile => {
    if (fullTile) { setFull(fullTile === tile ? null : tile); setFocused(tile); setLayout(current => withOpen(current, tile)); return; }
    setLayout(current => current.open.includes(tile) ? withoutOpen(current, tile, available) : withOpen(current, tile));
  }, [available.join(), fullTile]);
  const close = useCallback(tile => setLayout(current => withoutOpen(current, tile, available)), [available.join()]);
  const enterFull = useCallback(tile => { setFocused(tile); setFull(tile); setLayout(current => withOpen(current, tile)); }, []);
  const exitFull = useCallback(() => setFull(null), []);
  const toggleFull = useCallback((tile = focusedTile) => fullTile ? exitFull() : enterFull(tile), [focusedTile, fullTile, enterFull, exitFull]);
  const setRatio = useCallback(ratio => setLayout(current => ({ ...current, ratio: clampRatio(ratio) })), []);
  return { visible: shown, ratio: layout.ratio, focused: focusedTile, full: fullTile, focus, swap, open, show, toggle, close, toggleFull, enterFull, exitFull, setFocused, setRatio, isOpen: tile => shown.includes(tile) };
}
