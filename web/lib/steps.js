import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/workspace';

const maxSteps = 5000;

async function fetchPages(id, after, until, signal, onPage) {
  for (let page = 0; page < 20 && after < until; page++) {
    const result = await api(`/api/runs/${id}/steps?after=${after}&limit=500`, undefined, signal);
    onPage(result.steps);
    after = result.next ?? after + result.steps.length;
    if (!result.steps.length) break;
  }
  return after;
}

// Fetches only the steps appended since the last page, driven by the run stream's stepCount.
export function useRunSteps(id, stepCount) {
  const [steps, setSteps] = useState([]), [error, setError] = useState(''), loading = useRef(false), last = useRef(0);
  useEffect(() => { setSteps([]); last.current = 0; }, [id]);
  useEffect(() => {
    if (!stepCount || stepCount <= last.current || loading.current) return;
    loading.current = true;
    const controller = new AbortController();
    (async () => {
      try {
        last.current = await fetchPages(id, last.current, stepCount, controller.signal, page => setSteps(current => [...current, ...page].slice(-maxSteps)));
        setError('');
      } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
      finally { loading.current = false; }
    })();
    return () => controller.abort();
  }, [id, stepCount]);
  return { steps, error };
}

// Earlier runs of a ticket have finished, so their steps load once.
export function useEarlierSteps(runs) {
  const [steps, setSteps] = useState({}), [error, setError] = useState(''), ids = runs.map(run => run.id).join();
  useEffect(() => {
    const controller = new AbortController();
    setSteps({});
    Promise.all(runs.filter(run => run.stepCount).map(async run => {
      const loaded = [];
      await fetchPages(run.id, 0, run.stepCount, controller.signal, page => loaded.push(...page));
      return [run.id, loaded.slice(-maxSteps)];
    })).then(entries => { setSteps(Object.fromEntries(entries)); setError(''); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [ids]);
  return { steps, error };
}
