import { useEffect } from 'react';
import { stagger, useAnimate, useReducedMotionConfig } from 'motion/react';
import { Logo } from '@/components/Logo';
import { ease } from '@/lib/motion';
import { navigate } from '@/lib/workspace';

const letters = [...'dispatch'];
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function drawMark(animate) {
  const word = animate('.reveal-word span', { opacity: [0, 1], y: [10, 0] }, { duration: 0.42, delay: stagger(0.045, { startDelay: 0.52 }), ease });
  await animate('.reveal-logo', { opacity: [0, 1], scale: [0.4, 1], rotate: [-12, 0] }, { duration: 0.56, ease: [0.34, 1.56, 0.64, 1] });
  await animate('.reveal-logo path', { strokeDashoffset: [1, 0] }, { duration: 0.56, ease: [0.65, 0, 0.35, 1] });
  await word;
}

async function dockMark(scope, animate) {
  const target = document.querySelector('.masthead .brand-mark svg')?.getBoundingClientRect();
  const mark = scope.querySelector('.reveal-mark'), logo = scope.querySelector('.reveal-logo');
  const fade = animate('.reveal-bg', { opacity: 0 }, { duration: 0.62, delay: 0.12, ease: 'easeOut' });
  if (!target) return animate(scope, { opacity: 0 }, { duration: 0.3 });
  const from = logo.getBoundingClientRect(), box = mark.getBoundingClientRect();
  mark.style.transformOrigin = `${from.left - box.left}px ${from.top - box.top}px`;
  await animate(mark, { x: target.left - from.left, y: target.top - from.top, scale: target.width / from.width }, { duration: 0.82, ease: [0.65, 0, 0.25, 1] });
  await fade;
}

export function SetupReveal({ onDone }) {
  const [scope, animate] = useAnimate(), reduced = useReducedMotionConfig();
  useEffect(() => {
    const root = document.documentElement;
    if (reduced) { navigate('/'); onDone(); return; }
    root.dataset.revealing = '';
    (async () => {
      await drawMark(animate);
      await pause(420);
      navigate('/');
      await nextFrame();
      await dockMark(scope.current, animate);
    })().finally(() => { delete root.dataset.revealing; onDone(); });
    return () => { delete root.dataset.revealing; };
  }, []);
  if (reduced) return null;
  return <div ref={scope} className="reveal" aria-hidden="true">
    <div className="reveal-bg"/>
    <div className="reveal-mark">
      <span className="reveal-logo"><Logo/></span>
      <span className="reveal-word">{letters.map((letter, index) => <span key={index}>{letter}</span>)}<span className="brand-period">.</span></span>
    </div>
  </div>;
}
