import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, FolderPlus, GitBranch, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CommandTextarea } from '@/components/CommandTextarea';
import { IconButton } from '@/components/IconButton';
import { ModelPicker } from '@/components/ModelPicker';
import { RepositoryQuestion } from '@/components/work/RepositoryQuestion';
import { FolderPicker, useFolderTarget, withLinked } from '@/components/work/ComposerTargets';
import { ForgetCard } from '@/components/brain/ForgetCard';
import { ConnectorQuestion } from '@/components/work/ConnectorQuestion';
import { BranchQuestion } from '@/components/work/BranchQuestion';
import { parseCommand } from '@/lib/commands.mjs';
import { canAddProvider } from '@/lib/providers.mjs';
import { useAction } from '@/lib/use-action';
import { api, useWorkspace, preference, savePreference, navigate } from '@/lib/workspace';
import { Checkbox } from '@/components/Checkbox';
import { matches, submitOnShortcut } from '@/lib/keybinds.mjs';
import { usePreferences } from '@/lib/preferences';
import { executionKey, readExecution } from '@/lib/execution';
import { AttachmentDialog } from '@/components/work/AttachmentDialog';
import { attachPastedText, composerText, longPasteLength, ticketTextLimit } from '@/lib/composer-text.mjs';
import { AttachButton, AttachmentList, savedTaskImages, useAttachments } from '@/components/work/Attachments';
import { flyToTask } from '@/lib/dispatch-flight';
import { ticketReader } from '@/lib/connectors.mjs';

function useTicketDraft() {
  const [visible, setVisible] = useState(() => preference('dispatch-draft'));
  const [attachments, setAttachments] = useState(() => {
    try { const saved = JSON.parse(preference('dispatch-text-attachments') || '[]'); return Array.isArray(saved) && saved.every(text => typeof text === 'string') ? saved : []; } catch { return []; }
  });
  const save = (text, attached) => { setVisible(text); setAttachments(attached); savePreference('dispatch-draft', text); savePreference('dispatch-text-attachments', JSON.stringify(attached)); };
  return { visible, attachments, input: composerText(visible, attachments), save, clear: () => save('', []) };
}

function useModelChoice() {
  const [choice, setChoice] = useState(readExecution);
  return { choice, chooseModel: value => { setChoice(value); savePreference(executionKey, JSON.stringify(value)); } };
}

function NewRepositoryOffer({ offer, busy, onChange, onCreate }) {
  return <section className="repository-offer" aria-label="New repository">
    <p>New at <code className="break-all">{offer.path}</code> · a Git repository (folder, git init) or a plain folder (no Git); either starts with the browser smoke check</p>
    <Checkbox checked={offer.access} onChange={access => onChange({ ...offer, access })}>Full access for this project: the agent can install packages (no sandbox, network on)</Checkbox>
    <div className="verdict-actions"><IconButton label="Create repository" icon={GitBranch} variant="default" disabled={busy} onClick={() => onCreate(true)}/><IconButton label="Create folder (no Git)" icon={FolderPlus} variant="outline" disabled={busy} onClick={() => onCreate(false)}/></div>
  </section>;
}

function Feedback({ notice, error, question, offer, forget, projects, busy, onChoose, onUsePath, onOfferChange, onCreate, onForgetDone, onConnector, onBranch }) {
  return <div className="composer-feedback">
    {forget && <ForgetCard query={forget.query} matches={forget.matches} projects={projects} onDone={onForgetDone}/>}
    <AnimatePresence mode="wait">{question?.kind === 'connector' && <ConnectorQuestion key="connector" question={question} busy={busy} onChoose={onConnector}/>}{question?.kind === 'branch' && <BranchQuestion key="branch" question={question} busy={busy} onChoose={onBranch}/>}{question && !['connector', 'branch'].includes(question.kind) && !offer && <RepositoryQuestion key={question.text} question={question} busy={busy} onChoose={onChoose} onUsePath={onUsePath}/>}</AnimatePresence>
    {offer && <NewRepositoryOffer offer={offer} busy={busy} onChange={onOfferChange} onCreate={onCreate}/>}
    {notice && <p className="muted" role="status">{notice}</p>}
    {error && !question && <p className="error" role="alert">{error}</p>}
  </div>;
}

const blankSelection = { mode: 'auto', ids: [] };

async function fileInto(key, folderId) {
  if (!folderId) return;
  try { await api(`/api/board/items/${key}`, { folderId }); } catch { /* Filing is best-effort; the work already exists and can be moved from the list. */ }
}

export function Composer({ taskRef, hints }) {
  const { state } = useWorkspace(), { keybinds, afterDispatch } = usePreferences(), settings = useModelChoice();
  const { busy, error, setError, question, setQuestion, perform } = useAction();
  const draft = useTicketDraft(), { input } = draft;
  const [editingText, setEditingText] = useState(null);
  const [notice, setNotice] = useState(''), [announcement, setAnnouncement] = useState(''), [selection, setSelection] = useState(blankSelection), [offer, setOffer] = useState(null), [forget, setForget] = useState(null);
  const attachments = useAttachments('home', setError), reading = attachments.documents.reading;
  const command = parseCommand(input), asksRepository = !command || command.name === 'todo';
  const selected = selection.ids[0], folder = useFolderTarget(state, input);
  const canDispatch = command?.name === 'todo' ? Boolean(command.text) : Boolean(command || !question);
  const changeDraft = (visible, attachments) => {
    if (composerText(visible, attachments).length > ticketTextLimit) { setError('Ticket text including attachments must be at most 12,000 characters.'); return; }
    draft.save(visible, attachments); setQuestion(null); setOffer(null); setError(''); setNotice(''); setAnnouncement('');
    if (!composerText(visible, attachments).trim()) setSelection(blankSelection);
  };
  const updateInput = value => { changeDraft(value, []); if (!value) folder.reset(); };
  const paste = event => {
    if (attachments.pasted.paste(event)) return;
    const text = event.clipboardData.getData('text/plain');
    if (text.length < longPasteLength) return;
    event.preventDefault();
    const next = attachPastedText(draft.visible, draft.attachments, text, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
    if (!next) { setError('Ticket text including attachments must be at most 12,000 characters.'); return; }
    changeDraft(next.visible, next.attachments);
  };
  const chooseProject = id => { setSelection(id === 'all' ? { mode: 'agent', ids: [] } : { mode: 'manual', ids: withLinked(id, state.projects) }); setQuestion(null); setOffer(null); setError(''); };
  const request = { projectId: selected ?? 'auto', ...(selection.mode === 'agent' ? { projectIds: 'all' } : selection.ids.length ? { projectIds: selection.ids } : {}), input, execution: settings.choice ?? 'auto' };
  const runCommand = () => perform(async () => {
    if (!command.text) { navigate('/brain'); return; }
    const result = await api('/api/brain/forget', { text: command.text, ...(selected ? { projectId: selected } : {}) });
    setForget({ query: command.text, matches: result.matches });
  });
  const dispatch = (override = {}, stay = afterDispatch === 'stay') => perform(async () => {
    const run = await api('/api/runs', { ...request, ...attachments.payload(), ...override, mode: 'live' }); await fileInto(run.id, folder.folderId);
    if (!stay) { draft.clear(); attachments.clear(); navigate(`/runs/${run.id}`); return; }
    flyToTask(taskRef.current, run.id, input); updateInput(''); attachments.clear(); setAnnouncement('Dispatched.'); window.dispatchEvent(new Event('dispatch-refresh'));
  });
  const send = stay => { if (busy || reading || !canDispatch || !input.trim()) return; if (command?.name === 'todo') { saveTask(command.text); return; } if (command) { runCommand(); return; } dispatch({}, stay); };
  const submit = event => { event.preventDefault(); send(); };
  const onKeyDown = event => { if (matches(event, keybinds.sendAndStay)) { event.preventDefault(); send(true); return; } submitOnShortcut(event, keybinds.send); };
  const chooseConnector = choice => {
    if (choice === 'text') { setQuestion(null); updateInput(''); return; }
    const enable = () => choice === 'global' ? api('/api/brain', { kind: 'connector', scope: 'global', key: `connector.${question.tracker}` }) : api(`/api/projects/${question.projectId}/connectors`, { [question.tracker]: { enabled: true } });
    perform(async () => { await enable(); window.dispatchEvent(new Event('dispatch-refresh')); setQuestion(null); chooseProject(question.projectId); await dispatch({ projectId: question.projectId, projectIds: withLinked(question.projectId, state.projects) }); });
  };
  const chooseBranch = branch => { setQuestion(null); dispatch({ branch }); };
  const saveTask = (text = input) => perform(async () => { const task = await api('/api/tasks', { ...request, input: text, ...savedTaskImages(attachments) }); await fileInto(task.id, folder.folderId); updateInput(''); attachments.clear(); setNotice('Task saved to Todo.'); window.dispatchEvent(new Event('dispatch-refresh')); });
  const openRepositoryPath = async (path, select = chooseProject) => {
    let info; try { info = await api('/api/projects/inspect', { repositoryPath: path }); } catch (failure) { if (/does not exist/.test(failure.message)) { setOffer({ path, access: true }); return; } throw failure; }
    const saved = state.projects.find(project => project.repositoryPath === info.repositoryPath); if (saved) select(saved.id); else navigate(`/admin/projects/new?path=${encodeURIComponent(info.repositoryPath)}`);
  };
  const chooseRepositoryPath = path => perform(() => openRepositoryPath(path));
  const createRepository = git => perform(async () => { const project = await api('/api/projects/create', { repositoryPath: offer.path, confirmed: true, access: offer.access ? 'full' : 'inherit', git }); window.dispatchEvent(new Event('dispatch-refresh')); chooseProject(project.id); setNotice(`Created ${project.name}${git ? '' : ' as a plain folder'}; the browser smoke check is its only check until you add more.`); });
  const readsTracker = ticketReader(state.connectors, state.projects.find(project => project.id === selected)?.connectors);
  const placeholder = readsTracker ? `Paste a ${readsTracker.name} link, or describe the change…` : 'Describe a change or ask a question… (/todo saves it for later, /forget edits memory)';
  return <>
    <form className="composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="task-input">Ticket or instructions</label>
      <CommandTextarea ref={taskRef} id="task-input" value={draft.visible} onChange={event => changeDraft(event.target.value, draft.attachments)} placeholder={placeholder} maxLength={Math.max(0, ticketTextLimit - (input.length - draft.visible.length) - (!draft.visible && draft.attachments.some(Boolean) ? 2 : 0))} required={!draft.attachments.some(text => text.trim())} rows={3} onKeyDown={onKeyDown} onPaste={paste}/>
      {draft.attachments.length > 0 && <ul className="composer-texts" aria-label="Attached text">{draft.attachments.map((text, index) => <li key={index}>
        <Button type="button" variant="ghost" onClick={() => setEditingText(index)}>Pasted text {index + 1} · {text.length.toLocaleString()} characters</Button>
        <IconButton label={`Remove text ${index + 1}`} icon={X} onClick={() => changeDraft(draft.visible, draft.attachments.filter((_, item) => item !== index))}/>
      </li>)}</ul>}
      <AttachmentList attachments={attachments} busy={busy}/>
      <div className="composer-bar">
        <div className="composer-pickers">
          <ModelPicker value={settings.choice} models={state.modelCatalog?.models ?? []} disabled={busy} addProvider={canAddProvider(state.modelCatalog, state.providerSettings)} onChange={settings.chooseModel}/>
        </div>
        <div className="composer-actions">
          <AttachButton attachments={attachments} disabled={busy}/>
          <Button type="submit" disabled={busy || reading || !canDispatch}>{busy ? 'dispatching…' : command?.name === 'todo' ? 'Save task' : command ? 'Forget' : 'dispatch'}<ArrowUpRight aria-hidden="true"/></Button>
        </div>
      </div>
    </form>
    {editingText !== null && <AttachmentDialog editor title={`Edit pasted text ${editingText + 1}`} onClose={() => setEditingText(null)}>
      <Textarea aria-label="Attached text" value={draft.attachments[editingText]} maxLength={Math.max(0, ticketTextLimit - (input.length - draft.attachments[editingText].length))} onChange={event => changeDraft(draft.visible, draft.attachments.map((text, index) => index === editingText ? event.target.value : text))}/>
      <Button type="button" onClick={() => setEditingText(null)}>Done</Button>
    </AttachmentDialog>}
    <motion.div layout="position" className="composer-note">
      {asksRepository && <div className="composer-pickers composer-targets">
        <FolderPicker target={folder} disabled={busy}/>
      </div>}
      {hints}
    </motion.div>
    <p className="sr-only" role="status">{announcement}</p>
    <Feedback notice={notice} error={error} question={asksRepository ? question : null} offer={offer} forget={forget} projects={state.projects} busy={busy} onChoose={chooseProject} onUsePath={chooseRepositoryPath} onOfferChange={setOffer} onCreate={createRepository} onForgetDone={() => { setForget(null); updateInput(''); }} onConnector={chooseConnector} onBranch={chooseBranch}/>
  </>;
}
