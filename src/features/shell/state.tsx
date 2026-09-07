import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_FILTERS, STATUS, type Filters, type SortKey } from '@/model/board';
import { usePref } from '@/model/prefs';
import { decodeFilters, encodeFilters } from '@/model/views';

interface UiState {
  filters: Filters;
  setFilters: (f: Filters | ((p: Filters) => Filters)) => void;
  groupBy: string;
  setGroupBy: (g: string) => void;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  setSort: (s: { key: SortKey; dir: 'asc' | 'desc' }) => void;
  openKey: string | null;
  openIssue: (key: string | null) => void;
  newIssueOpen: boolean;
  setNewIssueOpen: (o: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  /** Project item ids picked out for a bulk edit. Cleared on navigation and after a write. */
  selection: string[];
  setSelection: (ids: string[] | ((prev: string[]) => string[])) => void;
  toggleSelected: (itemId: string, additive?: boolean) => void;
}

const Ctx = createContext<UiState | null>(null);
const LAST_FILTER_KEY = 'bt:last-filter';

/**
 * The URL is the source of truth for filters and grouping, so any view can be shared or
 * saved as a link. localStorage only remembers the last one, to restore it on a cold open.
 */
export function UiStateProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const rawFilter = params.get('f');
  const rawGroup = params.get('group');

  const [groupPref, setGroupPref] = usePref<string>('groupBy', STATUS);
  const [sort, setSort] = usePref<{ key: SortKey; dir: 'asc' | 'desc' }>('sort', {
    key: 'manual',
    dir: 'asc',
  });

  // Cold open with a bare URL: restore whatever was on screen last time.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (restored) return;
    setRestored(true);
    if (rawFilter) return;
    const last = localStorage.getItem(LAST_FILTER_KEY);
    if (!last) return;
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('f', last);
        return n;
      },
      { replace: true },
    );
  }, [restored, rawFilter, setParams]);

  const filters = useMemo(() => decodeFilters(rawFilter), [rawFilter]);
  const groupBy = rawGroup ?? groupPref;

  const writeParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          mutate(n);
          return n;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setFilters = useCallback(
    (f: Filters | ((p: Filters) => Filters)) => {
      const next = typeof f === 'function' ? f(decodeFilters(rawFilter)) : f;
      const encoded = encodeFilters(next);
      try {
        if (encoded) localStorage.setItem(LAST_FILTER_KEY, encoded);
        else localStorage.removeItem(LAST_FILTER_KEY);
      } catch {
        /* private mode */
      }
      writeParams((p) => (encoded ? p.set('f', encoded) : p.delete('f')));
    },
    [rawFilter, writeParams],
  );

  const setGroupBy = useCallback(
    (g: string) => {
      setGroupPref(g);
      writeParams((p) => p.set('group', g));
    },
    [setGroupPref, writeParams],
  );

  const openKey = params.get('i');
  const openIssue = useCallback(
    (key: string | null) => {
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (key) n.set('i', key);
          else n.delete('i');
          return n;
        },
        { replace: false },
      );
    },
    [setParams],
  );

  const [newIssueOpen, setNewIssueOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);

  const toggleSelected = useCallback((itemId: string, additive = true) => {
    setSelection((prev) => {
      if (!additive) return prev.length === 1 && prev[0] === itemId ? [] : [itemId];
      return prev.includes(itemId) ? prev.filter((x) => x !== itemId) : [...prev, itemId];
    });
  }, []);

  const value = useMemo<UiState>(
    () => ({
      filters,
      setFilters,
      groupBy,
      setGroupBy,
      sort,
      setSort,
      openKey,
      openIssue,
      newIssueOpen,
      setNewIssueOpen,
      paletteOpen,
      setPaletteOpen,
      selection,
      setSelection,
      toggleSelected,
    }),
    [
      filters,
      setFilters,
      groupBy,
      setGroupBy,
      sort,
      setSort,
      openKey,
      openIssue,
      newIssueOpen,
      paletteOpen,
      selection,
      toggleSelected,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUi outside UiStateProvider');
  return v;
}
