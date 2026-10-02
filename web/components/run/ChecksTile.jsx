import { CircleCheck, CircleX, LoaderCircle, CircleDashed, History, ListPlus, Plus, RefreshCw } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { duration, terminal } from '@/lib/workspace';
import { useDeliveryRefresh } from '@/lib/delivery';
import { RecipeEditor, recipeEditable } from '@/components/run/RecipeEditor';
import { useState } from 'react';
import { api } from '@/lib/workspace';
import { longRunningScript, npmScript } from '@/lib/recipe-roles.mjs';

const checkIcons = { passed: CircleCheck, failed: CircleX, running: LoaderCircle };

function CheckRow({ check }) {
  const Icon = checkIcons[check.status] ?? CircleDashed;
  return <details className={`check-result check-${check.status}`}>
    <summary><Icon size={14} aria-hidden="true" className="check-icon"/><span className="check-name">{check.name}</span><small>{check.status}{check.reusedFrom ? ' (reused)' : ''} · attempt {check.attempt}</small><small>{duration(check.durationMs)}</small></summary>
    <pre>{check.output ?? 'Running…'}</pre>
  </details>;
}

const checkLike = /^(check|lint|test|test:unit|test:e2e)$/;
function offeredSteps(run) {
  if (run.status !== 'ready' || !run.packageScripts) return [];
  const present = new Set(run.project.validation.map(step => npmScript(step)).filter(Boolean));
  const checks = Object.keys(run.packageScripts).filter(name => checkLike.test(name) && !longRunningScript(name) && !present.has(name)).map(name => ({ key: `check:${name}`, label: `npm run ${name}`, note: 'not in this repository\u2019s checks', body: { validation: [{ id: name, command: 'npm', args: ['run', name] }] } }));
  const install = run.changedPaths?.includes('package-lock.json') && !run.project.setup.length ? [{ key: 'setup:install', label: 'npm ci', note: 'before each run', body: { setup: [{ id: 'install', command: 'npm', args: ['ci'] }] } }] : [];
  return [...checks, ...install];
}

function OfferedSteps({ run }) {
  const [done, setDone] = useState({}), [error, setError] = useState('');
  const offers = offeredSteps(run);
  if (!offers.length) return null;
  const add = offer => api(`/api/projects/${run.projectId}/checks`, offer.body).then(() => setDone(current => ({ ...current, [offer.key]: true }))).catch(failure => setError(failure.message));
  return <div className="offered-steps">{offers.map(offer => <div className="offered-step" key={offer.key}><code>{offer.label}</code><small>{done[offer.key] ? 'added for the next run' : offer.note}</small>{!done[offer.key] && <IconButton label={offer.key.startsWith('setup') ? 'Add as setup' : 'Add'} icon={Plus} variant="outline" onClick={() => add(offer)}/>}</div>)}{error && <p className="error" role="alert">{error}</p>}</div>;
}

function Finding({ run, finding }) {
  const [saved, setSaved] = useState(false), [error, setError] = useState('');
  const save = () => api('/api/tasks', { projectId: run.projectId, input: finding, sourceRunId: run.id }).then(() => { setSaved(true); window.dispatchEvent(new Event('dispatch-refresh')); }).catch(failure => setError(failure.message));
  return <div className="review-finding"><p>{finding}</p>{saved ? <small className="muted">saved to Todo</small> : <IconButton label="Save as task" icon={ListPlus} onClick={save}/>}{error && <p className="error" role="alert">{error}</p>}</div>;
}

function Reviews({ run }) {
  const reviews = run.reviews;
  return <section className="tile-section"><h3>Independent review</h3>{reviews?.length ? reviews.map((review, index) => <div className={`check-result check-${review.status}`} key={index}>
    <p>Attempt {review.attempt} · {review.status} · {duration(review.durationMs)}</p>
    <small>Revision {review.revision?.slice(0, 12)}</small>
    {review.findings?.map((finding, position) => <Finding key={position} run={run} finding={finding}/>)}
  </div>) : <p className="muted">Review starts after mandatory checks pass.</p>}</section>;
}

const ciClass = check => check.status !== 'completed' ? 'running' : ['success', 'neutral', 'skipped'].includes(check.conclusion) ? 'passed' : 'failed';

function CiRun({ check }) {
  const status = ciClass(check), Icon = checkIcons[status] ?? CircleDashed;
  return <div className={`check-result check-${status}`}><p><Icon size={14} aria-hidden="true" className="check-icon"/> {check.name || 'unnamed check'} · {check.conclusion ?? check.status ?? 'unknown'}</p></div>;
}

function Delivery({ run }) {
  const delivery = run.delivery, { busy, error, refresh } = useDeliveryRefresh(run.id, Boolean(delivery?.pushedAt) && terminal.has(run.status));
  if (!delivery) return null;
  const writeback = delivery.tracker;
  return <section className="tile-section delivery">
    <div className="section-heading"><h3>Delivery</h3>{delivery.pushedAt && <IconButton label="Refresh delivery" icon={RefreshCw} disabled={busy} onClick={refresh}/>}</div>
    <dl className="delivery-facts">
      <dt>Branch</dt><dd className="break-all">{delivery.branch ? <>{delivery.remote ? `${delivery.remote}/` : ''}{delivery.branch} · {delivery.pushedAt ? `pushed ${delivery.headSha?.slice(0, 12)}` : 'not pushed'}</> : 'in place (no branch)'}</dd>
      {delivery.pr && <><dt>Pull request</dt><dd>{delivery.pr.url ? <a href={delivery.pr.url} target="_blank" rel="noopener">#{delivery.pr.number ?? '?'}</a> : `#${delivery.pr.number ?? '?'}`} · {String(delivery.pr.state).toLowerCase()} · {delivery.pr.reused ? 'existing' : 'draft created by dispatch'}</dd></>}
      {delivery.ci && <><dt>CI</dt><dd>{delivery.ci.state} for {delivery.ci.sha?.slice(0, 12)} · checked {new Date(delivery.ci.checkedAt).toLocaleTimeString()}</dd></>}
      {writeback && <><dt>{writeback.name ?? 'Tracker'}</dt><dd>{writeback.commented ? `Comment posted${writeback.rev === null || writeback.rev === undefined ? '' : ` (work item rev ${writeback.rev})`}` : `Comment not posted: ${writeback.error}`}</dd></>}
    </dl>
    {delivery.ci?.checks.map((check, index) => <CiRun key={index} check={check}/>)}
    {delivery.error && <p className="error" role="alert">Delivery stopped at {delivery.error.step}: {delivery.error.message} The tested local commit is still valid.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="muted">CI is read for the exact pushed commit and shown only; it never changes the run status or starts a repair.</p>
  </section>;
}

export function ChecksTile({ run, onTimeline }) {
  return <div className="checks-tile">
    <section className="tile-section"><h3>Mandatory checks</h3>{run.checks.length ? run.checks.map((check, index) => <CheckRow key={index} check={check}/>) : <p className="muted">Mandatory checks appear here after implementation.</p>}<OfferedSteps run={run}/>{recipeEditable(run) && <RecipeEditor run={run}/>}</section>
    {run.project.review && <Reviews run={run}/>}
    <Delivery run={run}/>
    {run.artifacts.length > 0 && <section className="tile-section"><h3>Screenshots & recordings</h3><p className="muted">{run.artifacts.length} file{run.artifacts.length === 1 ? '' : 's'} recorded. {onTimeline && <IconButton label="Open in Timeline" icon={History} onClick={onTimeline}/>}</p></section>}
  </div>;
}
