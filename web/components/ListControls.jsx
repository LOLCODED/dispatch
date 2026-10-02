import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownUp, Check, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton, Tooltip } from '@/components/IconButton';
import { pageOf } from '@/lib/list-view.mjs';

export function useListControls(sorts = []) {
  const [query, setQuery] = useState(''), [sort, setSort] = useState(sorts[0]?.value);
  const current = sorts.find(option => option.value === sort) ?? sorts[0];
  return { query, setQuery, sort: current?.value, setSort, compare: current?.compare };
}

export function usePage(items, size, resetKey = '') {
  const [state, setState] = useState({ key: resetKey, page: 0 });
  const page = state.key === resetKey ? state.page : 0;
  return { ...pageOf(items, page, size), setPage: next => setState({ key: resetKey, page: next }) };
}

export function useFittedPageSize(fallback, hasRows) {
  const ref = useRef(null), [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list || !hasRows) return;
    const measure = () => {
      const row = list.firstElementChild?.getBoundingClientRect().height;
      if (row) setSize(Math.max(1, Math.floor(list.clientHeight / row)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [hasRows]);
  return [ref, size];
}

export function SearchInput({ value, onChange, label, placeholder = 'Search…', onKeyDown, ...inputProps }) {
  return <label className="list-search">
    <Search size={13} aria-hidden="true"/>
    <input type="search" aria-label={label} value={value} placeholder={placeholder} {...inputProps} onChange={event => onChange(event.target.value)} onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented && event.key === 'Escape' && value) { event.preventDefault(); onChange(''); } }}/>
  </label>;
}

export function SortMenu({ sorts, value, onChange }) {
  const current = sorts.find(option => option.value === value) ?? sorts[0], label = `Sort: ${current.label}`;
  return <DropdownMenu>
    <Tooltip label={label}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="list-sort" aria-label={label}><ArrowDownUp aria-hidden="true"/></Button></DropdownMenuTrigger></Tooltip>
    <DropdownMenuContent align="end">
      {sorts.map(option => <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value)}>{option.label}{option.value === current.value && <Check size={13} aria-hidden="true"/>}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function ListControls({ controls, sorts, searchLabel, placeholder }) {
  return <div className="list-controls">
    {searchLabel && <SearchInput value={controls.query} onChange={controls.setQuery} label={searchLabel} placeholder={placeholder}/>}
    {sorts?.length > 1 && <SortMenu sorts={sorts} value={controls.sort} onChange={controls.setSort}/>}
  </div>;
}

export function Pager({ paged, label = 'Pages' }) {
  if (paged.pages <= 1) return null;
  return <nav className="pager" aria-label={label}>
    <IconButton label="Previous page" icon={ChevronLeft} size="icon-xs" disabled={paged.page === 0} onClick={() => paged.setPage(paged.page - 1)}/>
    <span aria-live="polite">{paged.page + 1} / {paged.pages}</span>
    <IconButton label="Next page" icon={ChevronRight} size="icon-xs" disabled={paged.page >= paged.pages - 1} onClick={() => paged.setPage(paged.page + 1)}/>
  </nav>;
}
