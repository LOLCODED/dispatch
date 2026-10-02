import { useEffect, useState } from 'react';
import { useReducedMotionConfig } from 'motion/react';
import { Check, FileText, FlaskConical, Gamepad2, Globe, MessageSquare } from 'lucide-react';
import { layoutModes, previewLayout, previewSteps } from '@/lib/run-layouts.mjs';

const icons = { chat: MessageSquare, diff: FileText, checks: FlaskConical, browser: Globe, games: Gamepad2 };
const layouts = {
  default: { label: 'Default', summary: 'The browser takes the screen while the agent drives it, and the diff opens when the task is ready to review.' },
  vibe: { label: 'Vibe', summary: 'For watching the app, not the code. The browser leads, chat skips tool activity, games fill the wait, and questions arrive in a bar that leaves your tiles alone.' },
  technical: { label: 'Technical', summary: 'For reviewing as it happens. The diff sits beside the chat from the first change, and the browser never takes the full screen.' },
};

function useStep(playing) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setStep(current => (current + 1) % previewSteps.length), 1600);
    return () => clearInterval(timer);
  }, [playing]);
  return [step, setStep];
}

function Miniature({ mode, step }) {
  const { visible, ratio, bar, asking } = previewLayout(mode, step), count = visible.length;
  const grid = count > 1 ? { gridTemplateColumns: `${ratio}fr ${1 - ratio}fr`, gridTemplateRows: `repeat(${count - 1}, 1fr)` } : undefined;
  return <span className="layout-mini" aria-hidden="true">
    {bar && <span className="layout-mini-bar"/>}
    <span className="layout-mini-tiles" style={grid}>{visible.map((tile, index) => {
      const Icon = icons[tile], area = count === 1 ? undefined : index === 0 ? { gridColumn: 1, gridRow: `1 / span ${count - 1}` } : { gridColumn: 2, gridRow: index };
      return <span key={tile} className={`layout-mini-tile is-${tile} ${tile === 'chat' && asking && !bar ? 'is-asking' : ''}`} style={area}><Icon size={13}/></span>;
    })}</span>
  </span>;
}

export function LayoutPicker({ value, onChange }) {
  const reduced = useReducedMotionConfig(), [step, setStep] = useStep(!reduced);
  return <div className="layout-picker">
    <div className="layout-cards" role="group" aria-label="Run page layout">{layoutModes.map(mode => <button type="button" key={mode} className="layout-card" aria-pressed={value === mode} onClick={() => onChange(mode)}>
      <span className="layout-card-name">{layouts[mode].label}{value === mode && <Check size={13} aria-hidden="true"/>}</span>
      <Miniature mode={mode} step={step}/>
      <span className="layout-card-summary">{layouts[mode].summary}</span>
    </button>)}</div>
    <div className="layout-steps" role="group" aria-label="Preview step">
      {previewSteps.map((label, index) => <button type="button" key={label} aria-pressed={index === step} onClick={() => setStep(index)}>{index + 1}<span className="sr-only"> {label}</span></button>)}
      <span className="muted">{previewSteps[step]}</span>
    </div>
  </div>;
}
