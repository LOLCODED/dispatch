import { useState } from 'react';
import { GitPullRequestArrow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link, preference, savePreference } from '@/lib/workspace';

const dismissalKey = 'dispatch-review-alert-dismissed-until', limit = 5;

export function ReviewAlert({ count }) {
  const [dismissedUntil, setDismissedUntil] = useState(() => Number(preference(dismissalKey, '0')));
  if (count <= limit || dismissedUntil > Date.now()) return null;
  const dismiss = () => {
    const until = Date.now() + 24 * 60 * 60 * 1000;
    savePreference(dismissalKey, String(until)); setDismissedUntil(until);
  };
  return <aside className="home-alert" aria-label="Review backlog alert">
    <GitPullRequestArrow size={18} aria-hidden="true"/>
    <div><strong>Tasks are waiting for review</strong><p>{count} tasks are ready for review and not yet landed, published or marked done. Create pull requests, land them, or mark them done.</p>
      <div className="home-alert-actions"><Button asChild variant="outline" size="sm"><Link href="/#tasks">Review tasks</Link></Button><Button type="button" variant="ghost" size="sm" onClick={dismiss}>Remind me tomorrow</Button></div>
    </div>
  </aside>;
}
