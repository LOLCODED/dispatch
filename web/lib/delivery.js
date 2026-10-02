import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/workspace';

// The run stream carries the refreshed delivery record; this hook only asks the server to re-read the delivery connector.
export function useDeliveryRefresh(runId, enabled, intervalMs = 60000) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setBusy(true);
    try { await api(`/api/runs/${runId}/delivery/refresh`, {}); setError(''); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }, [runId]);
  useEffect(() => {
    if (!enabled) return;
    let timer;
    const schedule = () => { clearInterval(timer); if (!document.hidden) { refresh(); timer = setInterval(refresh, intervalMs); } };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', schedule); };
  }, [enabled, intervalMs, refresh]);
  return { busy, error, refresh };
}
