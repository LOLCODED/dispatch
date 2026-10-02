import { useEffect, useState } from 'react';
import { api, Link } from '@/lib/workspace';

export function NotesTab({ id, enabled }) {
  const [memory, setMemory] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    if (!id || !enabled) return;
    const controller = new AbortController();
    api(`/api/projects/${id}/memory`, undefined, controller.signal).then(setMemory).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [id, enabled]);
  if (!enabled) return <section className="tab-section"><p className="muted">Notes are off. Turn on "Remember things" under Extras.</p></section>;
  if (!id) return <section className="tab-section"><p className="muted">Notes appear after the first task finishes.</p></section>;
  return <section className="tab-section">
    <p className="muted">What dispatch learned here. Manage it in <Link href="/brain">Brain</Link>, or edit the files under <code className="break-all">{memory?.path ?? '…'}</code>.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {memory && (memory.notes ? <pre className="notes-text">{memory.notes}</pre> : <p className="muted">No notes yet. They appear after the first task finishes.</p>)}
    {!!memory?.tasks?.length && <details className="technical"><summary>Recent tasks</summary>{memory.tasks.slice().reverse().map(task => <p key={task.runId}>{task.at?.slice(0, 10)} · {task.title} · {task.status} · {task.filesChanged} files</p>)}</details>}
  </section>;
}
