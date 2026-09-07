import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_FILTERS, STATUS, type Filters, type SortKey } from '@/model/board';
import { usePref } from '@/model/prefs';

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
}

const Ctx = createContext<UiState | null>(null);

export function UiStateProvider({ children }: { children: ReactNode }) {
  const [team, setTeam] = usePref<string | null>('team', null);
  const [session, setSession] = useState<Omit<Filters, 'team'>>(() => {
    const { team: _t, ...rest } = DEFAULT_FILTERS;
    return rest;
  });
  const filters = useMemo<Filters>(() => ({ ...session, team }), [session, team]);
  const setFilters = useCallback(
    (f: Filters | ((p: Filters) => Filters)) => {
      const next = typeof f === 'function' ? f({ ...session, team }) : f;
      const { team: t, ...rest } = next;
      setTeam(t);
      setSession(rest);
    },
    [session, team, setTeam],
  );

  const [groupBy, setGroupBy] = usePref<string>('groupBy', STATUS);
  const [sort, setSort] = usePref<{ key: SortKey; dir: 'asc' | 'desc' }>('sort', { key: 'updated', dir: 'desc' });
  const [params, setParams] = useSearchParams();
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

  const value = useMemo<UiState>(
    () => ({ filters, setFilters, groupBy, setGroupBy, sort, setSort, openKey, openIssue, newIssueOpen, setNewIssueOpen, paletteOpen, setPaletteOpen }),
    [filters, setFilters, groupBy, setGroupBy, sort, setSort, openKey, openIssue, newIssueOpen, paletteOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUi outside UiStateProvider');
  return v;
}
