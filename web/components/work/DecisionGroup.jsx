import { useState } from 'react';
import { ArrowUpRight, Check, GitPullRequest, Play, Reply, Send } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/IconButton';
import { LandingMark } from '@/components/work/LandingMark';
import { StateDot } from '@/components/work/StateDot';
import { askOf, recommendedFirst } from '@/lib/board.mjs';
import { useBoardAction } from '@/lib/board-actions';
import { Link } from '@/lib/workspace';

function answerRequest(latest, ask, value, action) {
  if (action) return [`/api/runs/${latest.id}/remaining`, { action }];
  if (ask.kind === 'request') return [`/api/runs/${latest.id}/respond`, { requestId: ask.requestId, answers: { [ask.questionId]: value } }];
  return [`/api/runs/${latest.id}/followup`, { input: value }];
}

function optionRequest(latest, ask, option) {
  if (option.reason) return [`/api/runs/${latest.id}/delivery/repair`, { reason: option.reason }];
  return answerRequest(latest, ask, option.value, option.action);
}

function ActionChip({ label, icon: Icon, className = '', ...props }) {
  return <Tooltip label={label}><button type="button" className={`answer-chip is-icon ${className}`} aria-label={label} {...props}><Icon size={13} aria-hidden="true"/></button></Tooltip>;
}

function ReplyBox({ title, busy, onSend, onClose }) {
  const [text, setText] = useState('');
  const key = event => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Enter' && text.trim()) { event.preventDefault(); onSend(text.trim()); }
  };
  return <div className="reply-box">
    <Input autoFocus value={text} disabled={busy} maxLength={4000} onChange={event => setText(event.target.value)} onKeyDown={key} placeholder="Tell the agent…" aria-label={`Reply to ${title}`}/>
    <ActionChip label="Send" icon={Send} disabled={busy || !text.trim()} onClick={() => onSend(text.trim())}/>
  </div>;
}

const replyable = (ask, latest) => ask.kind === 'request' || ['followup', 'delivery'].includes(ask.kind) && latest.resumable;

function DecisionActions({ entry, ask, busy, send, onReply }) {
  const { key, latest, state } = entry;
  if (state === 'paused') return <ActionChip label="Resume" icon={Play} className="is-recommended" disabled={busy} onClick={() => send(`/api/board/items/${key}/resume`)}/>;
  const pullRequest = ask.url && <Tooltip label="Open pull request"><a className="answer-chip is-icon" href={ask.url} target="_blank" rel="noreferrer" aria-label="Open pull request"><GitPullRequest size={13} aria-hidden="true"/></a></Tooltip>;
  if (!replyable(ask, latest)) return <>{pullRequest}<Tooltip label="Open"><Link className="answer-chip is-icon" href={`/runs/${latest.id}`} aria-label="Open"><ArrowUpRight size={13} aria-hidden="true"/></Link></Tooltip></>;
  return <>
    {recommendedFirst(ask.options).map(option => <button type="button" key={option.label} className={`answer-chip ${option.recommended ? 'is-recommended' : ''}`} disabled={busy} onClick={() => send(...optionRequest(latest, ask, option))}>{option.label}</button>)}
    {pullRequest}
    {ask.markDone && <ActionChip label="Mark done" icon={Check} disabled={busy} onClick={() => send(`/api/board/items/${key}`, { done: true })}/>}
    {onReply && <ActionChip label="Reply…" icon={Reply} className="is-reply" disabled={busy} onClick={onReply}/>}
  </>;
}

function DecisionRow({ entry, folders }) {
  const [replying, setReplying] = useState(false), { busy, error, send } = useBoardAction();
  const ask = entry.state === 'paused' ? { kind: 'paused', text: 'Paused', options: [] } : askOf(entry.latest);
  const canReply = replyable(ask, entry.latest);
  const reply = async value => { if (await send(...answerRequest(entry.latest, ask, value))) setReplying(false); };
  return <li className="board-row decision-row">
    <StateDot entry={entry} folders={folders} busy={busy} onAction={send}/>
    <div className="decision-body">
      <div className="decision-title"><LandingMark entry={entry}/><Link href={`/runs/${entry.latest.id}`} className="board-title">{entry.title}</Link></div>
      {ask.text && <p className="decision-ask">{ask.text}</p>}
      <div className="decision-answers"><DecisionActions entry={entry} ask={ask} busy={busy} send={send} onReply={canReply && !replying ? () => setReplying(true) : null}/></div>
      {replying && <ReplyBox title={entry.title} busy={busy} onSend={reply} onClose={() => setReplying(false)}/>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </li>;
}

export function DecisionGroup({ entries, folders, reviewing = false }) {
  if (!entries.length) return reviewing ? null : <p className="board-clear"><span className="board-dot state-completed" aria-hidden="true"/>Nothing needs you</p>;
  return <section className="board-group is-decision" aria-labelledby="group-decision">
    <h2 id="group-decision">Needs decision · {entries.length}</h2>
    <ul>{entries.map(entry => <DecisionRow key={entry.key} entry={entry} folders={folders}/>)}</ul>
  </section>;
}
