import { useCallback, useEffect, useRef, useState } from 'react';
import { api, preference, savePreference } from '@/lib/workspace';

export function useRunStream(id) {
  const [update, setUpdate] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    const source = new EventSource(`/api/runs/${id}/events`);
    source.onmessage = event => { try { setUpdate(JSON.parse(event.data)); } catch { setError('Could not read run update.'); } };
    return () => source.close();
  }, [id]);
  return { run: update?.id === id ? update : null, setRun: setUpdate, error };
}

export function useNow(ticking) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

export function useRunHistory(id) {
  const [history, setHistory] = useState([]), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api(`/api/runs/${id}/history`, undefined, controller.signal).then(setHistory).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [id]);
  return { history, error };
}

// Refetch only after the run changes, so an idle or finished run causes no diff traffic.
// Throttled rather than debounced: a busy turn changes constantly and would otherwise never refresh.
export function useLiveDiff(id, run, enabled) {
  const [diff, setDiff] = useState(null), [error, setError] = useState(''), pending = useRef(null);
  const change = run ? `${run.status}:${run.events.length}:${run.checks.length}:${run.interactions?.length ?? 0}` : '';
  const load = useCallback(async () => {
    if (document.hidden) return;
    try { setDiff(await api(`/api/runs/${id}/diff`)); setError(''); }
    catch (failure) { setError(failure.message); }
  }, [id]);
  useEffect(() => { setDiff(null); setError(''); }, [id]);
  useEffect(() => {
    if (!enabled || !change || pending.current) return;
    pending.current = setTimeout(() => { pending.current = null; load(); }, diff ? 2000 : 0);
  }, [enabled, change, load]);
  useEffect(() => () => { clearTimeout(pending.current); pending.current = null; }, [enabled, load]);
  return { diff, error, reload: load };
}

export function useDraft(key) {
  const [draft, setDraftState] = useState(() => preference(key));
  useEffect(() => { setDraftState(preference(key)); }, [key]);
  const setDraft = useCallback(value => {
    setDraftState(current => {
      const next = typeof value === 'function' ? value(current) : value;
      savePreference(key, next);
      return next;
    });
  }, [key]);
  return [draft, setDraft];
}
