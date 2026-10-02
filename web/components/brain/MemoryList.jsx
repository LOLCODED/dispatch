import { BrainEntry } from '@/components/brain/BrainEntry';
import { ListControls, Pager, useListControls, usePage } from '@/components/ListControls';
import { kindLabels, kindOrder, matchesFilter } from '@/lib/brain.mjs';
import { byText, descending, filterSort, timeOf } from '@/lib/list-view.mjs';

const pageSize = 20;
const sorts = [
  { value: 'recent', label: 'Recently changed', compare: descending(entry => timeOf(entry.updatedAt)) },
  { value: 'used', label: 'Most used', compare: descending(entry => entry.uses || null) },
  { value: 'name', label: 'Name', compare: byText(entry => entry.label) },
];
const byKind = (a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);

export function MemoryList({ entries, brain, legend, resetKey }) {
  const controls = useListControls(sorts);
  const listed = filterSort(entries, { query: controls.query, matches: matchesFilter, compare: (a, b) => byKind(a, b) || controls.compare(a, b) });
  const paged = usePage(listed, pageSize, `${controls.query}|${controls.sort}|${resetKey}`);
  const groups = kindOrder.map(kind => ({ kind, items: paged.items.filter(entry => entry.kind === kind), total: listed.filter(entry => entry.kind === kind).length })).filter(group => group.items.length);
  return <div className="memory-list">
    <div className="memory-toolbar">{legend}<ListControls controls={controls} sorts={sorts} searchLabel="Search memories" placeholder="Search memories…"/></div>
    {groups.map(({ kind, items, total }) => <section key={kind} className={`panel memory-group kind-${kind}`} aria-label={kindLabels[kind]}>
      <h2><span aria-hidden="true"/>{kindLabels[kind]}<small>{total}</small></h2>
      <ul className="brain-list">{items.map(entry => <BrainEntry key={entry.id} entry={entry} busy={brain.busy} onToggle={brain.toggle} onMode={brain.mode} onForget={brain.forget}/>)}</ul>
    </section>)}
    {!listed.length && <p className="empty">Nothing matches the search.</p>}
    <Pager paged={paged} label="Memory pages"/>
  </div>;
}
