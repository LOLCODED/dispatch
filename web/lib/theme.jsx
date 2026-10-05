import { createContext, useContext, useEffect, useState } from 'react';
import { setPreference, usePreference } from '@/lib/server-preferences';

export const themeModes = ['system', 'dark', 'light'];
const darkQuery = '(prefers-color-scheme: dark)';
const ThemeContext = createContext(null);

function useSystemDark() {
  const [dark, setDark] = useState(() => window.matchMedia(darkQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(darkQuery), update = () => setDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return dark;
}

export function ThemeProvider({ children }) {
  const theme = usePreference('appearance.theme'), setTheme = value => setPreference('appearance.theme', value), systemDark = useSystemDark();
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
