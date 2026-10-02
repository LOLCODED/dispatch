import { useMemo, useState } from 'react';
import { ArrowDown, ArrowDownUp, Camera, CornerDownLeft, Eye, Gamepad2, Globe, Hourglass, Keyboard, ListChecks, Lock, Minimize2, MousePointer2, MousePointerClick, Scaling, ScanText, SquareDashedMousePointer, Terminal, TriangleAlert, Undo2 } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { artifactUrl, PointerImage } from '@/components/run/Artifacts';
import { AppFrame, runningAppUrl } from '@/components/run/AppFrame';
import { browserAction, browserCaption, browserFrame, browserNarration, stepArtifacts } from '@/lib/timeline.mjs';
import { agentName } from '@/lib/providers.mjs';
import { duration } from '@/lib/workspace';
import { useFollowLatest } from '@/lib/follow-latest';
import { useRunSteps } from '@/lib/steps';

const clock = ms => { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
const sinceStart = (run, at) => at && run.startedAt ? clock(new Date(at) - new Date(run.startedAt)) : '';

const actionLooks = {
  navigate: ['go', Globe], back: ['go', Undo2],
  click: ['pointer', MousePointerClick], hover: ['pointer', MousePointer2], select: ['pointer', ListChecks],
  type: ['input', Keyboard], press: ['input', CornerDownLeft],
  snapshot: ['read', ScanText], screenshot: ['read', Camera], console: ['read', Terminal],
  scroll: ['quiet', ArrowDownUp], resize: ['quiet', Scaling], wait: ['quiet', Hourglass],
};

function Caption({ run, step, said, agent, current, onSelect }) {
  const { verb, object } = browserCaption(step);
  const [tone, Icon] = step.error ? ['error', TriangleAlert] : actionLooks[browserAction(step)] ?? ['quiet', MousePointer2];
  return <li data-seq={step.seq} data-tone={tone} className={`live-caption ${current ? 'is-current' : ''} ${step.error ? 'has-error' : ''}`} aria-current={current ? 'step' : undefined}>
    <button type="button" className="live-caption-action" aria-label={`${verb} ${object}`.trim()} title={step.durationMs != null ? `${agent} · took ${duration(step.durationMs)}` : agent} onClick={onSelect}>
      <span className="live-caption-icon" aria-hidden="true"><Icon size={15}/></span><strong>{verb}</strong><span className="live-caption-object">{step.error ?? object}</span>{said && !step.error && <span className="live-caption-said">{said}</span>}<time>{sinceStart(run, step.at)}</time>
    </button>
  </li>;
}

function Screen({ run, step, shot }) {
  if (!shot) return <p className="live-screen-empty muted">No screenshot was retained for this point in the browser history.</p>;
  return <PointerImage key={shot.id} src={`${artifactUrl(run.id, shot)}?inline`} artifact={shot} target={step.target}/>;
}

export function LiveBrowser({ run, steps, full, onFull, onOpenArtifact }) {
  const browserSteps = useMemo(() => steps.filter(step => step.kind === 'browser.step'), [steps]);
  const narration = useMemo(() => browserNarration(steps), [steps]);
  const [selectedSeq, setSelectedSeq] = useState(null);
  const { selected, captured: shown } = browserFrame(browserSteps, selectedSeq);
  const [shot] = shown ? stepArtifacts(shown, run) : [], editable = Boolean(shot && shown.elements?.length);
  const feed = useFollowLatest(browserSteps.length), agent = agentName(run);
  const appUrl = runningAppUrl(run), [play, setPlay] = useState(false), playing = play && Boolean(appUrl);
  const select = step => { setSelectedSeq(step === browserSteps.at(-1) ? null : step.seq); setPlay(false); };
  const latest = () => { setSelectedSeq(null); feed.followLatest(); };
  return <figure className={`live-browser ${playing ? 'is-playing' : ''}`} aria-label={playing ? 'Running app' : 'Live browser'}>
    <figcaption className="live-chrome">
      <span className={`live-badge ${selectedSeq === null && !playing ? 'is-live' : ''}`}>{playing ? 'Yours' : selectedSeq === null ? 'Live' : 'Replay'}</span>
      <span className="live-url"><Lock size={11} aria-hidden="true"/><span>{playing ? appUrl : shown?.url ?? 'about:blank'}</span></span>
      {appUrl && <IconButton label={playing ? 'Watch the agent' : 'Play the running app'} icon={playing ? Eye : Gamepad2} aria-pressed={playing} onClick={() => setPlay(!playing)}/>}
      {editable && !playing && <IconButton label="Edit this view" icon={SquareDashedMousePointer} onClick={() => onOpenArtifact({ runId: run.id, artifact: shot, step: shown })}/>}
      {full && <IconButton label="Exit full screen" shortcut="Escape" icon={Minimize2} aria-pressed onClick={onFull}/>}
    </figcaption>
    <div className="live-screen">{playing ? <AppFrame url={appUrl}/> : <Screen run={run} step={shown} shot={shot}/>}</div>
    <div className="live-feed-wrap">
      <ol ref={feed.ref} className="live-feed" tabIndex={0} aria-label="Browser actions" aria-live="polite" onScroll={feed.onScroll}>
        {browserSteps.map(step => <Caption key={step.seq} run={run} step={step} said={narration.get(step.seq)} agent={agent} current={step === selected} onSelect={() => select(step)}/>)}
      </ol>
      {(selectedSeq !== null || !feed.following) && <IconButton className="live-latest" variant="secondary" label="Latest" icon={ArrowDown} onClick={latest}/>}
    </div>
  </figure>;
}

export function BrowserTile({ run, full, onFull, onOpenArtifact }) {
  const { steps, error } = useRunSteps(run.id, run.stepCount ?? 0);
  return <>{error && <p className="error" role="alert">{error}</p>}<LiveBrowser run={run} steps={steps} full={full} onFull={onFull} onOpenArtifact={onOpenArtifact}/></>;
}
