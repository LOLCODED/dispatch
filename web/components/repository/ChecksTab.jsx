import { useRef, useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { SwitchRow } from '@/components/Switch';
import { Checkbox } from '@/components/Checkbox';
import { Input } from '@/components/ui/input';
import { commandLine } from '@/lib/recipe-text.mjs';
import { longRunningScript, npmScript } from '@/lib/recipe-roles.mjs';
import { NoChoiceWarning } from '@/components/repository/RiskTab';
import { checkIds, commandStep, editCommand, installStep, isInstall, scriptCheck, localFileChoices, scriptDescription, unsuitableScripts, unusedScripts } from '@/lib/project-form.mjs';

const minutes = step => Math.round((step.timeoutSeconds ?? 300) / 60);

function StepEditor({ step, onChange, onDone }) {
  const [line, setLine] = useState(commandLine(step));
  return <div className="step-editor">
    <Input aria-label="Command" value={line} onChange={event => { setLine(event.target.value); onChange(editCommand(step, event.target.value)); }}/>
    <label className="step-minutes">Time limit <Input type="number" min={1} max={30} aria-label="Time limit in minutes" value={minutes(step)} onChange={event => onChange({ ...step, timeoutSeconds: Math.min(30, Math.max(1, Number(event.target.value) || 1)) * 60 })}/> min</label>
    <Checkbox checked={step.browser === true} onChange={browser => onChange({ ...step, browser: browser || undefined })}>Opens a browser (Playwright)</Checkbox>
    <IconButton type="button" label="Done" icon={Check} onClick={onDone}/>
  </div>;
}

function StepRow({ step, onChange, onRemove }) {
  const [editing, setEditing] = useState(false), script = npmScript(step), line = commandLine(step);
  const actions = <><small className="row-meta">up to {minutes(step)} min</small><IconButton type="button" label={`Edit ${line}`} icon={Pencil} aria-pressed={editing} onClick={() => setEditing(!editing)}/>{!script && <IconButton type="button" label={`Remove ${line}`} icon={Trash2} onClick={onRemove}/>}</>;
  return <li>
    {script ? <SwitchRow label={<code>{line}</code>} checked onChange={onRemove}>{actions}</SwitchRow> : <div className="switch-row"><span className="row-bullet" aria-hidden="true"/><div className="switch-text"><code>{line}</code></div>{actions}</div>}
    {longRunningScript(script) && <p className="muted row-note" role="status">Long-running script; it will not finish as a check.</p>}
    {editing && <StepEditor step={step} onChange={onChange} onDone={() => setEditing(false)}/>}
  </li>;
}

function AddCommand({ label, taken, onAdd }) {
  const [line, setLine] = useState('');
  const add = () => { const step = commandStep(line, taken); if (step) { onAdd(step); setLine(''); } };
  return <div className="add-row"><Input className="mono-input" aria-label={label} placeholder={label} value={line} onChange={event => setLine(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}/><IconButton type="button" label={label} icon={Plus} variant="outline" disabled={!line.trim()} onClick={add}/></div>;
}

function StepList({ steps, onSteps }) {
  const replace = (index, step) => onSteps(steps.map((item, position) => position === index ? step : item));
  return steps.map((step, index) => <StepRow key={step.id} step={step} onChange={next => replace(index, next)} onRemove={() => onSteps(steps.filter((_, position) => position !== index))}/>);
}

// Switching a script check on or off keeps its row where it was; moving it between groups put another row under the pointer.
function useStableOrder(keys) {
  const seen = useRef([]);
  for (const key of keys) if (!seen.current.includes(key)) seen.current.push(key);
  return [...keys].sort((a, b) => seen.current.indexOf(a) - seen.current.indexOf(b));
}

function CheckRows({ form, info, onSteps }) {
  const steps = form.validation, unused = unusedScripts(info, form);
  const rows = new Map([...steps.map((step, index) => [npmScript(step) ?? `step:${step.id}`, { step, index }]), ...unused.map(script => [script, { script }])]);
  const replace = (index, step) => onSteps(steps.map((item, position) => position === index ? step : item));
  return useStableOrder([...rows.keys()]).map(key => {
    const { step, index, script } = rows.get(key);
    return step
      ? <StepRow key={key} step={step} onChange={next => replace(index, next)} onRemove={() => onSteps(steps.filter((_, position) => position !== index))}/>
      : <li key={key}><SwitchRow label={<code>npm run {script}</code>} description={scriptDescription(info, script)} checked={false} onChange={() => onSteps([...steps, scriptCheck(script)])}/></li>;
  });
}

function LocalFiles({ form, update, info }) {
  const [path, setPath] = useState(''), chosen = form.localFiles ?? [];
  const toggle = (file, on) => update({ localFiles: on ? [...chosen, file] : chosen.filter(item => item !== file) });
  const add = () => { const file = path.trim(); if (file && !chosen.includes(file)) update({ localFiles: [...chosen, file] }); setPath(''); };
  return <section className="tab-section"><h3>Copied from your checkout</h3><p className="muted">Files Git ignores, such as <code>.env.test</code>, never reach a fresh copy. dispatch copies these into each task's copy before setup; files Git would commit are skipped.</p>
    <ul className="row-list">{localFileChoices(info, form).map(file => <li key={file}><SwitchRow label={<code>{file}</code>} checked={chosen.includes(file)} onChange={on => toggle(file, on)}/></li>)}</ul>
    <div className="add-row"><Input className="mono-input" aria-label="Add a file to copy" placeholder="Add a file to copy" value={path} onChange={event => setPath(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}/><IconButton type="button" label="Add a file to copy" icon={Plus} variant="outline" disabled={!path.trim()} onClick={add}/></div>
  </section>;
}

function Setup({ form, update, info }) {
  const offerInstall = info.suggestInstall && !form.setup.some(isInstall);
  return <section className="tab-section"><h3>Before each run</h3><p className="muted">Prepares a fresh copy of the repository before the agent starts.</p>
    <ul className="row-list"><StepList steps={form.setup} onSteps={setup => update({ setup })}/>{offerInstall && <li><SwitchRow label={<code>npm ci</code>} description="Install packages" checked={false} onChange={() => update({ setup: [installStep(), ...form.setup] })}/></li>}</ul>
    <AddCommand label="Add a setup command" taken={form.setup.map(step => step.id)} onAdd={step => update({ setup: [...form.setup, step] })}/>
  </section>;
}

function Unsuitable({ info }) {
  const scripts = unsuitableScripts(info);
  if (!scripts.length) return null;
  return <details className="unsuitable-scripts"><summary>Not offered as checks ({scripts.length})</summary>
    <ul className="row-list">{scripts.map(script => <li key={script}><div className="switch-text"><code>npm run {script}</code><small>{scriptDescription(info, script)}</small></div></li>)}</ul>
  </details>;
}

function Findings({ info }) {
  const notes = [
    info.checksFrom === 'ci' && 'Checks are suggested from what this repository’s CI runs.',
    info.registries?.length && `Packages come from ${info.registries.join(', ')}. Setup runs outside the sandbox with your own npm login; allow ${info.registries.length === 1 ? 'that host' : 'those hosts'} under Network access if the agent installs packages itself.`,
  ].filter(Boolean);
  return notes.length ? <ul className="muted repository-findings">{notes.map(note => <li key={note}>{note}</li>)}</ul> : null;
}

export function ChecksTab({ form, update, info }) {
  const setValidation = validation => update({ validation });
  return <>
    <section className="tab-section"><p className="muted">{form.risk?.mode === 'off' ? 'These checks must pass unless a check shortcut skips them.' : 'These are the checks the agent can select. Set required minimums on the Risk & tests tab.'} Commands run on your machine, in a separate copy of the repository.</p>
      <Findings info={info}/>
      <NoChoiceWarning form={form}/>
      {!checkIds(form).length && <p className="muted" role="status">No checks yet. Adding at least one command that fails when the project breaks, such as its test runner, lets dispatch catch and repair broken changes.</p>}
      <ul className="row-list">
        <CheckRows form={form} info={info} onSteps={setValidation}/>
        <li><SwitchRow label="Browser smoke check" description="Starts the app, opens it in Chromium and fails on page errors." checked={Boolean(form.smoke)} onChange={on => update({ smoke: on ? { id: 'browser-smoke', kind: 'browser-smoke' } : null })}/></li>
      </ul>
      <AddCommand label="Add a check command" taken={checkIds(form)} onAdd={step => setValidation([...form.validation, step])}/>
      <Unsuitable info={info}/>
    </section>
    <Setup form={form} update={update} info={info}/>
    {form.git !== false && <LocalFiles form={form} update={update} info={info}/>}
  </>;
}
