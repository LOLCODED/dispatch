import { motion } from 'motion/react';
import { ArrowLeft, Brain, ChartNoAxesCombined, FolderGit2, Keyboard, SlidersHorizontal } from 'lucide-react';
import { Link, usePath } from '@/lib/workspace';

const sections = [
  { href: '/setup', label: 'General', icon: SlidersHorizontal, current: path => path === '/setup' },
  { href: '/setup/keyboard', label: 'Keyboard', icon: Keyboard, current: path => path === '/setup/keyboard' },
  { href: '/admin/projects', label: 'Repositories', icon: FolderGit2, current: path => path.startsWith('/admin/projects') },
  { href: '/brain', label: 'Brain', icon: Brain, current: path => path === '/brain' },
  { href: '/admin', label: 'Usage', icon: ChartNoAxesCombined, current: path => path === '/admin' },
];

export function SettingsLayout({ title, description, actions, className = '', children }) {
  const path = usePath();
  return <main className={`settings-page ${className}`}>
    <nav className="settings-nav" aria-label="Settings">
      <Link href="/" className="back-link"><ArrowLeft size={14} aria-hidden="true"/>All work</Link>
      {sections.map(({ href, label, icon: Icon, current }) => <Link key={href} href={href} className="settings-link" aria-current={current(path) ? 'page' : undefined}><Icon size={15} aria-hidden="true"/>{label}</Link>)}
    </nav>
    <motion.div className="settings-content" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <header className="page-heading"><div><h1>{title}</h1>{description && <p className="lead">{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>
      {children}
    </motion.div>
  </main>;
}
