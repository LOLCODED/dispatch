import { useState } from 'react';
import { HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link, preference, savePreference } from '@/lib/workspace';

const dismissalKey = 'dispatch-storage-alert-dismissed-until';

export function StorageAlert({ count }) {
  const [dismissedUntil, setDismissedUntil] = useState(() => Number(preference(dismissalKey, '0')));
  if (count < 8 || dismissedUntil > Date.now()) return null;
  const dismiss = () => {
    const until = Date.now() + 24 * 60 * 60 * 1000;
    savePreference(dismissalKey, String(until)); setDismissedUntil(until);
  };
  return <aside className="home-alert" aria-label="Storage alert">
    <HardDrive size={18} aria-hidden="true"/>
    <div><strong>Keep dispatch lightweight</strong><p>{count} completed tasks are at least 12 hours old. Consider deleting tasks you no longer need to free up storage.</p>
      <div className="home-alert-actions"><Button asChild variant="outline" size="sm"><Link href="/setup#storage">Review storage</Link></Button><Button type="button" variant="ghost" size="sm" onClick={dismiss}>Remind me tomorrow</Button></div>
    </div>
  </aside>;
}
