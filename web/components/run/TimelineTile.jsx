import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotionConfig } from 'motion/react';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleDot, Diff, Download, FileArchive, Files, Flag, FlaskConical, Globe, HelpCircle, MessageSquare, MessageSquarePlus, Pause, Play, Reply, ScanSearch, Send, Server, Wrench, X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Markdown } from '@/components/Markdown';
import { artifactUrl, isImage, PointerImage } from '@/components/run/Artifacts';
import { hashStep, neighbour, ownSteps, phaseRows, phaseTitle, playableSteps, stepArtifacts, stepHash, stepIcons, stepTitle, timelinePhases } from '@/lib/timeline.mjs';
import { useEarlierSteps, useRunSteps } from '@/lib/steps';
import { duration } from '@/lib/workspace';
import { useFollowLatest } from '@/lib/follow-latest';

const icons = { play: Play, flag: Flag, message: MessageSquare, wrench: Wrench, globe: Globe, files: Files, flask: FlaskConical, help: HelpCircle, reply: Reply, send: Send, circle: CircleDot, server: Server, diff: Diff, alert: AlertTriangle };
const playIntervalMs = 1200, noRuns = [], noLabels = {};
const time = at => at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

function StepIcon({ kind }) { const Icon = icons[stepIcons[kind]] ?? CircleDot; return <Icon size={13} aria-hidden="true"/>; }

const rowTime = step => [time(step.at), step.durationMs != null && duration(step.durationMs)].filter(Boolean).join(' · ');

function Phase({ phase, multiRun, current, onToggle, renderDetail }) {
  return <li className={`step-phase ${phase.tone ? `is-${phase.tone}` : ''}`}>
    <p className="step-phase-title"><strong>{phaseTitle(phase, multiRun)}</strong><small>{[phase.outcome || time(phase.startedAt), phase.durationMs != null && duration(phase.durationMs)].filter(Boolean).join(' · ')}</small></p>
    {phase.note && <p className="step-phase-note">{phase.note}</p>}
    {phase.rows.length > 0 && <ol>{phase.rows.map(step => { const open = current?.key === step.key; return <li key={step.key}>
      <button type="button" className={`step-row step-${step.kind.replace('.', '-')}`} aria-current={open ? 'true' : undefined} aria-expanded={open} onClick={() => onToggle(step)}><StepIcon kind={step.kind}/><span className="step-row-title">{stepTitle(step)}</span><small>{rowTime(step)}</small></button>
      {open && renderDetail(step)}
    </li>; })}</ol>}
  </li>;
}

function PhaseEnd({ end, labels }) {
  return <li className={`step-phase step-phase-end is-${end.tone}`}>
    <p className="step-phase-title"><strong>{labels[end.status] ?? end.status}</strong><small>{time(end.at)}</small></p>
    {end.message && <p className="step-phase-note">{end.message}</p>}
  </li>;
}

function StepFeed({ phases, current, multiRun, labels, onToggle, renderDetail }) {
  return <ol className="step-list" aria-label="Steps">{phases.map(item => item.type === 'end' ? <PhaseEnd key={item.key} end={item} labels={labels}/> : <Phase key={item.key} phase={item} multiRun={multiRun} current={current} onToggle={onToggle} renderDetail={renderDetail}/>)}</ol>;
}

function Expandable({ text, label }) {
  const [open, setOpen] = useState(false), long = text.length > 4000;
  return <div className="step-block"><p className="step-block-label">{label}</p><pre>{open || !long ? text : text.slice(0, 4000)}</pre>{long && <IconButton label={open ? 'Show less' : 'Show more'} icon={open ? ChevronUp : ChevronDown} aria-expanded={open} onClick={() => setOpen(!open)}/>}</div>;
}

function TracePreview({ runId, artifact, traceViewer }) {
  const [open, setOpen] = useState(false), url = artifactUrl(runId, artifact);
  return <div className="step-trace">
    {traceViewer && <IconButton label={open ? 'Close trace' : 'Open trace'} icon={open ? X : ScanSearch} aria-pressed={open} onClick={() => setOpen(!open)}/>}
    <IconButton label="Download trace" icon={FileArchive} href={url} download/>
    {!traceViewer && <code>npx playwright show-trace {artifact.name}</code>}
    {open && <iframe className="trace-frame" title={`Playwright trace ${artifact.name}`} src={`/trace-viewer/index.html?trace=${encodeURIComponent(`${location.origin}${url}?inline`)}`}/>}
  </div>;
}

function StepMedia({ run, step, artifacts, traceViewer, onOpenArtifact }) {
  if (!artifacts.length) return null;
  return <div className="step-media">{artifacts.map(artifact => {
    if (isImage(artifact)) return <button key={artifact.id} type="button" className="step-shot" onClick={() => onOpenArtifact({ runId: run.id, artifact, items: artifacts.filter(isImage), step })} aria-label={`Open ${artifact.name}`}><PointerImage src={`${artifactUrl(run.id, artifact)}?inline`} artifact={artifact} target={step.kind === 'browser.step' ? step.target : null}/></button>;
    if (artifact.mimeType === 'video/webm') return <video key={artifact.id} controls preload="metadata" src={`${artifactUrl(run.id, artifact)}?inline`}/>;
    if (artifact.extension === '.zip') return <TracePreview key={artifact.id} runId={run.id} artifact={artifact} traceViewer={traceViewer}/>;
    return <a key={artifact.id} href={artifactUrl(run.id, artifact)} download>{artifact.name}</a>;
  })}</div>;
}

function StepDetail({ run, step, traceViewer, onOpenArtifact, onReference, onDiff }) {
  const artifacts = stepArtifacts(step, run), json = value => JSON.stringify(value, null, 2);
  return <article className="step-detail" aria-label="Step detail">
    <h3 className="sr-only">{stepTitle(step)}</h3>
    <StepMedia run={run} step={step} artifacts={artifacts} traceViewer={traceViewer} onOpenArtifact={onOpenArtifact}/>
    {step.kind === 'browser.step' && <dl className="step-facts">{step.url && <><dt>URL</dt><dd className="break-all">{step.url}</dd></>}{step.title && <><dt>Title</dt><dd>{step.title}</dd></>}{step.error && <><dt>Error</dt><dd className="error">{step.error}</dd></>}{step.screenshotSkipped && <><dt>Screenshot</dt><dd>skipped: {step.screenshotSkipped}</dd></>}</dl>}
    {step.kind === 'browser.step' && step.args && <Expandable label="Arguments" text={json(step.args)}/>}
    {step.kind === 'browser.step' && step.consoleErrors?.length > 0 && <Expandable label="Console errors" text={step.consoleErrors.map(entry => entry.text).join('\n')}/>}
    {step.kind === 'tool.call' && <Expandable label="Input" text={json(step.input)}/>}
    {step.kind === 'tool.call' && step.result && <Expandable label={step.result.isError ? 'Error' : 'Output'} text={step.result.output ?? ''}/>}
    {step.kind === 'message' && <div className="step-block"><Markdown>{step.text ?? ''}</Markdown></div>}
    {step.kind === 'check.end' && <><p>{step.command?.join(' ')}</p><Expandable label="Output" text={step.output ?? ''}/></>}
    {step.kind === 'files' && <ul className="step-paths">{(step.paths ?? []).map(path => <li key={path}><code>{path}</code></li>)}</ul>}
    {step.kind === 'question' && <Expandable label="Questions" text={(step.questions ?? []).map(item => item.question).join('\n')}/>}
    {step.kind === 'answer' && <Expandable label="Answers" text={Object.values(step.answers ?? {}).join('\n')}/>}
    {(step.kind === 'status' || step.kind === 'delivery' || step.kind === 'overflow') && step.message && <p>{step.message}</p>}
    {step.kind === 'patch' && <p className="verdict-actions"><IconButton label="Open the diff" icon={Diff} onClick={onDiff}/>{artifacts[0] && <IconButton label="Download patch" icon={Download} href={artifactUrl(run.id, artifacts[0])} download/>}</p>}
    <p className="verdict-actions"><IconButton label="Reference in chat" icon={MessageSquarePlus} onClick={() => onReference(`Step ${step.seq}: ${stepTitle(step)}${artifacts[0] ? ` (${artifacts[0].name})` : ''}`)}/></p>
  </article>;
}

// Merges tool results into their calls so the list shows one row per action with its outcome.
function withResults(steps) {
  const results = new Map(steps.filter(step => step.kind === 'tool.result').map(step => [step.callId, step]));
  return steps.map(step => step.kind === 'tool.call' ? { ...step, result: results.get(step.callId) ?? null } : step);
}

// A follow-up continues the same ticket, so its timeline starts with the earlier runs' steps.
function useTicketSteps(run, earlierRuns) {
  const chain = useMemo(() => [...earlierRuns].reverse().concat(run), [earlierRuns, run]);
  const earlier = useEarlierSteps(chain.slice(0, -1)), current = useRunSteps(run.id, run.stepCount ?? 0);
  const steps = useMemo(() => withResults([...chain.slice(0, -1).flatMap((item, index) => ownSteps(earlier.steps[item.id] ?? [], item, index)), ...ownSteps(current.steps, run, chain.length - 1)]), [chain, earlier.steps, current.steps]);
  const runs = useMemo(() => new Map(chain.map(item => [item.id, item])), [chain]);
  return { chain, runs, steps, current: current.steps, error: current.error || earlier.error };
}

function TimelineToolbar({ visible, position, current, playing, only, hasBrowser, hasChecks, onSelect, onPlaying, onOnly }) {
  const playable = playableSteps(visible).length > 0, filter = (kind, label, icon) => <IconButton label={label} icon={icon} aria-pressed={only === kind} onClick={() => onOnly(only === kind ? null : kind)}/>;
  return <div className="timeline-toolbar">
    <IconButton label="Previous step" icon={ChevronLeft} aria-keyshortcuts="ArrowLeft" disabled={position <= 1} onClick={() => onSelect(neighbour(visible, current, -1))}/>
    {playable && <IconButton label={playing ? 'Pause' : 'Play browser steps'} icon={playing ? Pause : Play} aria-keyshortcuts="Space" aria-pressed={playing} onClick={() => onPlaying(!playing)}/>}
    <IconButton label="Next step" icon={ChevronRight} aria-keyshortcuts="ArrowRight" disabled={position >= visible.length} onClick={() => onSelect(neighbour(visible, current, 1))}/>
    <span className="timeline-filters">{hasBrowser && filter('browser', 'Browser only', Globe)}{hasChecks && filter('checks', 'Checks only', FlaskConical)}</span>
  </div>;
}

export function TimelineTile({ run, earlierRuns = noRuns, labels = noLabels, live, traceViewer, onOpenArtifact, onReference, onDiff }) {
  const { chain, runs, steps, error } = useTicketSteps(run, earlierRuns), reduced = useReducedMotionConfig();
  const [only, setOnly] = useState(null), [playing, setPlaying] = useState(false), [selected, setSelected] = useState(() => hashStep(location.hash, run.id)), following = useRef(live && selected == null);
  const phases = useMemo(() => timelinePhases(steps, { browserOnly: only === 'browser', checksOnly: only === 'checks' }), [steps, only]);
  const visible = useMemo(() => phaseRows(phases), [phases]);
  const hasBrowser = useMemo(() => steps.some(step => step.kind === 'browser.step'), [steps]), hasChecks = useMemo(() => steps.some(step => step.kind === 'check.end'), [steps]);
  const list = useFollowLatest(visible.length, { initial: following.current });
  const current = visible.find(step => step.key === selected) ?? null;
  const newest = playableSteps(visible).at(-1) ?? visible.at(-1);
  const select = (step, follow = false) => { if (!step) return; following.current = follow || (live && step.key === newest?.key); setSelected(step.key); history.replaceState(null, '', `${location.pathname}${stepHash(step, run.id)}`); };
  const toggle = step => { if (current?.key !== step.key) return select(step); following.current = false; setSelected(null); history.replaceState(null, '', location.pathname); };
  useEffect(() => { if (live && following.current && newest) select(newest, true); else if (!current && selected !== null && visible.length) select(visible[0]); }, [visible.length]);
  useEffect(() => { if (!following.current) list.ref.current?.querySelector('.step-row[aria-current=true]')?.scrollIntoView({ block: 'nearest' }); }, [current?.key]);
  useEffect(() => {
    if (!playing) return;
    const frames = playableSteps(visible);
    const timer = setInterval(() => { const next = neighbour(frames, current, 1); if (!next || next.key === current?.key) setPlaying(false); else select(next); }, playIntervalMs);
    return () => clearInterval(timer);
  }, [playing, current, visible]);
  const keys = event => {
    if (event.target.closest('input, textarea, button, a, [contenteditable]') && event.key === ' ') return;
    if (event.key === 'ArrowLeft') select(neighbour(visible, current, -1)); else if (event.key === 'ArrowRight') select(neighbour(visible, current, 1)); else if (event.key === ' ' && playableSteps(visible).length) setPlaying(!playing); else return;
    event.preventDefault();
  };
  const position = current ? visible.findIndex(step => step.key === current.key) + 1 : 0;
  const detail = step => <StepDetail run={runs.get(step.runId) ?? run} step={step} traceViewer={traceViewer} onOpenArtifact={onOpenArtifact} onReference={onReference} onDiff={onDiff}/>;
  return <div className={`timeline-tile ${reduced ? 'is-reduced' : ''}`} tabIndex={0} onKeyDown={keys} aria-label="Timeline">
    <TimelineToolbar visible={visible} position={position} current={current} playing={playing} only={only} hasBrowser={hasBrowser} hasChecks={hasChecks} onSelect={select} onPlaying={setPlaying} onOnly={setOnly}/>
    {error && <p className="error" role="alert">{error}</p>}
    <div ref={list.ref} className="timeline-feed" onScroll={list.onScroll}>{phases.length ? <StepFeed phases={phases} current={current} multiRun={chain.length > 1} labels={labels} onToggle={toggle} renderDetail={detail}/> : <p className="muted">Steps appear as the agent works.</p>}</div>
  </div>;
}
