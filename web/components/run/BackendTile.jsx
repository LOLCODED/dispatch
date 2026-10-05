import { useMemo, useState } from 'react';
import { ArrowLeftRight, Braces, Check, Copy, Database, FileSpreadsheet, GitPullRequest, LoaderCircle, ServerCog, Sheet, SquareTerminal } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { useRunSteps } from '@/lib/steps';
import { useFollowLatest } from '@/lib/follow-latest';
import { duration } from '@/lib/workspace';
import { backendEntries, backendFilters, curlCommand, gridAs, logLines } from '../../../src/backend-steps.mjs';

const kindIcons = { http: ArrowLeftRight, logs: ServerCog, sql: Database, ci: GitPullRequest };
const kindLabels = { sql: 'SQL', logs: 'Service', ci: 'CI' };

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
  const [tab, setTab] = useState('response'), { request, response } = entry.data;
  return <div className="backend-detail">
    <div className="backend-detail-bar">
      <div className="backend-tabs" role="tablist">{httpTabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
      <code className="backend-url" title={request.resolved}>{request.resolved}</code>
      <CopyButton id={`${entry.id}:body`} label="Copy response body" icon={Copy} text={response.body} copier={copier}/>
      <CopyButton id={`${entry.id}:curl`} label="Copy as curl" icon={SquareTerminal} text={curlCommand(entry.data)} copier={copier}/>
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

function SqlDetail({ entry, copier }) {
  const { data } = entry, rows = data.columns?.length > 0;
  return <div className="backend-detail">
    <div className="backend-detail-bar">
      <pre className="backend-query">{data.query}</pre>
      <CopyButton id={`${entry.id}:query`} label="Copy query" icon={Copy} text={data.query} copier={copier}/>
      {rows && <>
        <CopyButton id={`${entry.id}:tsv`} label="Copy for a spreadsheet" icon={Sheet} text={gridAs.tsv(data)} copier={copier}/>
        <CopyButton id={`${entry.id}:csv`} label="Copy as CSV" icon={FileSpreadsheet} text={gridAs.csv(data)} copier={copier}/>
        <CopyButton id={`${entry.id}:json`} label="Copy as JSON" icon={Braces} text={gridAs.json(data)} copier={copier}/>
      </>}
    </div>
    {data.error ? <pre className="backend-code backend-error">{data.error}</pre> : rows ? <SqlGrid data={data}/> : <p className="muted">The query returned no rows.</p>}
    {data.truncated && <p className="muted">Showing {data.rows.length} of {data.rowCount} rows; the agent saw them all.</p>}
  </div>;
}

function LogDetail({ entry, copier }) {
  const lines = useMemo(() => logLines(entry.output), [entry.output]);
  return <div className="backend-detail">
    <div className="backend-detail-bar"><span className="muted">{lines.length} line{lines.length === 1 ? '' : 's'}</span><CopyButton id={`${entry.id}:logs`} label="Copy log" icon={Copy} text={entry.output ?? ''} copier={copier}/></div>
    <div className="backend-log">{lines.map((line, index) => <div key={index} className={`backend-log-line level-${line.level ?? 'none'}`}>
      {line.time && <span className="backend-log-time">{line.time}</span>}{line.level && <span className="backend-log-level">{line.level}</span>}<span>{line.text}</span>{line.fields && <span className="backend-log-fields">{line.fields}</span>}
    </div>)}</div>
  </div>;
}

const checkTone = check => check.status !== 'completed' ? 'muted' : ['success', 'neutral', 'skipped'].includes(check.conclusion) ? 'ok' : 'bad';
function CiDetail({ entry }) {
  const logs = entry.output?.indexOf('### ') ?? -1;
  return <div className="backend-detail">
    <p className="muted">{entry.data.label} · {entry.data.sha.slice(0, 12)}</p>
    <ul className="backend-checks">{entry.data.checks.map((check, index) => <li key={index} className={`tone-${checkTone(check)}`}><span>{check.name || 'unnamed check'}</span><small>{check.conclusion ?? check.status}</small></li>)}</ul>
    {logs >= 0 && <pre className="backend-code">{entry.output.slice(logs)}</pre>}
  </div>;
}

function Badge({ entry }) {
  const { data } = entry;
  if (entry.pending) return <LoaderCircle size={13} className="backend-spin" aria-label="running"/>;
  if (entry.kind === 'http' && data) return <span className={`backend-pill tone-${statusTone(data.response.status)}`}>{data.response.status}</span>;
  if (entry.kind === 'sql' && data) return <span className={`backend-pill tone-${data.error ? 'bad' : 'muted'}`}>{data.error ? 'error' : `${data.rowCount} row${data.rowCount === 1 ? '' : 's'}`}</span>;
  if (entry.kind === 'ci' && data) return <span className={`backend-pill tone-${data.state === 'success' ? 'ok' : data.state === 'failure' ? 'bad' : 'muted'}`}>{data.state}</span>;
  return entry.isError ? <span className="backend-pill tone-bad">error</span> : null;
}

function Title({ entry }) {
  const Icon = kindIcons[entry.kind];
  if (entry.kind !== 'http') return <><Icon size={13} className="backend-kind-icon" aria-hidden="true"/><span className="backend-kind">{kindLabels[entry.kind]}</span><code className="backend-title">{entry.title}</code></>;
  const [method, ...rest] = entry.title.split(' ');
  return <><Icon size={13} className="backend-kind-icon" aria-hidden="true"/><span className={`backend-kind method-${method.toLowerCase()}`}>{method}</span><code className="backend-title">{rest.join(' ').replace(/^app:/, '')}</code></>;
}

const details = { http: HttpDetail, sql: SqlDetail, logs: LogDetail, ci: CiDetail };
function EntryRow({ entry, open, onToggle, copier }) {
  const Detail = details[entry.kind], structured = !entry.pending && (entry.kind === 'logs' || entry.data);
  return <div className={`backend-entry kind-${entry.kind}${open ? ' is-open' : ''}`}>
    <button type="button" className="backend-row" aria-expanded={open} onClick={onToggle}>
      <Title entry={entry}/><Badge entry={entry}/><small className="backend-duration">{entry.pending ? '' : duration(entry.durationMs)}</small>
    </button>
    {open && (structured ? <Detail entry={entry} copier={copier}/> : <pre className="backend-code">{entry.output ?? 'Waiting for the result…'}</pre>)}
  </div>;
}

export function BackendTile({ run }) {
  const { steps, error } = useRunSteps(run.id, run.stepCount ?? 0), [only, setOnly] = useState(null), [opened, setOpened] = useState(() => new Set()), copier = useCopy();
  const entries = useMemo(() => backendEntries(steps), [steps]), counts = useMemo(() => Object.groupBy(entries, entry => entry.kind), [entries]);
  const shown = only ? entries.filter(entry => entry.kind === only) : entries, list = useFollowLatest(shown.length);
  const toggle = id => setOpened(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  return <div className="timeline-tile backend-tile">
    <div className="timeline-toolbar"><span className="timeline-filters">{backendFilters.filter(([kind]) => counts[kind]).map(([kind, label]) => <IconButton key={kind} label={`${label} only`} icon={kindIcons[kind]} aria-pressed={only === kind} onClick={() => setOnly(only === kind ? null : kind)}/>)}</span></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div ref={list.ref} className="timeline-feed" onScroll={list.onScroll}>{shown.length ? shown.map(entry => <EntryRow key={entry.id} entry={entry} open={opened.has(entry.id)} onToggle={() => toggle(entry.id)} copier={copier}/>) : <p className="muted">HTTP calls, service logs, SQL results and CI reads appear here as the agent makes them.</p>}</div>
  </div>;
}
