export const ease = [0.22, 1, 0.36, 1];

// A tween with a long ease-out lands exactly on target; springs leave a sub-pixel tail that reads as a late snap.
export const settle = { duration: 0.45, ease };

export const rise = (index, delay = 0.08) => ({ initial: { opacity: 0, y: 14, filter: 'blur(6px)' }, animate: { opacity: 1, y: 0, filter: 'blur(0px)' }, transition: { delay: delay + index * 0.07, duration: 0.6, ease } });

export function prefersReducedMotion() {
  const mode = document.documentElement.dataset.motion;
  return mode === 'reduce' || mode !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
