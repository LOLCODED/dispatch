import { createContext, useContext, useEffect, useState } from 'react';
export const terminal = new Set(['planned', 'ready', 'failed', 'cancelled', 'interrupted', 'blocked', 'budget_exceeded']);
export async function api(path, data, signal) {
  const response = await fetch(path, { signal, ...(data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }) });
  const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.error ?? 'Request failed'), { question: value.question }); return value;
}
export function preference(key, fallback = '') { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
export function savePreference(key, value) { try { localStorage.setItem(key, value); } catch { /* Storage can be disabled. */ } }
export function navigate(path, { replace = false } = {}) { history[replace ? 'replaceState' : 'pushState']({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0); }
export function Link({ href, onClick, ...props }) { return <a href={href} {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0 && !props.target && props.download === undefined && href.startsWith('/')) { event.preventDefault(); navigate(href); } }} />; }
export function usePath() { const [path, setPath] = useState(location.pathname); useEffect(() => { const update = () => setPath(location.pathname); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []); return path; }
const WorkspaceContext = createContext(null);
export function WorkspaceProvider({ children }) {
  const [state, setState] = useState({ runs: [], tasks: [], projects: [], labels: {} }), [loaded, setLoaded] = useState(false), [connected, setConnected] = useState(true);
  useEffect(() => {
    let stopped = false, timer, pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      clearTimeout(timer);
      if (stopped || pending) return;
      pending = true;
      try {
        const result = await api('/api/workspace', undefined, controller.signal);
        if (!stopped) { setState(result); setLoaded(true); setConnected(true); }
      } catch { if (!stopped) setConnected(false); }
      finally { pending = false; if (!stopped) timer = setTimeout(refresh, document.hidden ? 10000 : 2000); }
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('popstate', refresh);
    window.addEventListener('dispatch-refresh', refresh);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('popstate', refresh); window.removeEventListener('dispatch-refresh', refresh); };
  }, []);

  return <WorkspaceContext.Provider value={{ state, loaded, connected }}>{children}</WorkspaceContext.Provider>;
}
export const useWorkspace = () => useContext(WorkspaceContext);
export function duration(ms) { if (ms == null) return '—'; const seconds = Math.floor(ms / 1000); if (seconds < 60) return `${seconds}s`; const minutes = Math.floor(seconds / 60); return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
export const count = n => n == null ? 'Not reported' : new Intl.NumberFormat().format(n);
export function Metric({ label, value, note }) { return <div className="metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>; }
