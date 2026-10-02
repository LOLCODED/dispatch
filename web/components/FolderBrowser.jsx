import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUp, Home, Server, FolderOpen, Check } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/workspace';

export function FolderBrowser({ onChoose, initialPath = '~' }) {
  const [path, setPath] = useState(initialPath), [target, setTarget] = useState(initialPath), [listing, setListing] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(''); setListing(null);
    api(`/api/folders?path=${encodeURIComponent(target)}`, undefined, controller.signal).then(data => { if (controller.signal.aborted) return; setListing(data); setPath(current => current === target ? data.path : current); }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [target]);
  const openFolder = next => { setPath(next); setTarget(next); };
  return <section className="folder-browser" aria-label="Local folders">
    <label htmlFor="folder-location">Folder location</label><div className="inline-field"><Input id="folder-location" value={path} onChange={e => setPath(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setTarget(path); } }}/><IconButton type="button" label="Go" icon={ArrowRight} variant="outline" onClick={() => setTarget(path)}/></div>
    {listing && <><div className="folder-actions"><IconButton type="button" label="Home" icon={Home} onClick={() => openFolder(listing.home)}/><IconButton type="button" label="Server folder" icon={Server} onClick={() => openFolder(listing.cwd)}/><IconButton type="button" label="Up" icon={ArrowUp} disabled={listing.parent === listing.path} onClick={() => openFolder(listing.parent)}/></div><p className="muted break-all">{listing.path}</p><div className="folder-list">{listing.folders.map(folder => <div className="folder-entry" key={folder.path}><span>{folder.name}</span><IconButton type="button" label={`Open ${folder.name}`} icon={FolderOpen} onClick={() => openFolder(folder.path)}/></div>)}{!listing.folders.length && <p className="muted">No subfolders.</p>}</div>{listing.truncated && <p className="muted">First 500 folders shown. Type a path to open another folder.</p>}<IconButton type="button" label="Choose this folder" icon={Check} variant="outline" onClick={() => onChoose(listing.path)}/></>}
    {busy && <p role="status">Loading folders…</p>}{error && <p className="error" role="alert">{error}</p>}
  </section>;
}
