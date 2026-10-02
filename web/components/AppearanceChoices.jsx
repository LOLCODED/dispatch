import { Accessibility, Monitor, Moon, Sun, Zap } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { useTheme } from '@/lib/theme';
import { usePreferences } from '@/lib/preferences';

export function ThemeChoice() {
  const { theme, setTheme } = useTheme();
  return <div className="segmented" role="group" aria-label="Theme">
    <IconButton label="Follow the system theme" icon={Monitor} aria-pressed={theme === 'system'} onClick={() => setTheme('system')}/>
    <IconButton label="Switch to dark mode" icon={Moon} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}/>
    <IconButton label="Switch to light mode" icon={Sun} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}/>
  </div>;
}

export function MotionChoice() {
  const { motion, setMotion } = usePreferences();
  return <div className="segmented" role="group" aria-label="Motion">
    <IconButton label="Follow the system setting" icon={Monitor} aria-pressed={motion === 'system'} onClick={() => setMotion('system')}/>
    <IconButton label="Reduce motion" icon={Accessibility} aria-pressed={motion === 'reduce'} onClick={() => setMotion('reduce')}/>
    <IconButton label="Full motion" icon={Zap} aria-pressed={motion === 'full'} onClick={() => setMotion('full')}/>
  </div>;
}
