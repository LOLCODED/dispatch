import { Check, Code, Copy, FolderOpen, FolderX, Wrench } from 'lucide-react';
import { IconButton, Tooltip } from '@/components/IconButton';
import { api, Link, navigate } from '@/lib/workspace';
import { useAction } from '@/lib/use-action';
import { useCopied } from '@/lib/use-copied';
import { TrackerOffers } from '@/components/run/TrackerOffer';
import { LinkOffer } from '@/components/run/LinkOffer';
import { usePreferences } from '@/lib/preferences';
import { RiskDecision } from '@/components/run/RiskDecision';
import { currentChecks } from '@/lib/checks.mjs';

const isAnswer = run => run.kind === 'answer' || run.answered === true;
const inPlace = run => run.project?.git === false;
const verdicts = { ready: run => isAnswer(run) ? 'Answer ready' : run.kind === 'landing' ? `Landed${run.landing.target ? ` on ${run.landing.target}` : ''}` : inPlace(run) ? 'Ready in the folder' : 'Ready to hand off', blocked: () => 'Needs your decision', failed: () => 'Failed', cancelled: () => 'Cancelled', interrupted: () => 'Interrupted', budget_exceeded: () => 'Budget reached' };
const tones = { ready: 'success', blocked: 'attention', failed: 'danger' };
const handingOff = { landing: 'Landing on a branch', publishing: 'Opening a draft pull request' };
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function checksLine(run) {
  const checks = currentChecks(run);
  if (!checks.length) return run.status === 'ready' && run.kind !== 'answer' ? 'none required by the verification policy' : 'not run';
  const by = status => checks.filter(check => check.status === status).length;
  return [`${by('passed')} passed`, by('skipped') && `${by('skipped')} skipped by policy`, by('failed') && `${by('failed')} failed`].filter(Boolean).join(', ') + ` against ${run.revision?.slice(0, 12) ?? 'the candidate'}`;
}
function reviewLine(run) {
  if (!run.project?.review) return 'off';
  const last = run.reviews?.at(-1);
  if (!last) return 'not run';
  return last.status === 'passed' ? 'approved' : last.status === 'findings' ? plural(last.findings?.length ?? 0, 'finding') : last.status;
}
function baseLine(run) {
  if (!run.baseSha) return null;
  if (run.baseSource === 'folder') return `folder snapshot ${run.baseSha.slice(0, 12)}`;
  const source = { origin: 'fetched from origin', local: 'local branch', 'local-unfetched': 'local branch, fetch failed' }[run.baseSource] ?? 'local branch';
  const moved = run.handoff?.baseMoved ? `; origin moved by ${plural(run.handoff.baseMoved, 'commit')} since, rebase before merge` : '';
  return `${run.baseBranch} @ ${run.baseSha.slice(0, 12)} (${source}${moved})`;
}
function warnings(run) {
  const flags = run.flags ?? {}, list = [];
  if (flags.testsChanged?.length) list.push(`Test files changed: ${flags.testsChanged.join(', ')}. Review the test diff before merging.`);
  if (flags.protectedTouched?.length) list.push(`Protected paths touched: ${flags.protectedTouched.join(', ')}.`);
  if (flags.envChanged?.length) list.push(`Environment files changed: ${flags.envChanged.join(', ')}.`);
  if (flags.lockfileChanged?.length) list.push(`Lockfile changed: ${flags.lockfileChanged.join(', ')}.`);
  if (run.handoff?.baseMoved) list.push(`Base moved by ${plural(run.handoff.baseMoved, 'commit')} since this run started. Rebase before merge.`);
  return list;
}

function LinkedFacts({ run }) {
  const changed = (run.linked ?? []).filter(member => member.changedPaths?.length);
  if (!changed.length) return null;
  return <><dt>Linked</dt><dd><ul className="landing-items">{changed.map(member => <li key={member.projectId}>
    {member.name} · {plural(member.changedPaths.length, 'file')} · {member.branch ? <><code className="break-all">{member.branch}</code>{member.headSha && member.headSha !== member.baseSha ? ` @ ${member.headSha.slice(0, 12)}` : ''} · onto {member.baseBranch}</> : <>in place at <code className="break-all">{member.workspace}</code></>}
    {member.delivery?.pr?.url && <> · <a href={member.delivery.pr.url} target="_blank" rel="noopener">#{member.delivery.pr.number ?? '?'}</a></>}
  </li>)}</ul></dd></>;
}

function SqlBlock({ sql }) {
  const [copied, copy] = useCopied();
  return <div className="verdict-sql"><div className="section-heading"><h3>SQL to run before deploy</h3><IconButton label={copied ? 'Copied' : 'Copy SQL'} icon={copied ? Check : Copy} onClick={() => copy(sql)}/></div><pre>{sql}</pre></div>;
}

function WorktreeAction({ run, onUpdate }) {
  const { busy, error, perform } = useAction();
  if (run.kind === 'answer' || !run.baseSha || inPlace(run) || run.handingOff) return null;
  if (run.worktreeRemovedAt) return <p className="muted">Worktree removed{run.branchKept ? `; branch ${run.branch} kept because it holds unpushed commits` : ''}.</p>;
  return <div className="verdict-actions"><IconButton label="Remove worktree" icon={FolderX} variant="outline" disabled={busy} onClick={() => perform(async () => onUpdate(await api(`/api/runs/${run.id}/worktree/remove`, {})))}/>{error && <p className="error" role="alert">{error}</p>}</div>;
}


function BranchActions({ run }) {
  const { busy, error, perform } = useAction(), [copied, copy] = useCopied(), { editor } = usePreferences();
  const folder = inPlace(run) && run.kind !== 'answer' && Boolean(run.baseSha);
  if (!folder && (run.kind === 'answer' || !run.branch || !run.baseSha || (run.worktreeRemovedAt && !run.branchKept))) return null;
  const open = target => perform(() => api(`/api/runs/${run.id}/open`, { target, editor: target === 'editor' ? editor || null : undefined }));
  const worktree = !run.worktreeRemovedAt, deliveryError = run.delivery?.error?.message, name = folder ? run.workspace : run.branch, what = folder ? 'folder path' : 'branch name';
  return <div className="verdict-actions verdict-branch-actions" role="group" aria-label={folder ? 'Folder' : 'Branch'}>
    <Tooltip label={copied ? 'Copied' : `Copy ${what}`}><button type="button" className="verdict-branch break-all" aria-label={`Copy ${what}: ${name}`} onClick={() => copy(name)}><code>{name}</code></button></Tooltip>
    {worktree && <IconButton label="Open in editor" icon={Code} disabled={busy} onClick={() => open('editor')}/>}
    {worktree && <IconButton label="Open folder" icon={FolderOpen} disabled={busy} onClick={() => open('folder')}/>}
    {(error || deliveryError) && <p className="error" role="alert">{error || deliveryError}</p>}
  </div>;
}

const failedCi = ci => (ci?.checks ?? []).filter(check => check.status === 'completed' && !['success', 'neutral', 'skipped'].includes(check.conclusion));

function CiRepair({ run, onUpdate }) {
  const { busy, error, perform } = useAction(), ci = run.delivery?.ci, failed = failedCi(ci);
  if (ci?.state !== 'failure' || ci.sha !== run.delivery.headSha || run.supersededBy || !run.sessionId) return null;
  const repair = () => perform(async () => { const next = await api(`/api/runs/${run.id}/delivery/repair`, {}); onUpdate(next); navigate(`/runs/${next.id}`); });
  return <div className="verdict-ci" role="group" aria-label="CI failed">
    <p>CI failed on {ci.sha.slice(0, 12)}: {failed.map(check => check.name || 'unnamed check').join(', ')}</p>
    <IconButton label="Repair CI failures" icon={Wrench} variant="outline" disabled={busy} onClick={repair}/>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

export function Verdict({ run, onUpdate }) {
  const verdict = handingOff[run.handingOff] ?? verdicts[run.status]?.(run);
  if (!verdict) return null;
  const list = warnings(run), base = baseLine(run), changed = run.changedPaths?.length ?? 0, tone = run.handingOff ? 'active' : tones[run.status] ?? 'muted';
  return <section className={`verdict tone-${tone}`} aria-label="Verdict">
    <h2>{verdict}</h2>
    {!isAnswer(run) && <dl className="verdict-facts">
      <dt>Checks</dt><dd>{checksLine(run)}</dd>
      <dt>Review</dt><dd>{reviewLine(run)}</dd>
      {base && <><dt>Base</dt><dd className="break-all">{base}</dd></>}
      <dt>Files</dt><dd>{changed ? plural(changed, 'file') + ' changed' : 'no changes'}</dd>
      {run.landed && <><dt>Landed</dt><dd>{run.landed.target ? <>on {run.landed.target} at <Link href={`/runs/${run.landed.runId}`}>{run.landed.commit.slice(0, 12)}</Link></> : <Link href={`/runs/${run.landed.runId}`}>{(run.landed.linked ?? []).map(lane => `${lane.name} on ${lane.target}`).join(', ') || 'see landing'}</Link>}</dd></>}
      {run.landing && <><dt>Tasks</dt><dd><ul className="landing-items">{run.landing.items.map(item => <li key={item.runId}><Link href={`/runs/${item.runId}`}>{item.title}</Link> · {item.landedAs ?? run.landing.strategy}{item.resolutionRunId ? ', conflict resolved by its agent' : ''}{item.repairRunId ? ', check repaired by its agent' : ''}</li>)}</ul></dd></>}
      {run.delivery?.pr?.url && <><dt>Pull request</dt><dd><a href={run.delivery.pr.url} target="_blank" rel="noopener">#{run.delivery.pr.number ?? '?'}</a></dd></>}
      <LinkedFacts run={run}/>
    </dl>}
    {list.length > 0 && <ul className="verdict-warnings" aria-label="Warnings">{list.map(item => <li key={item}>{item}</li>)}</ul>}
    <RiskDecision decision={run.riskAssessments?.at(-1)} selection={run.riskSelection}/>
    {run.sqlToRun && <SqlBlock sql={run.sqlToRun}/>}
    <CiRepair run={run} onUpdate={onUpdate}/>
    <TrackerOffers run={run} onUpdate={onUpdate}/>
    <LinkOffer run={run} onUpdate={onUpdate}/>
    <BranchActions run={run}/>
    <WorktreeAction run={run} onUpdate={onUpdate}/>
  </section>;
}
