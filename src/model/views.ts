import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_FILTERS, type Filters } from './board';

/**
 * A saved view is a named filter set plus the layout it was saved from.
 * Views live in localStorage (per browser) but every view is also a URL, so sharing one
 * with a teammate is a copy-paste rather than a sync problem.
 */
export interface SavedView {
  id: string;
  name: string;
  /** Route the view opens in: '/board', '/list', '/sheet'. */
  path: string;
  filters: Filters;
  groupBy: string;
}

const KEY = 'bt:views';

function read(): SavedView[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedView[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let cache: SavedView[] = read();
const listeners = new Set<() => void>();

function write(views: SavedView[]) {
  cache = views;
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch {
    /* quota or private mode: the views stay in memory for this session */
  }
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSavedViews() {
  const views = useSyncExternalStore(subscribe, () => cache);
  const save = useCallback((view: Omit<SavedView, 'id'>) => {
    const id = `v${Date.now().toString(36)}`;
    write([...cache, { ...view, id }]);
    return id;
  }, []);
  const remove = useCallback((id: string) => write(cache.filter((v) => v.id !== id)), []);
  const rename = useCallback(
    (id: string, name: string) => write(cache.map((v) => (v.id === id ? { ...v, name } : v))),
    [],
  );
  return { views, save, remove, rename };
}

// ---------- URL round-trip ----------

/** Only non-default parts of the filter go in the URL, so a plain board link stays clean. */
export function encodeFilters(f: Filters): string | null {
  const diff: Record<string, unknown> = {};
  if (f.team !== DEFAULT_FILTERS.team) diff.team = f.team;
  if (f.state !== DEFAULT_FILTERS.state) diff.state = f.state;
  if (f.assignees.length) diff.assignees = f.assignees;
  if (f.query) diff.query = f.query;
  if (f.archived) diff.archived = true;
  const select = Object.fromEntries(Object.entries(f.select).filter(([, v]) => v.length));
  if (Object.keys(select).length) diff.select = select;
  return Object.keys(diff).length ? JSON.stringify(diff) : null;
}

export function decodeFilters(raw: string | null): Filters {
  if (!raw) return DEFAULT_FILTERS;
  try {
    const d = JSON.parse(raw) as Partial<Filters>;
    return {
      team: typeof d.team === 'string' ? d.team : null,
      state: d.state ?? DEFAULT_FILTERS.state,
      select: d.select && typeof d.select === 'object' ? d.select : {},
      assignees: Array.isArray(d.assignees) ? d.assignees : [],
      query: typeof d.query === 'string' ? d.query : '',
      archived: d.archived === true,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function viewHref(view: SavedView): string {
  const f = encodeFilters(view.filters);
  const params = new URLSearchParams();
  if (f) params.set('f', f);
  if (view.groupBy) params.set('group', view.groupBy);
  const qs = params.toString();
  return qs ? `${view.path}?${qs}` : view.path;
}
