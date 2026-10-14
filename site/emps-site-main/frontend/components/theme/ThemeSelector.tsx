'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import styles from './theme-selector.module.css';

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  return <div className={styles.selector} role="group" aria-label="Tema do site">
    <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={16} aria-hidden="true" />Claro</button>
    <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={16} aria-hidden="true" />Escuro</button>
  </div>;
}
