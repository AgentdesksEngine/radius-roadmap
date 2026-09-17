import { useCallback, useEffect, useState } from 'react';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** useState persisted to localStorage (per browser). */
export function usePref<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(`bt:${key}`, fallback));
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        write(`bt:${key}`, next);
        return next;
      });
    },
    [key],
  );
  return [value, set];
}

export type Theme = 'light' | 'dark' | 'dracula' | 'monokai' | 'solarized-dark' | 'system';

export const THEME_OPTIONS: ReadonlyArray<{ id: Theme; label: string; preview: string }> = [
  {
    id: 'system',
    label: 'Match system',
    preview: 'linear-gradient(135deg, #f3f3f3 50%, #181818 50%)',
  },
  { id: 'light', label: 'Light Modern', preview: '#f3f3f3' },
  { id: 'dark', label: 'Dark Modern', preview: '#181818' },
  { id: 'dracula', label: 'Dracula', preview: '#bd93f9' },
  { id: 'monokai', label: 'Monokai', preview: '#a6e22e' },
  { id: 'solarized-dark', label: 'Solarized Dark', preview: '#268bd2' },
];

const THEME_IDS = new Set<Theme>(THEME_OPTIONS.map(({ id }) => id));

export function normalizeTheme(theme: unknown): Theme {
  return typeof theme === 'string' && THEME_IDS.has(theme as Theme) ? (theme as Theme) : 'system';
}

export function themeColorScheme(theme: Theme): 'light' | 'dark' {
  return theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(value: unknown) {
  const theme = normalizeTheme(value);
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.colorScheme = themeColorScheme(resolved);
}

export function useTheme(): [Theme, (t: Theme) => void, 'light' | 'dark'] {
  const [storedTheme, setTheme] = usePref<Theme>('theme', 'system');
  const theme = normalizeTheme(storedTheme);
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    applyTheme(theme);
    setResolved(document.documentElement.dataset.colorScheme === 'dark' ? 'dark' : 'light');
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      applyTheme(theme);
      setResolved(mq.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
  return [theme, setTheme, resolved];
}
