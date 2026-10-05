import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, FlaskConical, Gamepad2, Globe, MessageSquare } from 'lucide-react';
import { RunHeader } from '@/components/run/RunHeader';
import { TileLayout } from '@/components/run/TileLayout';
import { ChatTile, hasPendingDecision } from '@/components/run/ChatTile';
import { QuestionBar } from '@/components/run/QuestionBar';
import { GamesTile } from '@/components/run/games/GamesTile';
import { DiffTile } from '@/components/run/DiffTile';
import { ChecksTile } from '@/components/run/ChecksTile';
import { TimelineTile } from '@/components/run/TimelineTile';
import { BrowserTile } from '@/components/run/LiveBrowser';
import { RunDrawer } from '@/components/run/RunDrawer';
import { Lightbox } from '@/components/run/Artifacts';
import { appendReference } from '@/components/run/RunComposer';
import { useRunStream, useNow, useRunHistory, useLiveDiff, useDraft } from '@/lib/run-hooks';
import { conversationElapsed, runDurations, runElapsed } from '@/lib/run-time.mjs';
import { useTiles, useMediaQuery, tileFocusMode, tileStrokeMode } from '@/lib/tiles';
import { matches, tileIndex, usesCommandModifier } from '@/lib/keybinds.mjs';
import { shortcutLabel, usePreferences } from '@/lib/preferences';
import { api, Link, navigate, useWorkspace, terminal } from '@/lib/workspace';
import { blockedQuestionOf, remainingOptions, remainingQuestion } from '@/lib/question.mjs';
import { openRemaining } from '../../src/remaining.mjs';
import { lineReference } from '@/lib/diff.mjs';
import { diffWanted, layoutPolicy, relevantTiles } from '@/lib/run-layouts.mjs';
import { useBrowserFocus, useDecisionFocus, useDiffFocus } from '@/lib/run-layout-hooks';
import { hashStep } from '@/lib/timeline.mjs';

function blockedQuestion(run) {
  if (openRemaining(run)) return { question: remainingQuestion, options: remainingOptions };
  if (run.status !== 'blocked') return null;
  const text = run.question ?? (run.summary?.startsWith('DISPATCH_BLOCKED:') ? run.summary.slice('DISPATCH_BLOCKED:'.length).trim() : null);
  return text ? blockedQuestionOf(text, run.plan) : null;
}

const editable = target => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]'));

function useTileShortcuts(available, layout, compact, keybinds) {
  useEffect(() => {
    const key = event => {
      if (event.key === 'Escape' && layout.full && !editable(event.target)) { layout.exitFull(); return; }
      const typing = editable(event.target);
      if (!compact && matches(event, keybinds.fullScreen) && (usesCommandModifier(keybinds.fullScreen) || !typing)) { event.preventDefault(); layout.toggleFull(); return; }
      const tile = available[tileIndex(event, keybinds.tileFocus)];
      if (!tile) return;
      event.preventDefault();
      compact ? layout.focus(tile) : layout.show(tile);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [available.join(), layout, compact, keybinds]);
}

// The result lives in the drawer, so a run that finishes while watched opens it once; closing it sticks. On a phone the drawer covers the chat, so it only opens on request.
function useOpenOnFinish(done, compact, setDrawer) {
  const wasDone = useRef(done);
  useEffect(() => { if (done && !wasDone.current && !compact) setDrawer(current => current ?? 'auto'); wasDone.current = done; }, [done, compact, setDrawer]);
  useEffect(() => { if (compact) setDrawer(current => current === 'auto' ? null : current); }, [compact, setDrawer]);
}

// dispatch can continue a run on its own (a repository joined the task), so a watched run that gains a successor moves to it; opening an older link stays put.
function useFollowContinuation(run) {
  const seen = useRef({ id: run.id, supersededBy: run.supersededBy ?? null });
  useEffect(() => {
    if (seen.current.id !== run.id) { seen.current = { id: run.id, supersededBy: run.supersededBy ?? null }; return; }
    const next = run.supersededBy ?? null, path = next && `/runs/${next}`;
    if (next && !seen.current.supersededBy && location.pathname !== path) navigate(path);
    seen.current.supersededBy = next;
  }, [run.id, run.supersededBy]);
}

function RunWorkspace({ run, setRun, mode }) {
  useFollowContinuation(run);
  const { state } = useWorkspace(), { history } = useRunHistory(run.id), policy = layoutPolicy(mode);
  const done = terminal.has(run.status), now = useNow(!done), compact = useMediaQuery('(max-width: 899px)');
  const browsed = (run.stepSummary?.browser ?? 0) > 0, driving = ['implementing', 'repairing'].includes(run.status) && browsed;
  const [hasChanges, setHasChanges] = useState(false), [playing, setPlaying] = useState(false);
  const available = relevantTiles(policy, { canDiff: Boolean(run.baseSha), hasChanges, checks: Boolean(run.checks.length || run.artifacts.length || run.reviews?.length), driving, browsed });
  const layout = useTiles(available, mode), watchDiff = policy.diff !== 'manual' && !hasChanges;
  const live = useLiveDiff(run.id, run, Boolean(run.baseSha) && (watchDiff || layout.isOpen('diff')));
  useEffect(() => setHasChanges(Boolean(live.diff?.diff?.trim())), [live.diff]);
  const [timelineOpen, setTimelineOpen] = useState(true), hasTimeline = done && Boolean(run.stepCount);
  const [drawer, setDrawer] = useState(() => done && (!compact || hashStep(location.hash, run.id) !== null) ? 'auto' : null), [preview, setPreview] = useState(null), [draft, setDraft] = useDraft(`dispatch-followup-${run.id}`), composerRef = useRef(null);
  const [error, setError] = useState('');
  const answerRef = useRef(null);
  const [focusMode] = useState(tileFocusMode), [strokeMode] = useState(tileStrokeMode), { keybinds } = usePreferences(), fullKey = shortcutLabel(keybinds.fullScreen);
  useTileShortcuts(available, layout, compact, keybinds);
  useOpenOnFinish(done, compact, setDrawer);
  const request = run.interactions?.find(item => item.status === 'pending'), question = blockedQuestion(run), decision = request?.id ?? question?.question ?? null;
  const barred = policy.question === 'bar' && hasPendingDecision(run, request, question);
  useBrowserFocus({ runId: run.id, driving, said: run.events.findLast(event => event.kind === 'message')?.id ?? null, decision, layout, compact, policy, busy: playing });
  useDecisionFocus({ decision, layout, compact, policy });
  useDiffFocus({ wanted: diffWanted(policy, run.status, hasChanges), layout, compact, policy });
  useEffect(() => { const key = event => { if (event.key === 'Escape') setDrawer(null); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
  const reference = useCallback(text => { if (answerRef.current) answerRef.current(text); else setDraft(current => appendReference(current, text)); if (!layout.isOpen('chat')) layout.focus('chat'); requestAnimationFrame(() => composerRef.current?.focus()); }, [layout, setDraft]);
  const referenceLine = useCallback(line => reference(lineReference(line)), [reference]);
  const elapsed = runElapsed(run, done, now), totalElapsed = conversationElapsed(run, history, done, now), durations = history.length ? runDurations(run, history, done, now) : null;
  const cancel = async () => { try { setRun(await api(`/api/runs/${run.id}/cancel`, {})); } catch (failure) { setError(failure.message); } };
  const fromDrawer = action => (...args) => { action(...args); if (compact) setDrawer(null); };
  const openTimeline = () => { setTimelineOpen(true); setDrawer('manual'); };
  const timeline = () => <TimelineTile run={run} live={false} earlierRuns={history} labels={state.labels} traceViewer={state.traceViewer === true} onOpenArtifact={setPreview} onReference={fromDrawer(reference)} onDiff={fromDrawer(() => layout.focus('diff'))}/>;
  const tiles = {
    chat: { title: 'Chat', icon: MessageSquare, render: () => <ChatTile run={run} history={history} labels={state.labels} request={request} question={question} draft={draft} setDraft={setDraft} composerRef={composerRef} answerRef={answerRef} onUpdate={setRun} onOpenArtifact={setPreview} activity={policy.activity} decisionElsewhere={barred}/> },
    diff: { title: 'Diff', icon: FileText, live: !done, render: () => <DiffTile run={run} live={live} onReference={referenceLine}/> },
    checks: { title: 'Checks', icon: FlaskConical, render: () => <ChecksTile run={run} onOpenArtifact={setPreview} onTimeline={hasTimeline ? openTimeline : undefined}/> },
    browser: { title: 'Browser', icon: Globe, live: true, bare: layout.full === 'browser', render: () => <BrowserTile run={run} full={layout.full === 'browser'} onFull={() => layout.toggleFull('browser')} onOpenArtifact={setPreview}/> },
    games: { title: 'Games', icon: Gamepad2, render: () => <GamesTile paused={Boolean(decision)} onPlaying={setPlaying}/> },
  };
  return <main className={`run-page ${drawer ? 'has-drawer' : ''}`} data-run-id={run.id}>
    <RunHeader run={run} labels={state.labels} elapsed={totalElapsed} done={done} tiles={tiles} available={available} layout={layout} compact={compact} drawer={drawer} onDrawer={setDrawer} onCancel={cancel}/>
    {error && <p className="error run-error" role="alert">{error}</p>}
    {barred && <QuestionBar run={run} request={request} question={question} onUpdate={setRun} onOpenArtifact={setPreview} answerRef={answerRef}/>}
    <div className="run-body"><TileLayout tiles={tiles} layout={layout} compact={compact} focusMode={focusMode} stroke={strokeMode === 'on'} fullKey={fullKey}/><RunDrawer open={Boolean(drawer)} focus={drawer === 'manual'} onClose={() => setDrawer(null)} run={run} elapsed={elapsed} totalElapsed={totalElapsed} durations={durations} done={done} onUpdate={setRun} timeline={hasTimeline ? timeline : null} timelineOpen={timelineOpen} onTimelineOpen={setTimelineOpen}/></div>
    <Lightbox preview={preview} onClose={() => setPreview(null)} onReference={reference} onNavigate={setPreview}/>
  </main>;
}

export function Run({ id }) {
  const { state, loaded } = useWorkspace(), { run, setRun, error } = useRunStream(id), { layout } = usePreferences();
  if (!run) return <main className="page"><Link href="/">← All work</Link><h1>{loaded && !state.runs.some(item => item.id === id) ? 'Run not found' : 'Loading your run…'}</h1>{error && <p className="error">{error}</p>}</main>;
  return <RunWorkspace key={layout} run={run} setRun={setRun} mode={layout}/>;
}
