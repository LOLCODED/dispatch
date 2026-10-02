import { useState } from 'react';
import { Eraser, X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { api, Link } from '@/lib/workspace';
import { scopeName } from '@/lib/brain.mjs';

export function ForgetCard({ query, matches, projects, onDone }) {
  const [remaining, setRemaining] = useState(matches), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const forget = async list => {
    setBusy(true); setError('');
    try { for (const entry of list) await api(`/api/brain/${entry.id}/delete`, {}); const left = remaining.filter(entry => !list.includes(entry)); setRemaining(left); if (!left.length) onDone?.(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  return <section className="repository-question forget-card" aria-label="Forget memory">
    <p>{remaining.length ? `Memory matching “${query}”:` : `Nothing left matching “${query}”.`} <Link href="/brain">Open the Brain</Link></p>
    {remaining.length > 0 && <ul className="forget-matches">{remaining.map(entry => <li key={entry.id}><span><strong>{entry.label}</strong> <span className="muted">{scopeName(entry.scope, projects)} · {entry.kind}</span></span><IconButton label="Forget" icon={Eraser} variant="outline" disabled={busy} onClick={() => forget([entry])}/></li>)}</ul>}
    <div className="verdict-actions">{remaining.length > 1 && <IconButton label="Forget all shown" icon={Eraser} variant="outline" disabled={busy} onClick={() => forget(remaining)}/>}<IconButton label="Close" icon={X} onClick={onDone}/></div>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
