import { ListControls, Pager, useListControls, usePage } from '@/components/ListControls';
import { RiskDecision } from '@/components/run/RiskDecision';
import { Link } from '@/lib/workspace';
import { filterSort, textMatches } from '@/lib/list-view.mjs';

const sorts = [{ value: 'newest', label: 'Newest first', compare: (a, b) => b.createdAt.localeCompare(a.createdAt) }, { value: 'oldest', label: 'Oldest first', compare: (a, b) => a.createdAt.localeCompare(b.createdAt) }];
export function TestingDecisions({ decisions, projects }) {
  const controls = useListControls(sorts);
  const projectName = item => projects.find(project => project.id === item.projectId)?.name ?? item.projectId;
  const listed = filterSort(decisions, { query: controls.query, compare: controls.compare, matches: (item, query) => textMatches([item.title, projectName(item), item.level, item.reason, item.workflows, item.status, ...(item.checks ?? [])], query) });
  const paged = usePage(listed, 6, `${controls.query}|${controls.sort}`);
  return <section className="panel">
    <ListControls controls={controls} sorts={sorts} searchLabel="Search testing decisions" placeholder="Search repository, workflow or check…"/>
    <p className="muted">Historical decisions are tied to a revision. Change future policy in the repository’s Risk & tests settings.</p>
    {paged.items.length ? <ul className="row-list">{paged.items.map(item => <li key={`${item.runId}:${item.id}`}>
      <p><Link href={`/runs/${item.runId}`}>{item.title}</Link> · <Link href={`/admin/projects/${item.projectId}#risk`}>{projectName(item)}</Link> · {item.runStatus}</p>
      <p className="muted">{item.createdAt} · {item.used ? 'Used for validation' : 'Proposal history; not the current selection'}</p>
      <RiskDecision decision={item.level ? item : null} selection={item.status === 'fallback' ? item : null}/>
    </li>)}</ul> : <p className="empty">No testing decisions yet.</p>}
    <Pager paged={paged} label="Testing decision pages"/>
  </section>;
}
