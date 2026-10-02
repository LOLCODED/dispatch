import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { providerName } from '@/lib/providers.mjs';
import { dismissUntil, nearLimitWindows, usageAlertKey } from '@/lib/usage-alert.mjs';
import { api, Link, preference, savePreference, useWorkspace } from '@/lib/workspace';

const dismissalKey = 'dispatch-usage-alert-dismissed';
const pollMs = 10 * 60 * 1000;

function useProviderLimitsPoll(enabled) {
  const [limits, setLimits] = useState(null);
  useEffect(() => {
    if (!enabled) { setLimits(null); return; }
    let readAt = 0, controller;
    const read = () => {
      if (document.hidden || Date.now() - readAt < pollMs) return;
      readAt = Date.now(); controller?.abort(); controller = new AbortController();
      api('/api/provider-limits', undefined, controller.signal).then(setLimits).catch(() => {});
    };
    read();
    const timer = setInterval(read, pollMs);
    document.addEventListener('visibilitychange', read);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', read); controller?.abort(); };
  }, [enabled]);
  return limits;
}

function savedDismissal() {
  try { return JSON.parse(preference(dismissalKey, '{}')); } catch { return {}; }
}

const windowText = window => `${providerName(window.providerId)} ${window.label.toLowerCase()} limit is ${window.usedPercent}% used`;

export function UsageAlert() {
  const { state } = useWorkspace();
  const providerIds = Object.keys(state.providerSettings ?? {}).filter(id => state.providerSettings[id] === true).sort();
  const limits = useProviderLimitsPoll(providerIds.join(','));
  const [dismissal, setDismissal] = useState(savedDismissal);
  const windows = nearLimitWindows(limits, providerIds), key = usageAlertKey(windows);
  if (!windows.length || (dismissal.key === key && dismissal.until > Date.now())) return null;
  const dismiss = () => {
    const next = { key, until: dismissUntil(windows) };
    savePreference(dismissalKey, JSON.stringify(next)); setDismissal(next);
  };
  const full = windows.some(window => window.usedPercent >= 100);
  return <aside className="home-alert" aria-label="Plan usage alert">
    <Gauge size={18} aria-hidden="true"/>
    <div><strong>{full ? 'A plan limit is used up' : 'A plan limit is almost used up'}</strong><p>{windows.map(windowText).join('. ')}. New runs on that provider may stop until it resets.</p>
      <div className="home-alert-actions"><Button asChild variant="outline" size="sm"><Link href="/admin">Review usage</Link></Button><Button type="button" variant="ghost" size="sm" onClick={dismiss}>Remind me after reset</Button></div>
    </div>
  </aside>;
}
