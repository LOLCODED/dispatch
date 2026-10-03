import { useEffect, useState } from 'react';
import { api } from '@/lib/workspace';

const previewDelay = 300;
const confidenceLabel = { certain: 'sure', likely: 'likely', learned: 'learned', ask: 'unsure', chosen: 'your pick' };

export function useRoutePreview(input, enabled) {
  const [route, setRoute] = useState(null);
  useEffect(() => {
    if (!enabled || !input.trim()) { setRoute(null); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(() => api('/api/routing/preview', { input }, controller.signal).then(setRoute, () => setRoute(null)), previewDelay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [input, enabled]);
  return route;
}

function Choices({ options, disabled, onChoose }) {
  return options.map(option => <button key={option.id} type="button" className="route-guess" title={option.reason} disabled={disabled} onClick={() => onChoose(option.id)}>{option.name}{option.reason ? '?' : ''}</button>);
}

// There is no repository picker: the chip says where a ticket will run and why, and a correction teaches routing for next time.
export function RouteChip({ route, selection, projects, disabled, onChoose }) {
  const [open, setOpen] = useState(false);
  const chosen = selection.mode === 'manual' ? projects.find(project => project.id === selection.ids[0]) : null;
  if (!chosen && !route) return null;
  const choose = id => { setOpen(false); onChoose(id); };
  const confidence = chosen ? 'chosen' : route.confidence;
  const guesses = !chosen && route.home ? route.ranked : [];
  const others = projects.filter(project => project.id !== (chosen ?? route.project).id && !guesses.some(guess => guess.id === project.id));
  return <p className="route-reason" role="status" aria-label="Repository route">
    <span className={`route-confidence route-${confidence}`}>{confidenceLabel[confidence] ?? confidence}</span>
    <span>{chosen ? `Runs in ${chosen.name}.` : route.reason}</span>
    <Choices options={guesses} disabled={disabled} onChoose={choose}/>
    {chosen && <button type="button" className="route-link" disabled={disabled} onClick={() => choose('')}>Back to auto</button>}
    {!chosen && others.length > 0 && !open && <button type="button" className="route-link" disabled={disabled} onClick={() => setOpen(true)}>{guesses.length ? 'Other…' : 'Not this one?'}</button>}
    {!chosen && open && <Choices options={others} disabled={disabled} onChoose={choose}/>}
  </p>;
}
