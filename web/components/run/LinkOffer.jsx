import { Button } from '@/components/ui/button';
import { api } from '@/lib/workspace';
import { useAction } from '@/lib/use-action';

export function LinkOffer({ run, onUpdate }) {
  const { busy, error, perform } = useAction();
  const offer = run.linkOffer;
  if (!offer) return null;
  const [first, second] = offer.names;
  const answer = path => perform(async () => { await api(path, { ids: offer.ids }); onUpdate({ ...run, linkOffer: null }); window.dispatchEvent(new Event('dispatch-refresh')); });
  return <div className="tracker-offer" aria-label="Link repositories">
    <p className="question-eyebrow">Changed together in {offer.count} tasks</p>
    <p>Link {first} and {second}? A task that starts in either one then brings the other along, each with its own worktree, checks and commit.</p>
    <div className="verdict-actions">
      <Button type="button" size="sm" disabled={busy} onClick={() => answer('/api/routing/link')}>Link them</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => answer('/api/routing/dismiss')}>Don't offer again</Button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
