import { Children, Fragment, isValidElement, useState } from 'react';
import { Select as Primitive } from 'radix-ui';
import { ChevronDown, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { preference, savePreference } from '@/lib/workspace';

const pageSize = 7, collapsedKey = 'dispatch-select-collapsed';

export function optionsFrom(children, group = null) {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement(child)) return [];
    if (child.type === 'option') return [{ value: String(child.props.value ?? child.props.children), label: child.props.children, disabled: child.props.disabled, group }];
    return optionsFrom(child.props.children, child.type === 'optgroup' ? child.props.label : group);
  });
}

function readCollapsed() {
  try { const saved = JSON.parse(preference(collapsedKey, '[]')); return Array.isArray(saved) ? saved : []; } catch { return []; }
}

export function useCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = group => setCollapsed(current => {
    const next = current.includes(group) ? current.filter(item => item !== group) : [...current, group];
    savePreference(collapsedKey, JSON.stringify(next));
    return next;
  });
  return [collapsed, toggle];
}

export const triggerLabel = option => option?.group ? `${option.group} · ${option.label}` : option?.label;
const encode = value => value === '' ? '__dispatch_default__' : String(value);
// Radix returns focus to the trigger on a timer after the popup unmounts; by then the user may have focused another control, which must keep it.
export const keepMovedFocus = event => { if (document.activeElement && document.activeElement !== document.body) event.preventDefault(); };

function Option({ option }) {
  return <Primitive.Item data-value={option.value} value={encode(option.value)} disabled={option.disabled} className="select-option"><Primitive.ItemText>{option.label}</Primitive.ItemText><Primitive.ItemIndicator><Check size={13}/></Primitive.ItemIndicator></Primitive.Item>;
}

function GroupedOptions({ options }) {
  const [collapsed, toggle] = useCollapsed();
  return options.map((option, index) => {
    const starts = option.group && option.group !== options[index - 1]?.group, closed = option.group && collapsed.includes(option.group);
    return <Fragment key={option.value}>
      {starts && <button type="button" className="select-group" aria-expanded={!closed} onClick={() => toggle(option.group)}><ChevronDown size={12} aria-hidden="true"/>{option.group}<span className="count">{options.filter(item => item.group === option.group).length}</span></button>}
      {!closed && <Option option={option}/>}
    </Fragment>;
  });
}

function PagedOptions({ options, page, onPage }) {
  const pages = Math.max(1, Math.ceil(options.length / pageSize));
  return <>
    {options.slice(page * pageSize, (page + 1) * pageSize).map(option => <Option key={option.value} option={option}/>)}
    {pages > 1 && <div className="select-pages"><IconButton label="Previous page" icon={ChevronLeft} disabled={!page} onClick={() => onPage(page - 1)}/><span>{page + 1} / {pages}</span><IconButton label="Next page" icon={ChevronRight} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}/></div>}
  </>;
}

// Keep the familiar option API; the visible control and popup are themed components. Option groups collapse instead of paging.
export function Select({ children, value, onChange, id, disabled, icon: Icon, ...props }) {
  const options = optionsFrom(children), [page, setPage] = useState(0), grouped = options.some(option => option.group);
  const openAtValue = open => { if (open) setPage(Math.max(0, Math.floor(options.findIndex(option => option.value === String(value)) / pageSize))); };
  return <Primitive.Root value={encode(value)} disabled={disabled} onValueChange={value => onChange?.({ target: { value: value === '__dispatch_default__' ? '' : value } })} onOpenChange={openAtValue}>
    <Primitive.Trigger id={id} data-value={value ?? ''} className="select-trigger" {...props}>{Icon && <Icon size={14} aria-hidden="true" className="select-icon"/>}<Primitive.Value>{triggerLabel(options.find(option => option.value === String(value ?? '')))}</Primitive.Value><Primitive.Icon><ChevronDown size={13}/></Primitive.Icon></Primitive.Trigger>
    <Primitive.Portal><Primitive.Content position="popper" sideOffset={6} className="select-popup" onCloseAutoFocus={keepMovedFocus}><Primitive.Viewport className="select-viewport">{grouped ? <GroupedOptions options={options}/> : <PagedOptions options={options} page={page} onPage={setPage}/>}</Primitive.Viewport></Primitive.Content></Primitive.Portal>
  </Primitive.Root>;
}
