import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { providers } from '@/lib/providers.mjs';
import { api, count, useWorkspace } from '@/lib/workspace';

const resetText = at => at ? `Resets ${new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Reset time not reported';

function LimitWindow({ window }) {
  const used = window.usedPercent;
  return <div className="limit-window">
    <div className="limit-heading"><span>{window.label}</span><strong>{used == null ? '—' : `${used}% used`}</strong></div>
    <div className="limit-bar" role="meter" aria-label={`${window.label} limit used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used ?? 0}><span style={{ width: `${used ?? 0}%` }} data-level={used >= 90 ? 'high' : used >= 70 ? 'medium' : 'low'}/></div>
    <small>{window.resetsText ?? resetText(window.resetsAt)}</small>
  </div>;
}

const expectedWindows = { codex: 2, claude: 3 };

function LimitsSkeleton({ windows }) {
  return <div className="limit-windows" role="status" aria-label="Reading plan usage">
    {Array.from({ length: windows }, (_, index) => <div key={index} className="limit-window" aria-hidden="true">
      <div className="limit-heading"><span className="skeleton" style={{ width: '40%' }}/><span className="skeleton" style={{ width: '18%' }}/></div>
      <span className="skeleton limit-bar"/>
      <span className="skeleton" style={{ width: '55%' }}/>
    </div>)}
  </div>;
}

function PlanLimits({ providerId, limits, loading }) {
  if (!limits && loading) return <LimitsSkeleton windows={expectedWindows[providerId] ?? 2}/>;
  if (!limits) return <p className="muted">No plan usage reported yet.</p>;
  if (!limits.available) return <p className="muted">{limits.message}</p>;
  return <>
    <div className="limit-windows">{limits.windows.map(window => <LimitWindow key={window.label} window={window}/>)}</div>
    <small className="muted">{limits.source === 'observed' ? `${limits.message} Seen ${new Date(limits.observedAt).toLocaleString()}.` : limits.message}</small>
  </>;
}

function ProviderTokens({ totals }) {
  if (!totals?.runs) return <p className="muted">No runs yet.</p>;
  return <dl className="provider-tokens">
    <div><dt>Runs</dt><dd>{count(totals.runs)}</dd></div>
    <div><dt>Input tokens</dt><dd>{count(totals.input)}</dd></div>
    <div><dt>Cached input</dt><dd>{count(totals.cachedInput)}</dd></div>
    <div><dt>Output tokens</dt><dd>{count(totals.output)}</dd></div>
    {totals.reportedRuns < totals.runs && <div><dt>Unreported</dt><dd>{totals.runs - totals.reportedRuns} runs</dd></div>}
  </dl>;
}

function useProviderLimits() {
  const [limits, setLimits] = useState(null), [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setLimits(await api('/api/provider-limits')); } catch { setLimits({}); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { limits, loading, refresh };
}

export function ProviderUsage({ totals }) {
  const { state } = useWorkspace(), { limits, loading, refresh } = useProviderLimits();
  const enabled = providers.filter(provider => state.providerSettings?.[provider.id] === true);
  return <section className="panel"><div className="section-heading"><h2>Providers</h2><IconButton label="Refresh plan usage" icon={RefreshCw} disabled={loading} onClick={refresh}/></div>
    {!enabled.length && <p className="muted">No provider is on. Turn one on in Settings → General.</p>}
    <div className="provider-list">{enabled.map(provider => <article key={provider.id} className="provider-usage" aria-label={`${provider.name} usage`}>
      <h3>{provider.name}{limits?.[provider.id]?.plan && <span className="provider-plan">{limits[provider.id].plan}</span>}</h3>
      <PlanLimits providerId={provider.id} limits={limits?.[provider.id]} loading={loading}/>
      <ProviderTokens totals={totals?.[provider.id]}/>
    </article>)}</div>
    <p className="muted">Plan limits come from each CLI. Token totals are what dispatch runs reported.</p>
  </section>;
}
