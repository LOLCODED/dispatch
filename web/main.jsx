import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppHeader } from '@/components/AppHeader';
import { WhatsNew } from '@/components/ChangelogDialog';
import { Setup } from '@/pages/Setup';
import { Work } from '@/pages/Work';
import { Run } from '@/pages/Run';
import { Admin } from '@/pages/Admin';
import { Brain } from '@/pages/Brain';
import { Keyboard } from '@/pages/Keyboard';
import { Projects, ProjectForm } from '@/pages/Projects';
import { Welcome } from '@/pages/Welcome';
import { SetupReveal } from '@/components/SetupReveal';
import { WorkspaceProvider, Link, navigate, usePath, useWorkspace } from '@/lib/workspace';
import { ThemeProvider } from '@/lib/theme';
import { PreferencesProvider } from '@/lib/preferences';
import { useAttention } from '@/lib/use-attention';
import './styles.css';

function route(path, finishSetup) {
  const run = path.match(/^\/runs\/([a-f0-9-]+)$/), project = path.match(/^\/admin\/projects\/([a-f0-9-]+)$/);
  if (path === '/') return <Work/>;
  if (path === '/welcome') return <Welcome onFinish={finishSetup}/>;
  if (path === '/setup') return <Setup/>;
  if (path === '/setup/keyboard') return <Keyboard/>;
  if (path === '/brain') return <Brain/>;
  if (run) return <Run key={run[1]} id={run[1]}/>;
  if (path === '/admin') return <Admin/>;
  if (path === '/admin/projects') return <Projects/>;
  if (path === '/admin/projects/new') return <ProjectForm key="new"/>;
  if (project) return <ProjectForm key={project[1]} id={project[1]}/>;
  return <main className="page"><h1>Page not found</h1><Link href="/">Return to your work</Link></main>;
}

function useFirstRun(path) {
  const { state, loaded } = useWorkspace(), [finished, setFinished] = useState(false), [revealing, setRevealing] = useState(false);
  useEffect(() => { if (loaded && state.setupNeeded && !finished && path === '/') navigate('/welcome', { replace: true }); }, [loaded, state.setupNeeded, finished, path]);
  return { revealing, finish: () => { setFinished(true); setRevealing(true); }, revealed: () => setRevealing(false) };
}

function App() {
  const path = usePath(), firstRun = useFirstRun(path);
  useAttention();
  return <>{path !== '/welcome' && <AppHeader path={path}/>}{route(path, firstRun.finish)}<WhatsNew/>{firstRun.revealing && <SetupReveal onDone={firstRun.revealed}/>}</>;
}

createRoot(document.getElementById('root')).render(<ThemeProvider><PreferencesProvider><WorkspaceProvider><App/></WorkspaceProvider></PreferencesProvider></ThemeProvider>);
