import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { DiffView } from '@/components/DiffView';
import { IconButton, Tooltip } from '@/components/IconButton';
import { terminal } from '@/lib/workspace';
import { agentName } from '@/lib/providers.mjs';

function DiffActions({ run, working, reload }) {
  return <>
    {working && <Tooltip label={`Live · updates as ${agentName(run)} edits`}><span className="live-dot" tabIndex={0} aria-label="Live diff"/></Tooltip>}
    <IconButton label="Refresh diff" icon={RefreshCw} onClick={reload}/>
    <IconButton label="Open raw patch" icon={ArrowUpRight} href={`/api/runs/${run.id}/diff`} target="_blank" rel="noopener"/>
  </>;
}

export function DiffTile({ run, live, onReference }) {
  const { diff, error, reload } = live, working = !terminal.has(run.status);
  const actions = <DiffActions run={run} working={working} reload={reload}/>;
  if (!diff) return <div className="diff-tile"><div className="diff-toolbar"><span className="diff-file-name muted">{error && !error.startsWith('No live workspace') ? error : working ? 'Waiting for the workspace…' : 'Loading diff…'}</span>{actions}</div></div>;
  return <div className="diff-tile">
    {diff.stale && <p className="error">The workspace has changed since this evidence was recorded.</p>}
    <DiffView key={run.id} patch={diff.diff} onReference={onReference} actions={actions}/>
  </div>;
}
