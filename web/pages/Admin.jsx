import { useEffect, useState } from 'react';
import { ChartNoAxesCombined, History } from 'lucide-react';
import { SettingsLayout } from '@/components/SettingsLayout';
import { SettingsTabs } from '@/components/SettingsTabs';
import { StatusIcon } from '@/components/StatusIcon';
import { Select } from '@/components/Select';
import { ProviderUsage } from '@/components/ProviderUsage';
import { ListControls, Pager, useFittedPageSize, useListControls, usePage } from '@/components/ListControls';
import { descending, filterSort, textMatches, timeOf } from '@/lib/list-view.mjs';
import { api, Link, useWorkspace, Metric, duration, count } from '@/lib/workspace';

function useInsights() {
  const [insights, setInsights] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let stopped = false, timer;
    const controller = new AbortController();
    const refresh = async () => {
      try { setInsights(await api('/api/analytics', undefined, controller.signal)); setError(''); }
      catch { if (!stopped) setError('Run insights are temporarily unavailable.'); }
      finally { if (!stopped) timer = setTimeout(refresh, 5000); }
    };
    refresh();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, []);
  return { insights, error };
}

const historyPageSize = 25;
const historySorts = [
  { value: 'newest', label: 'Newest', compare: descending(record => timeOf(record.createdAt)) },
  { value: 'longest', label: 'Longest', compare: descending(record => record.executionMs) },
  { value: 'tokens', label: 'Most tokens', compare: descending(record => record.tokens.total) },
];
const recordMatches = (record, query) => textMatches([record.title, record.project], query);

function RunHistoryList({ insights, labels, board }) {
  const doneRuns = new Set(Object.values(board?.items ?? {}).map(item => item.done?.runId).filter(Boolean));
  const [filter, setFilter] = useState(''), controls = useListControls(historySorts);
  const projects = [...new Set(insights?.records.map(record => record.project) ?? [])];
  const records = filterSort((insights?.records ?? []).filter(record => !filter || record.project === filter), { query: controls.query, matches: recordMatches, compare: controls.compare });
  const [listRef, pageSize] = useFittedPageSize(historyPageSize, records.length > 0);
  const paged = usePage(records, pageSize, `${filter}|${controls.query}|${controls.sort}`);
  return <section className="panel history-panel">
    <div className="section-heading"><h2>Run history</h2><div className="history-filters"><ListControls controls={controls} sorts={historySorts} searchLabel="Search runs" placeholder="Search runs…"/><label className="sr-only" htmlFor="history-project">Filter history by repository</label><Select id="history-project" value={filter} onChange={event => setFilter(event.target.value)}><option value="">All repositories</option>{projects.map(project => <option key={project}>{project}</option>)}</Select></div></div>
    <ul ref={listRef} id="admin-history" className="history-list fit-list">{paged.items.map(run => <li key={run.id} className="history-row">
      <StatusIcon run={run} done={doneRuns.has(run.id)} size={13}/>
      <span className="history-title"><Link href={`/runs/${run.id}`}>{run.title}</Link><small>{run.project} · {labels[run.status] ?? run.status}</small></span>
      <span className="history-stats"><span title="Duration">{duration(run.executionMs)}</span><span title="Tokens">{count(run.tokens.total)} tokens</span>{run.repairs > 0 && <span title="Repair attempts">{run.repairs} repairs</span>}</span>
    </li>)}</ul>
    <Pager paged={paged} label="History pages"/>
    {insights?.totalRuns > 0 && !records.length && <p className="muted">Nothing matches the search.</p>}
    {insights?.totalRuns === 0 && <p className="muted">No live runs yet.</p>}
  </section>;
}

export function Admin() {
  const { state } = useWorkspace(), { insights, error } = useInsights();
  return <SettingsLayout title="Usage" description="Token reports and how your runs went.">
    <SettingsTabs label="Usage sections" tabs={[
      { value: 'overview', label: 'Overview', icon: ChartNoAxesCombined, content: <>
        <div id="admin-metrics" className="metrics-grid">
          <Metric label="Runs completed" value={insights ? `${insights.completedRuns} / ${insights.totalRuns}` : '—'}/>
          <Metric label="Average completion" value={duration(insights?.averageCompletionMs)} note="Time working on completed runs"/>
          <Metric label="Reported tokens" value={count(insights?.tokens.reportedTotal)} note={`${insights?.tokens.unknownRuns ?? 0} runs with unreported usage`}/>
          <Metric label="Active now" value={insights?.activeRuns ?? '—'}/>
        </div>
        <ProviderUsage totals={insights?.providers}/>
      </> },
      { value: 'history', label: 'History', icon: History, count: insights?.totalRuns, content: <RunHistoryList insights={insights} labels={state.labels} board={state.board}/> },
    ]}/>
    {error && <p className="error" role="alert">{error}</p>}
    <p className="muted">Cached input is included in input tokens. Subscription usage cannot be converted to an exact dollar cost.</p>
  </SettingsLayout>;
}
