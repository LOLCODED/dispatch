import { Activity, FileCode2, FlaskConical, Image, Terminal, Wrench } from 'lucide-react';
import { Link } from '@/lib/workspace';
import { EvidenceGroup } from '@/components/run/Artifacts';
import { groupEvidence } from '@/lib/evidence.mjs';
import { agentName } from '@/lib/providers.mjs';
import { parseBlockedQuestion } from '@/lib/question.mjs';
import { splitRemaining } from '../../src/remaining.mjs';
import { heldReplies } from '@/lib/held-reply.mjs';
import { activeStatuses } from '@/lib/board.mjs';
import { Markdown } from '@/components/Markdown';

const attachmentSources = new Set(['context', 'context-file']), messageOrigins = new Set(['Ticket', 'Follow-up']);
const isMessageAttachment = artifact => attachmentSources.has(artifact.source) && messageOrigins.has(artifact.check);

function entries(run) {
  const held = heldReplies(run);
  return [
    ...run.events.filter(event => event.kind !== 'raw' && !held.has(event.id)).map(event => ({ ...event, type: 'event' })),
    ...run.checks.map((check, index) => ({ id: `check-${index}`, at: check.startedAt, type: 'check', check })),
    ...run.artifacts.filter(artifact => !isMessageAttachment(artifact)).map(artifact => ({ id: artifact.id, at: artifact.capturedAt, type: 'artifact', artifact })),
  ].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
}

function bundles(run) {
  const result = [];
  for (const entry of entries(run)) {
    if (entry.type === 'event' && entry.kind === 'message') result.push({ type: 'message', entry });
    else {
      if (result.at(-1)?.type !== 'activity') result.push({ type: 'activity', entries: [] });
      result.at(-1).entries.push(entry);
    }
  }
  for (const bundle of result) if (bundle.type === 'activity') bundle.entries = groupEvidence(bundle.entries);
  return result;
}

function chainOf(run, runs) {
  const chain = [run], seen = new Set([run.id]);
  let previous = run.previousRunId;
  while (previous && !seen.has(previous)) {
    const item = runs.find(candidate => candidate.id === previous && candidate.mode === 'live');
    if (!item) break;
    chain.unshift(item); seen.add(item.id); previous = item.previousRunId;
  }
  return { chain, earlier: previous };
}

const toolLabels = { tool: ['Tool call', Wrench], files: ['File changes', FileCode2], setup: ['Setup', Terminal] };

function Time({ at }) { return at ? <time>{new Date(at).toLocaleTimeString()}</time> : null; }

function ActivityEntry({ entry, runId, onOpenArtifact }) {
  if (entry.type === 'check') return <div className={`history-check check-${entry.check.status}`}>
    <span className="entry-label"><FlaskConical size={12} aria-hidden="true"/>Mandatory check<Time at={entry.at}/></span>
    <p><strong>{entry.check.name}</strong> · attempt {entry.check.attempt} · <span className="check-status">{entry.check.status}</span></p>
    <small>Revision {entry.check.revision?.slice(0, 12) ?? 'unavailable'}</small>
    <details><summary>Command and output</summary><pre>{JSON.stringify(entry.check.command)}{'\n\n'}{entry.check.output ?? 'Running…'}</pre></details>
  </div>;
  if (entry.type === 'evidence') {
    const [{ check, attempt, source }] = entry.artifacts, count = entry.artifacts.length;
    const label = source === 'context' ? 'Pasted with the ticket' : `Browser evidence · ${check ?? 'evidence'} · attempt ${attempt ?? 1}`;
    return <div className="history-artifact"><span className="entry-label"><Image size={12} aria-hidden="true"/>{label} · {count} {count === 1 ? 'file' : 'files'}<Time at={entry.at}/></span><EvidenceGroup runId={runId} artifacts={entry.artifacts} onOpen={onOpenArtifact}/></div>;
  }
  const [label, Icon] = toolLabels[entry.kind] ?? ['Activity', Activity];
  if (toolLabels[entry.kind]) return <details className={`history-tool ${entry.kind}`}><summary><span><Icon size={12} aria-hidden="true"/>{label}</span><span>{entry.message.split('\n')[0].slice(0, 130)}</span></summary><pre>{entry.message}</pre></details>;
  return <p className="activity-message"><Activity size={12} aria-hidden="true"/><span>{entry.message}</span><Time at={entry.at}/></p>;
}

const blockedMarker = /^DISPATCH_BLOCKED:\s*/m, answeredMarker = /^\s*DISPATCH_(?:ANSWERED|PLAN)\s*$/m;

function AgentMessage({ agent, text: raw, className = 'message assistant-message' }) {
  const text = raw.replace(answeredMarker, '').trim(), marker = text.search(blockedMarker), remaining = splitRemaining(marker < 0 ? text : text.slice(0, marker).trim());
  return <>
    {remaining.before && <article className={className}><span className="message-author">{agent}</span><Markdown>{remaining.before}</Markdown></article>}
    {remaining.items.length > 0 && <article className="agent-question" aria-label="Not built yet"><span className="question-eyebrow">Not built yet</span><ul>{remaining.items.map((item, index) => <li key={index}>{item}</li>)}</ul></article>}
    {remaining.after && <article className={className}><Markdown>{remaining.after}</Markdown></article>}
    {marker >= 0 && <article className="agent-question" aria-label="Agent question"><span className="question-eyebrow">{agent} needs your call</span><p>{parseBlockedQuestion(text.slice(marker).replace(blockedMarker, '')).question}</p></article>}
  </>;
}

function Turn({ cycle, index, current, single, onOpenArtifact, activity }) {
  const attachments = cycle.artifacts.filter(isMessageAttachment);
  return <section className="history-turn" id={`turn-${cycle.id}`} aria-label={`Turn ${index + 1}`}>
    {!single && <div className="turn-heading"><h3>Turn {index + 1}{!current && ' · Historical evidence'}</h3>{!current && <Link href={`/runs/${cycle.id}`}>Open run</Link>}</div>}
    <div className="message operator"><span className="message-author">You<time>{new Date(cycle.createdAt).toLocaleString()}</time></span><p>{cycle.input}</p>{attachments.length > 0 && <EvidenceGroup runId={cycle.id} artifacts={attachments} onOpen={onOpenArtifact}/>}</div>
    <div className="timeline">{bundles(cycle).filter(bundle => activity || bundle.type === 'message').map((bundle, position) => bundle.type === 'message'
      ? <AgentMessage key={bundle.entry.id} agent={agentName(cycle)} text={bundle.entry.message}/>
      : <details className="activity-bundle" key={position}><summary>Activity · {bundle.entries.length} {bundle.entries.length === 1 ? 'update' : 'updates'}</summary><div>{bundle.entries.map(entry => <ActivityEntry key={entry.id} entry={entry} runId={cycle.id} onOpenArtifact={onOpenArtifact}/>)}</div></details>)}</div>
    {cycle.summary && !activeStatuses.has(cycle.status) && !cycle.events.some(event => event.kind === 'message' && event.message === cycle.summary) && <AgentMessage agent={agentName(cycle)} text={cycle.summary} className="result-summary"/>}
  </section>;
}

export function RunHistory({ run, runs, onOpenArtifact, activity = true }) {
  const { chain, earlier } = chainOf(run, runs);
  return <div className="living-history" aria-label="Conversation history">
    {earlier && <Link href={`/runs/${earlier}`}>Open earlier history</Link>}
    {chain.map((cycle, index) => <Turn key={cycle.id} cycle={cycle} index={index} current={cycle.id === run.id} single={chain.length === 1} onOpenArtifact={onOpenArtifact} activity={activity}/>)}
  </div>;
}
