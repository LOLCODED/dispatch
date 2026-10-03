import { useMemo } from 'react';
import { Settings2 } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { IconButton, Tooltip } from '@/components/IconButton';
import { showsLanding, StateMark } from '@/components/work/StateDot';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { attentionOf, trayOf } from '@/lib/attention.mjs';
import { Link, useWorkspace } from '@/lib/workspace';

const settingsPaths = ['/setup', '/admin', '/brain'];

function TraySection({ section }) {
  return <>
    <p className="menu-label">{section.label} · {section.total}</p>
    {section.entries.map(entry => <DropdownMenuItem key={entry.key} asChild>
      <Link href={`/runs/${entry.latest.id}`} className="tray-item"><StateMark state={entry.state} landing={showsLanding(entry)}/><span>{entry.title}</span></Link>
    </DropdownMenuItem>)}
  </>;
}

function TaskTray({ alerting, count }) {
  const { state } = useWorkspace(), sections = useMemo(() => trayOf(state), [state]);
  const label = count > 0 ? `Quick view · ${count} waiting on you` : 'Quick view';
  return <DropdownMenu>
    <Tooltip label={label}><DropdownMenuTrigger className="brand-mark" aria-label={label} data-alerting={alerting || undefined}>
      <Logo/>
      {alerting && <span className="brand-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </DropdownMenuTrigger></Tooltip>
    <DropdownMenuContent align="start" className="tray">
      {sections.length ? sections.map(section => <TraySection key={section.state} section={section}/>) : <p className="tray-empty">Nothing running or waiting on you.</p>}
      <DropdownMenuSeparator/>
      <DropdownMenuItem asChild><Link href="/#tasks">All tasks</Link></DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function AppHeader({ path }) {
  const { connected, state } = useWorkspace(), { count } = useMemo(() => attentionOf(state), [state]);
  const inSettings = settingsPaths.some(prefix => path.startsWith(prefix));
  return <header className="masthead">
    <div className="brand">
      <TaskTray count={count} alerting={count > 0 && path !== '/'}/>
      <Link href="/" aria-label="dispatch home">dispatch<span className="brand-period">.</span></Link>
    </div>
    <nav aria-label="Workspace">
      {!connected && <span className="connection-lost" role="status">Server disconnected · retrying</span>}
      <IconButton label="Settings" icon={Settings2} href="/setup" aria-current={inSettings ? 'page' : undefined}/>
    </nav>
  </header>;
}
