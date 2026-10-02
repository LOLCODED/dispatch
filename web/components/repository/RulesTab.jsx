import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Input } from '@/components/ui/input';

const maxLines = 20, maxCharacters = 200;

function LineList({ title, hint, label, placeholder, items, onItems, mono }) {
  const [text, setText] = useState(''), full = items.length >= maxLines;
  const add = () => { const line = text.trim(); if (line && !items.includes(line)) onItems([...items, line]); setText(''); };
  return <section className="tab-section"><h3>{title}</h3><p className="muted">{hint}</p>
    {items.length > 0 && <ul className="row-list">{items.map(item => <li key={item} className="switch-row"><span className="row-bullet" aria-hidden="true"/><div className="switch-text">{mono ? <code>{item}</code> : <span>{item}</span>}</div><IconButton type="button" label={`Remove ${item}`} icon={Trash2} onClick={() => onItems(items.filter(entry => entry !== item))}/></li>)}</ul>}
    <div className="add-row"><Input className={mono ? 'mono-input' : undefined} aria-label={label} placeholder={placeholder} value={text} maxLength={maxCharacters} disabled={full} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}/><IconButton type="button" label={label} icon={Plus} variant="outline" disabled={full || !text.trim()} onClick={add}/></div>
  </section>;
}

export function RulesTab({ form, update }) {
  return <>
    <LineList title="Always tell the agent" hint={'Sent with every ticket and reply, and to the reviewer. "Remember for this repository" on a reply adds here too.'} label="Add a rule" placeholder="Branch work targets staging; never touch main." items={form.instructions} onItems={instructions => update({ instructions })}/>
    <LineList title="Leave these files alone" hint="A run that changes a matching file is flagged for you. It still finishes." label="Add a protected path" placeholder="src/legacy/**" items={form.protectedPaths} onItems={protectedPaths => update({ protectedPaths })} mono/>
  </>;
}
