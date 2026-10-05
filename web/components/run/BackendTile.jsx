import { useMemo, useState } from 'react';
import { ArrowLeftRight, Braces, Check, Copy, FileText, ListChecks, LoaderCircle, ScrollText, Sheet, FileSpreadsheet, SquareTerminal, Table2 } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { useRunSteps } from '@/lib/steps';
import { useFollowLatest } from '@/lib/follow-latest';
import { duration } from '@/lib/workspace';
import { backendEntries, curlCommand, gridAs, logLines } from '../../../src/backend-steps.mjs';

const typeIcons = { http: ArrowLeftRight, log: ScrollText, table: Table2, checks: ListChecks, text: FileText };

function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = async (key, text) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(current => current === key ? null : current), 1500); } catch { /* Clipboard can be unavailable; the text stays selectable. */ } };
  return { copied, copy };
}

function CopyButton({ id, label, icon, text, copier }) {
  return <IconButton label={copier.copied === id ? 'Copied' : label} icon={copier.copied === id ? Check : icon} onClick={() => copier.copy(id, text)}/>;
}

const tones = { 2: 'ok', 3: 'muted', 4: 'warn', 5: 'bad' };
const statusTone = status => tones[String(status)[0]] ?? 'muted';

const jsonToken = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
function JsonText({ text }) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(jsonToken)) {
    parts.push(text.slice(last, match.index));
    const kind = match[2] ? 'property' : match[1] ? 'string' : match[3] ? 'keyword' : 'number';
    parts.push(<span key={match.index} className={`syntax-${kind}`}>{match[1] ?? match[0]}</span>, match[2] ?? '');
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return <pre className="backend-code">{parts}</pre>;
}

function Body({ text, contentType }) {
  if (!text) return <p className="muted">Empty body.</p>;
  if (/json/.test(contentType ?? '') || /^\s*[[{]/.test(text)) {
    try { return <JsonText text={JSON.stringify(JSON.parse(text), null, 2)}/>; } catch { /* Not valid JSON after all; show it as sent. */ }
  }
  return <pre className="backend-code">{text}</pre>;
}

function Headers({ headers }) {
  const entries = Object.entries(headers ?? {});
  return entries.length ? <dl className="backend-headers">{entries.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl> : <p className="muted">No headers.</p>;
}

const httpTabs = [['response', 'Response'], ['headers', 'Headers'], ['request', 'Request']];
function HttpDetail({ entry, copier }) {
  const [tab, setTab] = useState('response'), { request, response } = entry.view;
  return <div className="backend-detail">
    <div className="backend-detail-bar">
      <div className="backend-tabs" role="tablist">{httpTabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
      <code className="backend-url" title={request.resolved}>{request.resolved}</code>
      <CopyButton id={`${entry.id}:body`} label="Copy response body" icon={Copy} text={response.body} copier={copier}/>
      <CopyButton id={`${entry.id}:curl`} label="Copy as curl" icon={SquareTerminal} text={curlCommand(entry.view)} copier={copier}/>
    </div>
    {tab === 'response' && <><Body text={response.body} contentType={response.headers['content-type']}/>{response.bodyLength > response.body.length && <p className="muted">Showing the first {response.body.length.toLocaleString()} of {response.bodyLength.toLocaleString()} characters.</p>}</>}
    {tab === 'headers' && <Headers headers={response.headers}/>}
    {tab === 'request' && <><Headers headers={request.headers}/>{request.body && <Body text={request.body} contentType={request.headers['content-type'] ?? request.headers['Content-Type']}/>}</>}
  </div>;
}

const numeric = /^-?\d+(\.\d+)?$/;
function SqlGrid({ data }) {
  const numericColumns = useMemo(() => data.columns.map((_, index) => data.rows.length > 0 && data.rows.every(row => row[index] === null || numeric.test(row[index]))), [data]);
  return <div className="backend-grid-scroll">
    <table className="backend-grid">
      <thead><tr><th aria-label="Row"/>{data.columns.map((column, index) => <th key={index} className={numericColumns[index] ? 'is-number' : undefined}>{column}</th>)}</tr></thead>
      <tbody>{data.rows.map((row, rowIndex) => <tr key={rowIndex}><td className="backend-row-number">{rowIndex + 1}</td>{row.map((cell, index) => <td key={index} className={cell === null ? 'is-null' : numericColumns[index] ? 'is-number' : undefined}>{cell ?? 'NULL'}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function TableDetail({ entry, copier }) {
  const data = entry.view, rows = data.columns?.length > 0;
  return <div className="backend-detail">
    <div className="backend-detail-bar">
      {data.query ? <><pre className="backend-query">{data.query}</pre><CopyButton id={`${entry.id}:query`} label="Copy query" icon={Copy} text={data.query} copier={copier}/></> : <span className="backend-spacer"/>}
      {rows && <>
        <CopyButton id={`${entry.id}:tsv`} label="Copy for a spreadsheet" icon={Sheet} text={gridAs.tsv(data)} copier={copier}/>
        <CopyButton id={`${entry.id}:csv`} label="Copy as CSV" icon={FileSpreadsheet} text={gridAs.csv(data)} copier={copier}/>
        <CopyButton id={`${entry.id}:json`} label="Copy as JSON" icon={Braces} text={gridAs.json(data)} copier={copier}/>
      </>}
    </div>
    {data.error ? <pre className="backend-code backend-error">{data.error}</pre> : rows ? <SqlGrid data={data}/> : <p className="muted">No rows.</p>}
    {data.truncated && <p className="muted">Showing {data.rows.length} of {data.rowCount} rows; the agent saw them all.</p>}
  </div>;
}

function LogDetail({ entry, copier }) {
  const source = entry.view?.text ?? entry.output, lines = useMemo(() => logLines(source), [source]);
  return <div className="backend-detail">
    <div className="backend-detail-bar"><span className="muted">{lines.length} line{lines.length === 1 ? '' : 's'}</span><CopyButton id={`${entry.id}:logs`} label="Copy log" icon={Copy} text={source ?? ''} copier={copier}/></div>
    <div className="backend-log">{lines.map((line, index) => <div key={index} className={`backend-log-line level-${line.level ?? 'none'}`}>
      {line.time && <span className="backend-log-time">{line.time}</span>}{line.level && <span className="backend-log-level">{line.level}</span>}<span>{line.text}</span>{line.fields && <span className="backend-log-fields">{line.fields}</span>}
    </div>)}</div>
  </div>;
}

function ChecksDetail({ entry }) {
  const { items, detail } = entry.view;
  return <div className="backend-detail">
    <ul className="backend-checks">{items.map((item, index) => <li key={index} className={`tone-${item.state}`}><span>{item.name}</span><small>{item.detail}</small></li>)}</ul>
    {detail && <pre className="backend-code">{detail}</pre>}
  </div>;
}

function TextDetail({ entry, copier }) {
  const { text, format } = entry.view;
  return <div className="backend-detail">
    <div className="backend-detail-bar"><span className="backend-spacer"/><CopyButton id={`${entry.id}:text`} label="Copy" icon={Copy} text={text} copier={copier}/></div>
    {format === 'json' ? <Body text={text} contentType="application/json"/> : <pre className="backend-code">{text}</pre>}
  </div>;
}

const checkSummary = items => items.some(item => item.state === 'bad') ? 'bad' : items.some(item => item.state === 'pending') ? 'pending' : items.length ? 'ok' : 'muted';
function Badge({ entry }) {
  const { view } = entry;
  if (entry.pending) return <LoaderCircle size={13} className="backend-spin" aria-label="running"/>;
  if (view?.error || (entry.isError && !view)) return <span className="backend-pill tone-bad">error</span>;
  if (view?.type === 'http') return <span className={`backend-pill tone-${statusTone(view.response.status)}`}>{view.response.status}</span>;
  if (view?.type === 'table') return <span className="backend-pill tone-muted">{view.rowCount} row{view.rowCount === 1 ? '' : 's'}</span>;
  if (view?.type === 'checks') { const tone = checkSummary(view.items); return <span className={`backend-pill tone-${tone === 'pending' ? 'muted' : tone}`}>{{ ok: 'passing', bad: 'failing', pending: 'running', muted: 'no checks' }[tone]}</span>; }
  return null;
}

function Title({ entry }) {
  const Icon = typeIcons[entry.type] ?? FileText;
  if (entry.type !== 'http' || entry.label !== 'HTTP') return <><Icon size={13} className="backend-kind-icon" aria-hidden="true"/><span className="backend-kind">{entry.label}</span><code className="backend-title">{entry.title}</code></>;
  const [method, ...rest] = entry.title.split(' ');
  return <><Icon size={13} className="backend-kind-icon" aria-hidden="true"/><span className={`backend-kind method-${method.toLowerCase()}`}>{method}</span><code className="backend-title">{rest.join(' ').replace(/^app:/, '')}</code></>;
}

const details = { http: HttpDetail, table: TableDetail, log: LogDetail, checks: ChecksDetail, text: TextDetail };
function EntryRow({ entry, open, onToggle, copier }) {
  const Detail = details[entry.type], structured = !entry.pending && (entry.view || entry.type === 'log');
  return <div className={`backend-entry type-${entry.type}${open ? ' is-open' : ''}`}>
    <button type="button" className="backend-row" aria-expanded={open} onClick={onToggle}>
      <Title entry={entry}/><Badge entry={entry}/><small className="backend-duration">{entry.pending ? '' : duration(entry.durationMs)}</small>
    </button>
    {open && (structured ? (entry.view?.error ? <pre className="backend-code backend-error">{entry.view.error}</pre> : <Detail entry={entry} copier={copier}/>) : <pre className="backend-code">{entry.output ?? 'Waiting for the result…'}</pre>)}
  </div>;
}

export function BackendTile({ run }) {
  const { steps, error } = useRunSteps(run.id, run.stepCount ?? 0), [only, setOnly] = useState(null), [opened, setOpened] = useState(() => new Set()), copier = useCopy();
  const entries = useMemo(() => backendEntries(steps), [steps]), labels = useMemo(() => [...new Map(entries.map(entry => [entry.label, entry.type])).entries()], [entries]);
  const shown = only ? entries.filter(entry => entry.label === only) : entries, list = useFollowLatest(shown.length);
  const toggle = id => setOpened(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  return <div className="timeline-tile backend-tile">
    <div className="timeline-toolbar"><span className="timeline-filters">{labels.length > 1 && labels.map(([label, type]) => <IconButton key={label} label={`${label} only`} icon={typeIcons[type] ?? FileText} aria-pressed={only === label} onClick={() => setOnly(only === label ? null : label)}/>)}</span></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div ref={list.ref} className="timeline-feed" onScroll={list.onScroll}>{shown.length ? shown.map(entry => <EntryRow key={entry.id} entry={entry} open={opened.has(entry.id)} onToggle={() => toggle(entry.id)} copier={copier}/>) : <p className="muted">HTTP calls, logs, query results and checks appear here as the agent makes them, from dispatch's tools and from connectors.</p>}</div>
  </div>;
}
