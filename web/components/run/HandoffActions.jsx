import { useState } from 'react';
import { GitMerge, GitPullRequest } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { LandDialog } from '@/components/LandDialog';
import { PullRequestDialog } from '@/components/PullRequestDialog';

export function HandoffActions({ run }) {
  const [dialog, setDialog] = useState(null), close = () => setDialog(null);
  if (!run.landable && !run.publishable) return null;
  return <>
    {run.landable && <IconButton label="Land on a branch" icon={GitMerge} onClick={() => setDialog('land')}/>}
    {run.publishable && <IconButton label="Open draft pull request" icon={GitPullRequest} onClick={() => setDialog('pull-request')}/>}
    {dialog === 'land' && <LandDialog runs={[run]} onClose={close}/>}
    {dialog === 'pull-request' && <PullRequestDialog runs={[run]} onClose={close}/>}
  </>;
}
