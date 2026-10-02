import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

const easeMs = 350;

// Streamed text arrives in bursts; reveal the backlog with an exponential ease so bursts read as a steady stream.
export function useSmoothText(target) {
  const [shown, setShown] = useState(target), shownRef = useRef(target);
  useEffect(() => {
    if (!target.startsWith(shownRef.current) || prefersReducedMotion()) {
      shownRef.current = target; setShown(target); return;
    }
    let frame, last = performance.now();
    const step = now => {
      const backlog = target.length - shownRef.current.length;
      if (backlog <= 0) return;
      const count = Math.max(1, Math.round(backlog * Math.min(1, (now - last) / easeMs)));
      last = now; shownRef.current = target.slice(0, shownRef.current.length + Math.min(backlog, count)); setShown(shownRef.current);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}
