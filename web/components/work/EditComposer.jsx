import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { IconButton } from '@/components/IconButton';
import { ModelPicker } from '@/components/ModelPicker';
import { useAction } from '@/lib/use-action';
import { api, useWorkspace } from '@/lib/workspace';
import { canAddProvider } from '@/lib/providers.mjs';
import { submitOnShortcut } from '@/lib/keybinds.mjs';
import { usePreferences } from '@/lib/preferences';

export function EditComposer({ target, taskRef, onDone }) {
  const { state } = useWorkspace(), { keybinds } = usePreferences(), { busy, error, perform } = useAction();
  const [draft, setDraft] = useState(null), path = `/api/${target.kind}/${target.id}/edit`;
  useEffect(() => {
    setDraft(null);
    perform(async () => { setDraft(await api(path)); requestAnimationFrame(() => taskRef.current?.focus()); });
  }, [path, perform, taskRef]);
  const submit = event => {
    event.preventDefault();
    if (busy || !draft?.input.trim()) return;
    perform(async () => { await api(path, { input: draft.input, execution: draft.execution ?? 'auto' }); window.dispatchEvent(new Event('dispatch-refresh')); onDone(); });
  };
  return <>
    <form className="composer" onSubmit={submit} aria-label={draft ? `Edit ${draft.title}` : 'Edit task'}>
      <label className="sr-only" htmlFor="task-input">Task instructions</label>
      <Textarea ref={taskRef} id="task-input" value={draft?.input ?? ''} disabled={!draft} onChange={event => setDraft({ ...draft, input: event.target.value })} onKeyDown={event => event.key === 'Escape' ? onDone() : submitOnShortcut(event, keybinds.send)} maxLength={12000} required rows={3}/>
      <div className="composer-bar">
        <div className="composer-pickers">
          <ModelPicker value={draft?.execution ?? null} models={state.modelCatalog?.models ?? []} disabled={busy || !draft} addProvider={canAddProvider(state.modelCatalog, state.providerSettings)} onChange={execution => setDraft({ ...draft, execution })}/>
        </div>
        <div className="composer-actions">
          <IconButton type="button" label="Cancel edit" icon={X} disabled={busy} onClick={onDone}/>
          <IconButton type="submit" variant="default" label="Save changes" icon={Check} disabled={busy || !draft?.input.trim()}/>
        </div>
      </div>
    </form>
    {error && <div className="composer-feedback"><p className="error" role="alert">{error}</p></div>}
  </>;
}
