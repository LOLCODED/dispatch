import { useState } from 'react';
import { ArrowRight, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { checkIds, uniqueId } from '@/lib/project-form.mjs';

function ScopeEditor({ scope, checks, onChange, onDone }) {
  const toggle = check => onChange({ ...scope, checks: scope.checks.includes(check) ? scope.checks.filter(item => item !== check) : [...scope.checks, check] });
  return <div className="step-editor">
    <div className="field"><Label htmlFor={`scope-${scope.id}`}>If only these files change</Label><Textarea id={`scope-${scope.id}`} rows={3} value={scope.paths.join('\n')} placeholder={'docs/**\n*.md'} onChange={event => onChange({ ...scope, paths: event.target.value.split('\n') })}/><p className="muted">One pattern per line, like <code>web/**</code> or <code>*.md</code>.</p></div>
    <div className="field"><span className="field-label">run only</span><div className="chip-toggles" role="group" aria-label="Checks to run">{checks.map(check => <button key={check} type="button" className="chip-toggle" aria-pressed={scope.checks.includes(check)} onClick={() => toggle(check)}>{check}</button>)}</div>{!scope.checks.length && <p className="muted">No checks selected: these changes skip every check.</p>}</div>
    <IconButton type="button" label="Done" icon={Check} onClick={onDone}/>
  </div>;
}

function ScopeRow({ scope, checks, editing, onEdit, onChange, onRemove }) {
  const paths = scope.paths.filter(path => path.trim()), kept = scope.checks.filter(check => checks.includes(check));
  return <li className="scope">
    <div className="scope-summary">
      <span className="row-meta">only</span>{paths.length ? paths.map(path => <code key={path}>{path}</code>) : <span className="row-meta">no files yet</span>}
      <ArrowRight size={13} aria-hidden="true" className="row-meta"/>
      {kept.length ? kept.map(check => <span key={check} className="check-chip">{check}</span>) : <span className="row-meta">no checks</span>}
      <span className="scope-actions"><IconButton type="button" label={`Edit shortcut ${paths[0] ?? scope.id}`} icon={Pencil} aria-pressed={editing} onClick={onEdit}/><IconButton type="button" label={`Remove shortcut ${paths[0] ?? scope.id}`} icon={Trash2} onClick={onRemove}/></span>
    </div>
    {editing && <ScopeEditor scope={scope} checks={checks} onChange={onChange} onDone={onEdit}/>}
  </li>;
}

export function ShortcutsTab({ form, update }) {
  const [editing, setEditing] = useState(null), checks = checkIds(form), setScopes = scopes => update({ scopes });
  const add = () => { const id = uniqueId('shortcut', form.scopes.map(scope => scope.id)); setScopes([...form.scopes, { id, paths: [], checks: [] }]); setEditing(id); };
  return <section className="tab-section">
    <p className="muted">Small changes don't need every check. If every changed file matches a shortcut, only its checks run. Any other change runs all of them.</p>
    {form.scopes.length > 0 && <ul className="row-list scopes">{form.scopes.map((scope, index) => <ScopeRow key={scope.id} scope={scope} checks={checks} editing={editing === scope.id}
      onEdit={() => setEditing(editing === scope.id ? null : scope.id)}
      onChange={next => setScopes(form.scopes.map((item, position) => position === index ? next : item))}
      onRemove={() => setScopes(form.scopes.filter((_, position) => position !== index))}/>)}</ul>}
    <IconButton type="button" label="Add a shortcut" icon={Plus} variant="outline" onClick={add}/>
  </section>;
}
