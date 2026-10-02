import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

const verbs = ['Routing', 'Couriering', 'Relaying', 'Wayfinding', 'Parceling', 'Postmarking', 'Shuttling', 'Ferrying', 'Charting', 'Telegraphing', 'Semaphoring', 'Trailblazing', 'Signposting', 'Hauling', 'Tracking'];

function useRotatingVerb(intervalMs = 2600) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * verbs.length));
  useEffect(() => {
    const timer = setInterval(() => setIndex(current => (current + 1) % verbs.length), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return verbs[index];
}

export function AgentPulse({ agent, activity }) {
  const verb = useRotatingVerb();
  return <div className="agent-pulse" role="status" aria-label={`${agent} is working`}>
    <span className="pulse-orb" aria-hidden="true"><span/><span/><span/></span>
    <span className="pulse-verb" aria-hidden="true"><AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={verb} className="shimmer-text" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>{verb}…</motion.span>
    </AnimatePresence></span>
    {activity && <span className="pulse-activity">{activity}</span>}
  </div>;
}
