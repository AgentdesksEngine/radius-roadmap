import { describe, expect, it } from 'vitest';
import { normalizeTheme, themeColorScheme } from './prefs';

describe('theme preferences', () => {
  it('accepts every selectable theme', () => {
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('dracula')).toBe('dracula');
    expect(normalizeTheme('monokai')).toBe('monokai');
    expect(normalizeTheme('solarized-dark')).toBe('solarized-dark');
    expect(normalizeTheme('system')).toBe('system');
  });

  it('falls back safely when a stale preference is stored', () => {
    expect(normalizeTheme('one-dark-pro')).toBe('system');
    expect(normalizeTheme(null)).toBe('system');
  });

  it('marks custom editor themes as dark color schemes', () => {
    expect(themeColorScheme('light')).toBe('light');
    expect(themeColorScheme('dracula')).toBe('dark');
    expect(themeColorScheme('monokai')).toBe('dark');
    expect(themeColorScheme('solarized-dark')).toBe('dark');
  });
});
