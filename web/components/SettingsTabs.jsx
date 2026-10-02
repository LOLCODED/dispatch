import { useEffect, useRef, useState } from 'react';
import { Tabs } from 'radix-ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { prefersReducedMotion } from '@/lib/motion';

function useHashTab(tabs) {
  const fromHash = () => { const value = location.hash.slice(1); return tabs.some(item => item.value === value) ? value : tabs[0].value; };
  const [tab, setTab] = useState(fromHash);
  useEffect(() => { const sync = () => setTab(fromHash()); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync); }, []);
  return [tab, value => { setTab(value); history.replaceState(history.state, '', `#${value}`); }];
}

function useHorizontalOverflow(ref) {
  const [overflow, setOverflow] = useState({ start: false, end: false });
  useEffect(() => {
    const element = ref.current;
    const update = () => {
      const start = element.scrollLeft > 2, end = element.scrollWidth - element.scrollLeft - element.clientWidth > 2;
      setOverflow(current => current.start === start && current.end === end ? current : { start, end });
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(element);
    return () => { element.removeEventListener('scroll', update); resize.disconnect(); };
  }, [ref]);
  return overflow;
}

function scrollByPage(element, direction) {
  element.scrollBy({ left: direction * element.clientWidth * 0.7, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

export function SettingsTabs({ label, tabs }) {
  const [tab, setTab] = useHashTab(tabs);
  const list = useRef(null);
  const overflow = useHorizontalOverflow(list);
  return <Tabs.Root value={tab} onValueChange={setTab}>
    <div className="repo-tabs-bar" data-overflow-start={overflow.start || undefined} data-overflow-end={overflow.end || undefined}>
      <Tabs.List ref={list} className="repo-tabs" aria-label={label}>{tabs.map(({ value, label, icon: Icon, count }) => <Tabs.Trigger key={value} value={value} className="repo-tab"><Icon size={14} aria-hidden="true"/>{label}{count !== undefined && <span className="tab-count">{count}</span>}</Tabs.Trigger>)}</Tabs.List>
      {overflow.start && <IconButton className="repo-tabs-scroll is-start" label="Previous sections" icon={ChevronLeft} onClick={() => scrollByPage(list.current, -1)}/>}
      {overflow.end && <IconButton className="repo-tabs-scroll is-end" label="More sections" icon={ChevronRight} onClick={() => scrollByPage(list.current, 1)}/>}
    </div>
    {tabs.map(({ value, content }) => <Tabs.Content key={value} value={value} className="repo-tab-panel">{content}</Tabs.Content>)}
  </Tabs.Root>;
}
