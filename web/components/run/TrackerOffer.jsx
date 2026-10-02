import { useState } from 'react';
import { BellOff, Check, Eraser, SkipForward, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/IconButton';
import { Checkbox } from '@/components/Checkbox';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/workspace';
import { useAction } from '@/lib/use-action';

const workItem = offer => offer.reference ?? `#${offer.ticketId}`;

function PendingOffer({ run, offer, onUpdate }) {
  const { busy, error, perform } = useAction();
  const [everywhere, setEverywhere] = useState(false), [custom, setCustom] = useState('');
  const answer = (value, confirmed = false) => perform(async () => { const next = await api(`/api/runs/${run.id}/offers/${offer.id}`, { value, scope: everywhere ? 'global' : 'project', confirmed }); onUpdate({ ...run, offers: run.offers.map(item => item.id === next.id ? next : item) }); });
  const label = offer.changedRevision ? `Move ${workItem(offer)} anyway?` : `Move ${workItem(offer)} from ${offer.current ?? 'its current state'} to…`;
  return <div className="tracker-offer" aria-label="Move the work item">
    <p className="question-eyebrow">{offer.trackerName}{offer.mode === 'suggest' ? ' · suggested from your earlier answers' : ''}</p>
    <p>{label}</p>
    <div className="verdict-actions connector-options">
      {offer.options.map(state => <Button key={state} type="button" size="sm" variant={state === offer.suggested ? 'default' : 'outline'} disabled={busy} onClick={() => answer(state, Boolean(offer.changedRevision))}>{state}{state === offer.suggested ? ' · suggested' : ''}</Button>)}
      {offer.suggested && !offer.options.includes(offer.suggested) && <Button type="button" size="sm" disabled={busy} onClick={() => answer(offer.suggested, Boolean(offer.changedRevision))}>{offer.suggested} · suggested</Button>}
    </div>
    <div className="inline-field"><Input aria-label="Other state" value={custom} placeholder="Other state…" onChange={event => setCustom(event.target.value)} maxLength={100}/><IconButton label="Move" icon={Check} variant="outline" disabled={busy || !custom.trim()} onClick={() => answer(custom.trim(), Boolean(offer.changedRevision))}/></div>
    <div className="verdict-actions">
      <Checkbox checked={everywhere} onChange={setEverywhere}>Remember for every repository</Checkbox>
      <IconButton label="Skip" icon={SkipForward} disabled={busy} onClick={() => answer('skip')}/>
      <IconButton label="Never ask here" icon={BellOff} disabled={busy} onClick={() => answer('never')}/>
    </div>
    {(offer.error || error) && <p className="error" role="alert">{error || offer.error}</p>}
  </div>;
}

function AppliedOffer({ run, offer, onUpdate }) {
  const { busy, error, perform } = useAction();
  const undo = () => perform(async () => { const next = await api(`/api/runs/${run.id}/offers/${offer.id}/undo`, {}); onUpdate({ ...run, offers: run.offers.map(item => item.id === next.id ? next : item) }); });
  const forget = () => perform(async () => { await api(`/api/brain/${offer.preferenceId}/delete`, {}); onUpdate({ ...run, offers: run.offers.map(item => item.id === offer.id ? { ...item, preferenceId: null } : item) }); });
  return <div className="tracker-offer" aria-label="Work item moved">
    <p>{offer.trackerName} work item {workItem(offer)} moved from {offer.result.previous ?? 'its previous state'} to <strong>{offer.result.value}</strong>{offer.result.auto ? ' automatically, from your remembered preference' : ''}.</p>
    <div className="verdict-actions"><IconButton label="Undo" icon={Undo2} variant="outline" disabled={busy} onClick={undo}/>{offer.preferenceId && <IconButton label="Forget this preference" icon={Eraser} disabled={busy} onClick={forget}/>}</div>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

export function TrackerOffers({ run, onUpdate }) {
  const offers = (run.offers ?? []).filter(offer => offer.kind === 'tracker.set-state');
  if (!offers.length) return null;
  return <div className="tracker-offers">{offers.map(offer => offer.status === 'pending' ? <PendingOffer key={offer.id} run={run} offer={offer} onUpdate={onUpdate}/> : offer.status === 'applied' ? <AppliedOffer key={offer.id} run={run} offer={offer} onUpdate={onUpdate}/> : <p key={offer.id} className="muted">{offer.status === 'undone' ? `${workItem(offer)} moved back to ${offer.result?.previous}.` : `${workItem(offer)} left in ${offer.current ?? 'its state'}.`}</p>)}</div>;
}
