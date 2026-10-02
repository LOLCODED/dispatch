import { useEffect, useRef } from 'react';

const gestureGap = 200, swipeDistance = 40;
const downKeys = new Set(['ArrowDown', 'PageDown']), upKeys = new Set(['ArrowUp', 'PageUp']);
const owned = target => target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="dialog"]');

function scrollsWithin(target, delta) {
  for (let element = target instanceof Element ? target : null; element && element !== document.documentElement; element = element.parentElement) {
    if (!/auto|scroll/.test(getComputedStyle(element).overflowY)) continue;
    const room = delta > 0 ? element.scrollHeight - element.clientHeight - element.scrollTop : element.scrollTop;
    if (room > 1) return true;
  }
  return false;
}
const atTop = () => window.scrollY <= 0;

export function wheelListener(fire) {
  let last = -Infinity, gesture = null;
  return event => {
    if (!event.deltaY) return;
    const inner = scrollsWithin(event.target, event.deltaY);
    // Trackpads keep emitting momentum events after a scroll reaches the top, so only a gesture that began at the top may close.
    if (event.timeStamp - last > gestureGap) gesture = { fromTop: !inner && atTop(), fired: false };
    last = event.timeStamp;
    if (inner || gesture.fired) return;
    gesture.fired = fire(event.deltaY > 0 ? 'down' : 'up', gesture.fromTop);
  };
}

function touchListeners(fire) {
  let start = null;
  return {
    touchstart: event => { start = { target: event.target, y: event.touches[0].clientY, fromTop: atTop() }; },
    touchmove: event => {
      if (!start) return;
      const distance = start.y - event.touches[0].clientY;
      if (Math.abs(distance) < swipeDistance) return;
      if (scrollsWithin(start.target, distance)) { start = null; return; }
      fire(distance > 0 ? 'down' : 'up', start.fromTop); start = null;
    },
  };
}

function keyListener(fire) {
  return event => {
    if (owned(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (downKeys.has(event.key) && !scrollsWithin(event.target, 1)) fire('down', atTop());
    else if (upKeys.has(event.key) && !scrollsWithin(event.target, -1)) fire('up', atTop());
  };
}

export function useScrollIntent({ onDown, onUp }) {
  const handlers = useRef({ onDown, onUp });
  handlers.current = { onDown, onUp };
  useEffect(() => {
    const fire = (direction, fromTop) => {
      if (direction === 'down') { handlers.current.onDown(); return true; }
      if (fromTop) handlers.current.onUp();
      return fromTop;
    };
    const touch = touchListeners(fire);
    const listeners = [['wheel', wheelListener(fire)], ['touchstart', touch.touchstart], ['touchmove', touch.touchmove], ['keydown', keyListener(fire)]];
    for (const [type, listener] of listeners) window.addEventListener(type, listener, { passive: true });
    return () => { for (const [type, listener] of listeners) window.removeEventListener(type, listener); };
  }, []);
}
