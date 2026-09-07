import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from './board';
import { decodeFilters, encodeFilters, viewHref } from './views';

describe('filter URL round-trip', () => {
  it('keeps a default filter out of the URL entirely', () => {
    expect(encodeFilters(DEFAULT_FILTERS)).toBeNull();
    expect(decodeFilters(null)).toEqual(DEFAULT_FILTERS);
  });

  it('survives a round trip', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      team: 'iOS',
      state: 'open' as const,
      assignees: ['alice'],
      select: { Priority: ['Urgent'] },
      query: 'crash',
    };
    expect(decodeFilters(encodeFilters(filters))).toEqual(filters);
  });

  it('drops empty select entries so they do not bloat the link', () => {
    const encoded = encodeFilters({ ...DEFAULT_FILTERS, select: { Priority: [] } });
    expect(encoded).toBeNull();
  });

  it('falls back to defaults on a corrupt param instead of throwing', () => {
    expect(decodeFilters('not json')).toEqual(DEFAULT_FILTERS);
  });
});

describe('viewHref', () => {
  it('builds a shareable link with filters and grouping', () => {
    const href = viewHref({
      id: 'v1',
      name: 'Urgent',
      path: '/board',
      groupBy: 'Team',
      filters: { ...DEFAULT_FILTERS, team: 'iOS' },
    });
    expect(href.startsWith('/board?')).toBe(true);
    expect(new URLSearchParams(href.split('?')[1]).get('group')).toBe('Team');
  });
  it('leaves a plain view as a bare path', () => {
    expect(
      viewHref({ id: 'v2', name: 'All', path: '/list', groupBy: '', filters: DEFAULT_FILTERS }),
    ).toBe('/list');
  });
});
