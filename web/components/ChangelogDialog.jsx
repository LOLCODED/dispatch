import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Badge } from '@/components/ui/badge';
import { api, preference, savePreference } from '@/lib/workspace';
import { version } from '../../package.json';

const seenKey = 'dispatch-seen-version';
const groupTones = { Features: 'success', Fixes: 'attention', Performance: 'active', Reverts: 'attention' };

const changelogQuery = (since, all) => all ? '?all=1' : since ? `?since=${encodeURIComponent(since)}` : '';

function useChangelog(since, all) {
  const [releases, setReleases] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api(`/api/changelog${changelogQuery(since, all)}`, undefined, controller.signal).then(value => setReleases(value.releases)).catch(reason => { if (!controller.signal.aborted) { setReleases([]); setError(reason.message); } });
    return () => controller.abort();
  }, [since, all]);
  return { releases, error };
}

function Release({ release }) {
  return <section className="changelog-release" aria-label={`Version ${release.version}`}>
    <h3>{release.version}<span className="muted">{release.date}</span></h3>
    {release.groups.length ? release.groups.map(group => <div key={group.label} className="changelog-group">
      <h4>{group.label}</h4>
      <ul>{group.entries.map(entry => <li key={entry.sha} className={`tone-${entry.breaking ? 'danger' : groupTones[group.label] ?? 'muted'}`}>
        {entry.breaking && <Badge variant="destructive">Breaking</Badge>}
        {entry.scope && <span className="changelog-scope">{entry.scope}</span>}
        <span>{entry.description}</span>
      </li>)}</ul>
    </div>) : <p className="muted">No changes recorded.</p>}
  </section>;
}

export function ChangelogDialog({ since = null, all = false, onClose, closeWhenEmpty = false }) {
  const returnFocus = useRef(document.activeElement), { releases, error } = useChangelog(since, all);
  useEffect(() => { if (closeWhenEmpty && releases && !releases.length) onClose(); }, [closeWhenEmpty, releases, onClose]);
  if (closeWhenEmpty && !releases?.length) return null;
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="attachment-overlay"/>
      <Dialog.Content className="land-dialog changelog-dialog" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus?.(); }}>
        <div className="section-heading"><Dialog.Title>Release Notes</Dialog.Title><IconButton label="Close" icon={X} onClick={onClose}/></div>
        {releases === null ? <p className="muted">Reading release notes…</p> : releases.length ? releases.map(release => <Release key={release.version} release={release}/>) : <p className="muted">No release notes for this version.</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function WhatsNew() {
  const [since] = useState(() => preference(seenKey)), [open, setOpen] = useState(() => Boolean(since) && since !== version);
  useEffect(() => { if (!since) savePreference(seenKey, version); }, [since]);
  const close = () => { savePreference(seenKey, version); setOpen(false); };
  return open ? <ChangelogDialog since={since} closeWhenEmpty onClose={close}/> : null;
}
