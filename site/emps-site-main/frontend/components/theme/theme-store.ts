export type Theme = 'light' | 'dark';
export const themeStorageKey = 'emps.theme';
const themeChanged = 'emps:theme-changed';

export function parseTheme(value: unknown): Theme { return value === 'light' ? 'light' : 'dark'; }

// Runs before paint, so a saved light theme does not flash the dark layout.
export const themeBootstrap = `try{document.documentElement.dataset.theme=localStorage.getItem('emps.theme')==='light'?'light':'dark'}catch{document.documentElement.dataset.theme='dark'}`;

export function getTheme(): Theme { return parseTheme(document.documentElement.dataset.theme); }
export function getServerTheme(): Theme { return 'dark'; }

export function setTheme(theme: Theme) {
  const value = parseTheme(theme);
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem(themeStorageKey, value); } catch { /* Preference storage is optional. */ }
  window.dispatchEvent(new Event(themeChanged));
}

export function subscribeTheme(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== themeStorageKey && event.key !== null) return;
    try { if (event.storageArea && event.storageArea !== window.localStorage) return; } catch { return; }
    document.documentElement.dataset.theme = parseTheme(event.newValue);
    notify();
  };
  window.addEventListener(themeChanged, notify);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(themeChanged, notify);
    window.removeEventListener('storage', storage);
  };
}
