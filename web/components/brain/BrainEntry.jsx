import { Eraser } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Checkbox } from '@/components/Checkbox';
import { Select } from '@/components/Select';
import { Link } from '@/lib/workspace';
import { provenance, sourceLabels } from '@/lib/brain.mjs';

export function BrainEntry({ entry, busy, onToggle, onMode, onForget }) {
  const runId = entry.origin?.runId ?? entry.lastRunId;
  return <li className={`brain-entry ${entry.enabled ? '' : 'is-disabled'}`}>
    <div className="brain-entry-main">
      <p className="brain-entry-label">{entry.label}</p>
      <p className="brain-entry-meta">
        <span className="meta-chip">{sourceLabels[entry.source] ?? entry.source}</span>
        {entry.kind === 'preference' && <span className="meta-chip">{entry.mode}{entry.pinned ? ' · pinned' : ''}</span>}
        {entry.section && <span className="meta-chip">{entry.section}</span>}
        <span className="muted">{provenance(entry)}{runId && <> · <Link href={`/runs/${runId}`}>run</Link></>}</span>
      </p>
    </div>
    <div className="brain-entry-actions">
      {entry.kind === 'preference' && !entry.projected && <Select aria-label={`Mode for ${entry.label}`} value={entry.mode} disabled={busy} onChange={event => onMode(entry, event.target.value)}><option value="ask">Ask</option><option value="suggest">Suggest</option><option value="auto">Auto</option></Select>}
      <Checkbox checked={entry.enabled} disabled={busy} onChange={enabled => onToggle(entry, enabled)}>Enabled</Checkbox>
      <IconButton label="Forget" icon={Eraser} variant="outline" disabled={busy} onClick={() => onForget(entry)}/>
    </div>
  </li>;
}
