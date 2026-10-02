import { useState } from 'react';
import { ArrowUpRight, Eraser, ListPlus, Square } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { RunModel } from '@/components/run/RunModel';
import { Textarea } from '@/components/ui/textarea';
import { referenceType } from '@/components/run/Artifacts';
import { useAction } from '@/lib/use-action';
import { api, navigate, terminal } from '@/lib/workspace';
import { acceptSuggestion, suggestedReply } from '@/lib/suggestion.mjs';
import { ForgetCard } from '@/components/brain/ForgetCard';
import { parseCommand } from '@/lib/commands.mjs';
import { useWorkspace } from '@/lib/workspace';
import { submitOnShortcut } from '@/lib/keybinds.mjs';
import { usePreferences } from '@/lib/preferences';
import { AttachButton, AttachmentList, useAttachments } from '@/components/work/Attachments';

export const appendReference = (draft, reference) => `${draft.trimEnd()}${draft.trim() ? '\n' : ''}${reference}\n`;

function useReferenceDrop(setDraft) {
  const [over, setOver] = useState(false);
  const accepts = event => event.dataTransfer.types.includes(referenceType);
  return { over, handlers: {
    onDragOver: event => { if (!accepts(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setOver(true); },
    onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(false); },
    onDrop: event => { setOver(false); if (!accepts(event)) return; event.preventDefault(); setDraft(current => appendReference(current, event.dataTransfer.getData(referenceType))); },
  } };
}

export function composerMode(run) {
  if (terminal.has(run.status)) return run.sessionId ? 'followup' : 'unavailable';
  return run.sessionId ? 'interrupt' : 'starting';
}

const placeholders = {
  followup: 'Add a detail, answer a question, or ask for a change…',
  interrupt: 'Redirect the agent — sending stops this turn and continues with your note…',
  starting: 'Draft your next instruction — you can interrupt once the agent session starts…',
  unavailable: 'Draft your next instruction — reference diff lines or drop screenshots here…',
};

function SubmitButton({ mode, command, question, disabled }) {
  const [label, icon] = command?.name === 'todo' ? ['Save task to Todo', ListPlus] : command ? ['Forget', Eraser] : mode === 'interrupt' ? ['Interrupt', Square] : [question ? 'Answer' : 'Continue', ArrowUpRight];
  return <IconButton type="submit" variant="default" label={label} icon={icon} disabled={disabled}/>;
}

export function RunComposer({ run, question, draft, setDraft, composerRef, onUpdate }) {
  const [forget, setForget] = useState(null), [savedTask, setSavedTask] = useState('');
  const { state } = useWorkspace(), { keybinds } = usePreferences(), command = question ? null : parseCommand(draft);
  const { busy, error, setError, perform } = useAction(), drop = useReferenceDrop(setDraft);
  const attachments = useAttachments(`run:${run.id}`, setError), reading = attachments.documents.reading;
  const mode = composerMode(run), canSend = mode === 'followup' || mode === 'interrupt', suggestion = mode === 'followup' ? suggestedReply(run) : null;
  const submit = event => {
    event.preventDefault();
    if (command?.name === 'todo') { perform(async () => { if (!command.text) throw new Error('Describe the task after /todo.'); const task = await api('/api/tasks', { projectId: run.projectId, input: command.text, sourceRunId: run.id }); setDraft(''); setSavedTask(task.title); window.dispatchEvent(new Event('dispatch-refresh')); }); return; }
    if (command) { if (!command.text) { navigate('/brain'); return; } perform(async () => { const result = await api('/api/brain/forget', { text: command.text, projectId: run.projectId }); setForget({ query: command.text, matches: result.matches }); }); return; }
    if (!canSend || !draft.trim() || reading) return;
    perform(async () => { const next = await api(`/api/runs/${run.id}/${mode === 'interrupt' ? 'interrupt' : 'followup'}`, { input: draft, ...attachments.payload() }); setDraft(''); attachments.clear(); onUpdate(next); navigate(`/runs/${next.id}`); });
  };
  const keys = event => { submitOnShortcut(event, keybinds.send); acceptSuggestion(event, suggestion, draft, setDraft); };
  const change = event => { setDraft(event.target.value); setSavedTask(''); };
  return <form onSubmit={submit} onPaste={attachments.pasted.paste} className={`composer run-composer ${drop.over ? 'is-drop-target' : ''}`} {...drop.handlers}>
    <label className="sr-only" htmlFor="followup-input">{question ? 'Your answer' : 'Continue this ticket'}</label>
    <Textarea ref={composerRef} id="followup-input" value={draft} onChange={change} onKeyDown={keys} placeholder={suggestion ?? placeholders[mode]} aria-describedby={suggestion ? 'followup-suggestion' : undefined} maxLength={12000} rows={2}/>
    <AttachmentList attachments={attachments} busy={busy}/>
    {forget && <ForgetCard query={forget.query} matches={forget.matches} projects={state.projects} onDone={() => { setForget(null); setDraft(''); }}/>}
    <div className="composer-bar">
      <div className="composer-pickers">{run.kind !== 'landing' && <RunModel run={run} disabled={busy} onUpdate={onUpdate} onError={setError}/>}</div>
      <div className="composer-actions">
        {suggestion && !question && !draft.trim() && <small id="followup-suggestion" className="suggestion-hint"><kbd>Tab</kbd> to use</small>}
        {!command && <AttachButton attachments={attachments} disabled={busy}/>}
        <SubmitButton mode={mode} command={command} question={question} disabled={busy || (command ? command.name === 'todo' && !command.text : !canSend || !draft.trim() || reading)}/>
      </div>
    </div>
    {savedTask && <p className="muted" role="status">Saved to Todo: {savedTask}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}
