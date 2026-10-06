import { useEffect, useRef, useState } from 'react';
import { BellOff, Download, RotateCw } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { api, preference, savePreference } from '@/lib/workspace';

const dismissalKey = 'dispatch-update-alert-dismissed-until', pollMs = 2000, day = 24 * 60 * 60 * 1000;
const working = new Set(['starting', 'waiting', 'building', 'restarting']);
const stageText = { starting: 'Starting the update…', building: 'Installing and building…', restarting: 'Restarting dispatch…' };

function progressText(progress, target) {
  if (progress?.stage === 'waiting') return progress.message ?? 'Waiting for working runs to finish…';
  return `${stageText[progress?.stage] ?? 'Restarting dispatch…'} ${target ? `(${target})` : ''}`.trim();
}

// While the server restarts it stops answering; the page reloads once the version it answers with is the one being installed.
function useUpdatePolling(target, active, onStatus) {
  useEffect(() => {
    if (!active) return undefined;
    let stopped = false, timer;
    const poll = async () => {
      try {
        const status = await api('/api/update');
        if (stopped) return;
        if (status.current === target || status.progress?.stage === 'done') { window.location.reload(); return; }
        onStatus(status);
      } catch { if (!stopped) onStatus(previous => ({ ...previous, progress: { stage: 'restarting' } })); }
      if (!stopped) timer = setTimeout(poll, pollMs);
    };
    timer = setTimeout(poll, pollMs);
    return () => { stopped = true; clearTimeout(timer); };
  }, [target, active, onStatus]);
}

export function UpdateAlert() {
  const [status, setStatus] = useState(null), [error, setError] = useState(null), [dismissedUntil, setDismissedUntil] = useState(() => Number(preference(dismissalKey, '0')));
  const target = useRef(null);
  useEffect(() => {
    api('/api/update').then(found => found.installed && !found.checkedAt ? api('/api/update/check', {}) : found).then(setStatus, () => {});
  }, []);
  const progress = status?.progress, updating = working.has(progress?.stage);
  if (status?.latest) target.current = status.latest;
  useUpdatePolling(target.current, updating, setStatus);
  const failed = progress?.stage === 'failed' ? progress.message : error;
  if (!status?.installed || (!status.latest && !failed) || (dismissedUntil > Date.now() && !updating)) return null;
  const start = async () => { setError(null); try { setStatus(await api('/api/update', {})); } catch (reason) { setError(reason.message); } };
  const dismiss = () => { const until = Date.now() + day; savePreference(dismissalKey, String(until)); setDismissedUntil(until); };
  return <aside className="home-alert" aria-label="Update alert" aria-live="polite">
    <Download size={18} aria-hidden="true"/>
    <div><strong>{updating ? `Updating dispatch to ${target.current ?? 'the latest release'}` : status.latest ? `dispatch ${status.latest} is available` : 'The update did not finish'}</strong>
      <p>{updating ? progressText(progress, target.current) : `You have ${status.current}. Updating waits for working runs to finish, restarts dispatch and reloads this page; queued runs continue afterwards.`}</p>
      {failed && !updating && <p role="alert" className="error">{failed}</p>}
      {!updating && <div className="home-alert-actions">
        {status.latest && <IconButton label={failed ? 'Try the update again' : `Update to ${status.latest} and restart`} icon={failed ? RotateCw : Download} variant="outline" onClick={start}/>}
        <IconButton label="Remind me tomorrow" icon={BellOff} variant="ghost" onClick={dismiss}/>
      </div>}
    </div>
  </aside>;
}
