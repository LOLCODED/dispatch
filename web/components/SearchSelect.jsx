import { useEffect, useId, useRef, useState } from 'react';
import { Popover } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { SearchInput } from '@/components/ListControls';
import { keepMovedFocus, optionsFrom, triggerLabel, useCollapsed } from '@/components/Select';

export function matchesQuery(option, query) {
  const text = `${option.group ?? ''} ${option.label} ${option.value}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(term => text.includes(term));
}

export function sectionsOf(options, query, collapsed) {
  const searching = Boolean(query.trim()), sections = [];
  for (const option of searching ? options.filter(option => matchesQuery(option, query)) : options) {
    const last = sections.at(-1);
    if (last && last.group === option.group) last.options.push(option);
    else sections.push({ group: option.group, options: [option] });
  }
  return sections.map(section => ({ ...section, closed: !searching && section.group != null && collapsed.includes(section.group) }));
}

function revealHighlighted(list) {
  const item = list?.querySelector('[data-highlighted]');
  if (!item) return;
  const top = item.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop, bottom = top + item.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

function SearchOptions({ id, sections, options, current, value, searching, onToggle, onActive, onChoose }) {
  const listRef = useRef(null), [scrolled, setScrolled] = useState(false);
  useEffect(() => revealHighlighted(listRef.current), [current]);
  useEffect(() => setScrolled(listRef.current?.scrollTop > 0));
  return <div id={id} ref={listRef} role="listbox" className="select-viewport search-select-list" data-scrolled={scrolled || undefined} onScroll={event => setScrolled(event.currentTarget.scrollTop > 0)}>
    {sections.map(section => <div key={section.group ?? section.options[0].value} role="group" aria-label={section.group ?? undefined}>
      {section.group && <button type="button" className="select-group" aria-expanded={!section.closed} disabled={searching} onMouseDown={event => event.preventDefault()} onClick={() => onToggle(section.group)}><ChevronDown size={12} aria-hidden="true"/>{section.group}<span className="count">{section.options.length}</span></button>}
      {!section.closed && section.options.map(option => <div key={option.value} id={`${id}-${options.indexOf(option)}`} role="option" aria-selected={option.value === String(value ?? '')} aria-disabled={option.disabled || undefined} data-value={option.value} data-state={option.value === String(value ?? '') ? 'checked' : 'unchecked'} data-highlighted={option === current ? '' : undefined} className="select-option" onPointerMove={() => !option.disabled && onActive(option.value)} onClick={() => !option.disabled && onChoose(option)}>
        <span>{option.label}</span>{option.value === String(value ?? '') && <Check size={13}/>}
      </div>)}
    </div>)}
    {!sections.length && <p className="search-select-empty">No matches</p>}
  </div>;
}

// Same option API and look as Select, with a filter field; a Popover keeps focus in the field, which Radix Select's own focus management would steal.
export function SearchSelect({ children, value, onChange, id, disabled, icon: Icon, searchLabel = 'Search', ...props }) {
  const options = optionsFrom(children), listId = useId(), [collapsed, toggle] = useCollapsed();
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(null);
  const sections = sectionsOf(options, query, collapsed);
  const choices = sections.flatMap(section => section.closed ? [] : section.options).filter(option => !option.disabled);
  const current = choices.find(option => option.value === active) ?? choices[0];
  const changeOpen = next => { setOpen(next); if (next) { setQuery(''); setActive(String(value ?? '')); } };
  const choose = option => { setOpen(false); onChange?.({ target: { value: option.value } }); };
  const onKeyDown = event => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step && choices.length) { event.preventDefault(); setActive(choices[(choices.indexOf(current) + step + choices.length) % choices.length].value); }
    else if (event.key === 'Enter' && current) { event.preventDefault(); choose(current); }
  };
  return <Popover.Root open={open} onOpenChange={changeOpen}>
    <Popover.Trigger id={id} disabled={disabled} data-value={value ?? ''} className="select-trigger" {...props}>{Icon && <Icon size={14} aria-hidden="true" className="select-icon"/>}<span>{triggerLabel(options.find(option => option.value === String(value ?? '')))}</span><ChevronDown size={13} aria-hidden="true"/></Popover.Trigger>
    <Popover.Portal><Popover.Content align="start" sideOffset={6} className="select-popup search-select" onCloseAutoFocus={keepMovedFocus}>
      <SearchInput value={query} onChange={setQuery} label={searchLabel} placeholder={`${searchLabel}…`} role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={current ? `${listId}-${options.indexOf(current)}` : undefined} autoComplete="off" onKeyDown={onKeyDown}/>
      <SearchOptions id={listId} sections={sections} options={options} current={current} value={value} searching={Boolean(query.trim())} onToggle={toggle} onActive={setActive} onChoose={choose}/>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
