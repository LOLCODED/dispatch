import { useEffect, useRef } from 'react';
import { layoutReaction } from '@/lib/run-layouts.mjs';

function apply(layout, actions, compact) {
  for (const [action, tile] of actions) {
    if (action === 'focus') layout.focus(tile);
    else if (action === 'open') layout.open(tile);
    else if (action === 'full') layout.enterFull(tile);
    else if (action === 'exitFull') layout.exitFull();
    else if (action === 'show') compact ? layout.focus(tile) : layout.show(tile);
    else if (action === 'close') layout.close(tile);
  }
}

const browserDismissedKey = id => `dispatch-browser-dismissed-${id}`;
const browserDismissed = id => { try { return sessionStorage.getItem(browserDismissedKey(id)) === '1'; } catch { return false; } };
const dismissBrowser = id => { try { sessionStorage.setItem(browserDismissedKey(id), '1'); } catch { /* Storage can be disabled. */ } };

// The live browser reacts once per visit when browsing starts; the layout decides whether it takes the run area. While it holds the run area, the agent's next message may hand it back. Leaving it yourself sticks for the run, even after returning to the page.
export function useBrowserFocus({ runId, driving, said, decision, layout, compact, policy, busy }) {
  const taken = useRef(false), holding = useRef(null);
  useEffect(() => {
    if (!holding.current) return;
    if (layout.full === 'browser') { holding.current.shown = true; return; }
    if (!holding.current.shown) return;
    holding.current = null;
    if (!decision) dismissBrowser(runId);
  }, [layout.full]);
  useEffect(() => {
    if (driving && !taken.current) {
      taken.current = true;
      if (browserDismissed(runId)) return;
      const actions = layoutReaction(policy, 'browse', { full: layout.full, busy });
      if (actions.some(([action]) => action === 'full')) holding.current = { said };
      apply(layout, actions, compact);
    } else if (holding.current && driving && said !== holding.current.said) {
      const actions = layoutReaction(policy, 'said', { full: layout.full });
      if (actions.length) { holding.current = null; apply(layout, actions, compact); }
    }
  }, [runId, driving, said, layout, compact, policy, busy]);
  const wasDriving = useRef(driving);
  useEffect(() => {
    if (wasDriving.current && !driving) { holding.current = null; apply(layout, layoutReaction(policy, 'browsed', { full: layout.full }), compact); }
    wasDriving.current = driving;
  }, [driving, layout, compact, policy]);
}

// A decision is answered in the chat unless the layout pins it above the tiles, so a new one brings the chat forward.
export function useDecisionFocus({ decision, layout, compact, policy }) {
  const seen = useRef(null);
  useEffect(() => {
    const previous = seen.current;
    seen.current = decision;
    if (!decision || previous === decision) return;
    apply(layout, layoutReaction(policy, 'question', { full: layout.full }), compact);
  }, [decision, layout, compact, policy]);
}

// The diff opens once per visit when the layout wants it; closing it afterwards sticks.
export function useDiffFocus({ wanted, layout, compact, policy }) {
  const done = useRef(false);
  useEffect(() => {
    if (!wanted || done.current) return;
    done.current = true;
    apply(layout, layoutReaction(policy, 'diff'), compact);
  }, [wanted, layout, compact, policy]);
}
