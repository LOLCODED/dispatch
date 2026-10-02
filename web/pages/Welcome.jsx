import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/IconButton';
import { LayoutPicker } from '@/components/LayoutDemo';
import { MotionChoice, ThemeChoice } from '@/components/AppearanceChoices';
import { ConnectorList, ProviderList, agentProviders, useConnections } from '@/components/Connections';
import { useAction } from '@/lib/use-action';
import { usePreferences } from '@/lib/preferences';
import { api, useWorkspace } from '@/lib/workspace';
import { ease, rise } from '@/lib/motion';

const steps = [
  { title: 'Connect an agent', words: ['Which', 'agents', 'should', 'dispatch'], accent: 'use?', lede: 'dispatch hands each task to an agent CLI you already use. Turn on the ones you want; dispatch checks nothing until you do.' },
  { title: 'Choose how runs look', words: ['How', 'should', 'a', 'run'], accent: 'look?', lede: 'Pick what fills the run page while an agent works. You can change this any time in Settings.' },
  { title: 'Connect your tracker', words: ['Where', 'do', 'your', 'tickets'], accent: 'live?', lede: 'Turn on a connector to pull tickets from your tracker. This is optional; nothing is read until a repository turns it on.' },
];

const follow = delay => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.5, ease } });

function useAgentReady(connections) {
  const { state } = useWorkspace();
  return agentProviders.some(provider => state.providerSettings?.[provider.id] === true && connections?.[provider.id]?.available === true);
}

function StepBody({ step, connections, busy, onProvider, onConnector }) {
  const { layout, setLayout } = usePreferences();
  if (step === 0) return <>
    <ProviderList connections={connections} busy={busy} onToggle={onProvider}/>
    <p className="muted">Local models and more provider options are in Settings.</p>
  </>;
  if (step === 1) return <>
    <LayoutPicker value={layout} onChange={setLayout}/>
    <div className="welcome-prefs"><span>Theme <ThemeChoice/></span><span>Motion <MotionChoice/></span></div>
  </>;
  return <ConnectorList connections={connections} busy={busy} onToggle={onConnector}/>;
}

function StepNav({ step, ready, busy, onMove, onFinish }) {
  const last = step === steps.length - 1;
  return <>
    {step > 0 && <IconButton label="Back" icon={ArrowLeft} onClick={() => onMove(-1)}/>}
    {!last && <IconButton label="Skip setup" icon={ChevronsRight} disabled={busy} onClick={onFinish}/>}
    <span className="welcome-grow"/>
    {!ready && <span className="muted">Connect at least one agent to continue.</span>}
    {last ? <Button disabled={busy} onClick={onFinish}>dispatch<ArrowUpRight aria-hidden="true"/></Button>
      : <IconButton label="Continue" icon={ArrowRight} variant="default" disabled={!ready} onClick={() => onMove(1)}/>}
  </>;
}

export function Welcome({ onFinish }) {
  const { busy, error, perform } = useAction(), { connections, toggle, toggleConnector } = useConnections(perform);
  const [step, setStep] = useState(0), heading = useRef(null), agentReady = useAgentReady(connections);
  const ready = step !== 0 || agentReady, current = steps[step];
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);
  useEffect(() => {
    const enter = event => {
      if (event.key !== 'Enter' || step === steps.length - 1 || event.target.closest?.('button, a, input, textarea, select, [role=switch], [role=dialog]')) return;
      event.preventDefault(); move(1);
    };
    window.addEventListener('keydown', enter); return () => window.removeEventListener('keydown', enter);
  });
  const move = by => { if (by < 0 || ready) setStep(Math.min(steps.length - 1, Math.max(0, step + by))); };
  const finish = () => perform(async () => { await api('/api/setup/complete', {}); window.dispatchEvent(new Event('dispatch-refresh')); onFinish(); });
  return <main className="welcome">
    <div className="welcome-progress" aria-hidden="true"><motion.span animate={{ width: `${((step + 1) / steps.length) * 100}%` }} transition={{ duration: 0.6, ease }}/></div>
    <div className="welcome-inner" key={step}>
      <motion.p className="eyebrow" {...follow(0)}>Step {step + 1} of {steps.length} · {current.title}</motion.p>
      <h1 ref={heading} tabIndex={-1} className="welcome-title">{current.words.map((word, index) => <span key={word}><motion.span className="intro-word" {...rise(index)}>{word}</motion.span>{' '}</span>)}<motion.em {...rise(current.words.length)}>{current.accent}</motion.em></h1>
      <motion.p className="welcome-lede" {...follow(0.38)}>{current.lede}</motion.p>
      <motion.div className="welcome-body" {...follow(0.45)}><StepBody step={step} connections={connections} busy={busy} onProvider={toggle} onConnector={toggleConnector}/></motion.div>
      {error && <p role="alert" className="error">{error}</p>}
      <motion.footer className="welcome-nav" {...follow(0.52)}><StepNav step={step} ready={ready} busy={busy} onMove={move} onFinish={finish}/></motion.footer>
    </div>
  </main>;
}
