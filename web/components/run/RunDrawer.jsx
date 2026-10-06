import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Metric, count, duration } from '@/lib/workspace';
import { useScrollShadow } from '@/lib/scroll-shadow';
import { choiceLabel, runModel } from '@/lib/execution';
import { Verdict } from '@/components/run/Verdict';

function RunInfo({ run }) {
  const model = choiceLabel(runModel(run));
  return <section className="panel run-info">
    <dl>
      <dt>Repository</dt><dd>{run.project.name} / {run.ticketId}</dd>
      {run.kind !== 'landing' && <><dt>Model</dt><dd title={run.execution?.reason}>{model}</dd></>}
      {run.branch && <><dt>Branch</dt><dd className="break-all">{run.branch}</dd></>}
      {!run.branch && run.project?.git === false && run.kind !== 'answer' && <><dt>Folder</dt><dd className="break-all">{run.workspace}</dd></>}
    </dl>
    <a className="back-link" href={`/api/runs/${run.id}/export`} target="_blank" rel="noopener"><Download size={13} aria-hidden="true"/>Export evidence</a>
  </section>;
}

const phaseLabels = { capabilitiesMs: 'CLI check', worktreeMs: 'Worktree', setupMs: 'Setup', lockWaitMs: 'Waiting for another check', publishMs: 'Local commit', deliveryMs: 'Delivery' };
const folderPhaseLabels = { ...phaseLabels, worktreeMs: 'Snapshot', publishMs: 'Handoff' };
const precise = ms => ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : duration(ms);

function PhaseTimings({ phases, labels }) {
  const known = Object.entries(phases ?? {}).filter(([, value]) => value !== null);
  if (!known.length) return null;
  return <details className="technical"><summary>Phase timings</summary><dl className="phase-timings">{known.map(([key, value]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd>{precise(value)}</dd></div>)}</dl></details>;
}

function RunDurations({ durations, total, done }) {
  return <section className="panel"><h2>All runs</h2><div className="run-metrics">
    <Metric label={done ? 'Total time' : 'Working for'} value={duration(total)} note="From the first run's start"/>
    {durations.map(item => <Metric key={item.id} label={item.label} value={duration(item.ms)}/>)}
  </div></section>;
}

function RunUsage({ run, elapsed, totalElapsed, durations, done }) {
  const insights = run.insights;
  return <>
    <RunInfo run={run}/>
    {durations && <RunDurations durations={durations} total={totalElapsed} done={done}/>}
    <section className="panel"><h2>This run</h2><div className="run-metrics">
      <Metric label={done ? 'Time working' : 'Working for'} value={duration(elapsed)}/><Metric label="Tokens used" value={count(insights?.tokens.total)}/>
      <Metric label="Input tokens" value={count(insights?.tokens.input)}/><Metric label="Cached input" value={count(insights?.tokens.cachedInput)} note="Included in input tokens"/>
      <Metric label="Output tokens" value={count(insights?.tokens.output)}/><Metric label="Time queued" value={duration(insights?.queueMs)}/>
      <Metric label="Checks" value={duration(insights?.checkMs)}/><Metric label="Worker time" value={duration(insights?.workerMs)} note="Completed CLI turns, including tools"/>
      <Metric label="Instructions sent" value={count(insights?.promptCharacters)} note="Characters sent by dispatch; excludes native session context"/><Metric label="Repository notes" value={run.memory ? count(run.memory.injectedCharacters) : run.project?.memory === false ? 'Off' : count(null)} note="Characters of earlier-task notes in the first instructions"/>
      <Metric label="Repair attempts" value={insights?.repairs ?? 0}/>
    </div></section>
    <PhaseTimings phases={insights?.phases} labels={run.project?.git === false ? folderPhaseLabels : phaseLabels}/>
    {!!run.workerTurns?.length && <details className="technical"><summary>Model turns</summary>{run.workerTurns.map((turn, index) => <div className="check-result" key={index}><p>{turn.role === 'reviewer' ? 'Independent reviewer' : 'Implementation owner'} · attempt {turn.attempt} · {turn.status}</p><p>{duration(turn.durationMs)} · {count(turn.usage?.input_tokens)} input tokens · {count(turn.usage?.output_tokens)} output tokens</p><small>{count(turn.usage?.cached_input_tokens)} cached input (included above) · {turn.resumed ? 'Resumed session' : 'New session'}{turn.tools?.length ? ` · tools: ${turn.tools.join(', ')} (${count(turn.toolCharacters)} schema characters)` : ''}</small></div>)}</details>}
    <details className="technical"><summary>Technical details</summary><p>{run.branch}</p><p>{run.workspace}</p><p>{run.headSha}</p><pre>{run.events.filter(event => ['tool', 'setup'].includes(event.kind)).map(event => `${event.kind}: ${event.message}`).join('\n')}</pre></details>
  </>;
}

function TimelineSection({ open, onOpen, children }) {
  const section = useRef(null), wasOpen = useRef(open);
  useEffect(() => { if (open && !wasOpen.current) section.current?.scrollIntoView({ block: 'start' }); wasOpen.current = open; }, [open]);
  return <details ref={section} className="drawer-timeline" open={open} onToggle={event => onOpen(event.currentTarget.open)}>
    <summary>Timeline</summary>
    {open && <section aria-label="Timeline">{children}</section>}
  </details>;
}

export function RunDrawer({ open, focus, onClose, run, elapsed, totalElapsed, durations, done, onUpdate, timeline, timelineOpen, onTimelineOpen }) {
  const panel = useRef(null), body = useRef(null);
  useScrollShadow(body, open);
  useEffect(() => { if (open && focus) panel.current?.focus({ preventScroll: true }); }, [open, focus]);
  return <AnimatePresence>{open && <motion.aside key="drawer" ref={panel} tabIndex={-1} className="run-drawer" aria-label="Result" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}>
    <header className="drawer-heading"><h2>Result</h2><IconButton label="Close drawer" icon={X} onClick={onClose}/></header>
    <div ref={body} className="drawer-body">{done && !run.supersededBy && <Verdict run={run} onUpdate={onUpdate}/>}{timeline && <TimelineSection open={timelineOpen} onOpen={onTimelineOpen}>{timeline()}</TimelineSection>}<RunUsage run={run} elapsed={elapsed} totalElapsed={totalElapsed} durations={durations} done={done}/></div>
  </motion.aside>}</AnimatePresence>;
}
