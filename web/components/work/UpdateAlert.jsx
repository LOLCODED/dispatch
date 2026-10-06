import { useEffect, useState } from 'react';
import { BellOff, Check, Copy, Download } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { api, preference, savePreference } from '@/lib/workspace';
import { useCopied } from '@/lib/use-copied';

const dismissalKey = 'dispatch-update-alert-dismissed-until', command = 'dispatch update', day = 24 * 60 * 60 * 1000;

export function UpdateAlert() {
  const [status, setStatus] = useState(null), [dismissedUntil, setDismissedUntil] = useState(() => Number(preference(dismissalKey, '0'))), [copied, copy] = useCopied();
  useEffect(() => {
    api('/api/update').then(found => found.installed && !found.checkedAt ? api('/api/update/check', {}) : found).then(setStatus, () => {});
  }, []);
  if (!status?.latest || dismissedUntil > Date.now()) return null;
  const dismiss = () => { const until = Date.now() + day; savePreference(dismissalKey, String(until)); setDismissedUntil(until); };
  return <aside className="home-alert" aria-label="Update alert">
    <Download size={18} aria-hidden="true"/>
    <div><strong>dispatch {status.latest} is available</strong>
      <p>You have {status.current}. Run <code>{command}</code> in a terminal: it waits for working runs to finish, then installs and restarts dispatch; queued runs continue afterwards.</p>
      <div className="home-alert-actions">
        <IconButton label={copied ? 'Copied' : `Copy ${command}`} icon={copied ? Check : Copy} variant="outline" onClick={() => copy(command)}/>
        <IconButton label="Remind me tomorrow" icon={BellOff} variant="ghost" onClick={dismiss}/>
      </div>
    </div>
  </aside>;
}
