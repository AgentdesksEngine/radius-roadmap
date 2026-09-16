import { useCallback, useEffect } from 'react';
import type { SavedView as StoredView } from '@shared/types';
import { useCreateView, useDeleteView, useUpdateView, useViews } from '../api/hooks';
import { DEFAULT_FILTERS, type Filters } from './board';

/**
 * A saved view is a named filter set plus the layout it was saved from.
 * Views live per profile in Postgres (they used to be localStorage, which meant they vanished
 * on a second device), but every view is still also a URL, so sharing one with a teammate
 * stays a copy-paste rather than a sync problem.
 */
export interface SavedView extends Omit<StoredView, 'filters'> {
  filters: Filters;
}

const LEGACY_KEY = 'bt:views';
const MIGRATED_KEY = 'bt:views-migrated';

function hydrate(view: StoredView): SavedView {
  return { ...view, filters: decodeFilters(JSON.stringify(view.filters ?? {})) };
}

/**
 * Moves whatever this browser had in localStorage into the account, once. Marked done even
 * when there was nothing to move, so it never runs twice, and deliberately silent: a failed
 * migration is not worth a toast on someone's first load.
 */
function useLegacyMigration(ready: boolean) {
  const create = useCreateView();
  const run = create.mutateAsync;
  useEffect(() => {
    if (!ready) return;
    let legacy: Omit<SavedView, 'id' | 'pinned'>[] = [];
    try {
      if (localStorage.getItem(MIGRATED_KEY)) return;
      legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]');
      localStorage.setItem(MIGRATED_KEY, '1');
    } catch {
      return; // private mode: nothing to migrate, and nothing to remember either
    }
    if (!Array.isArray(legacy)) return;
    for (const v of legacy) {
      if (!v?.name || !v?.path) continue;
      void run({ name: v.name, path: v.path, filters: v.filters ?? DEFAULT_FILTERS, groupBy: v.groupBy ?? 'Status' });
    }
  }, [ready, run]);
}

export function useSavedViews() {
  const query = useViews();
  const create = useCreateView();
  const update = useUpdateView();
  const remove = useDeleteView();
  useLegacyMigration(query.isSuccess);

  const views = (query.data ?? []).map(hydrate);

  const save = useCallback(
    (view: Omit<SavedView, 'id' | 'pinned'>) =>
      create.mutateAsync({ name: view.name, path: view.path, filters: view.filters, groupBy: view.groupBy }),
    [create],
  );
  const rename = useCallback((id: string, name: string) => update.mutate({ id, name }), [update]);
  const setPinned = useCallback((id: string, pinned: boolean) => update.mutate({ id, pinned }), [update]);
  const destroy = useCallback((id: string) => remove.mutate(id), [remove]);

  return { views, save, remove: destroy, rename, setPinned, isLoading: query.isPending };
}

// ---------- URL round-trip ----------

/** Only non-default parts of the filter go in the URL, so a plain board link stays clean. */
export function encodeFilters(f: Filters): string | null {
  const diff: Record<string, unknown> = {};
  if (f.team !== DEFAULT_FILTERS.team) diff.team = f.team;
  if (f.state !== DEFAULT_FILTERS.state) diff.state = f.state;
  if (f.assignees.length) diff.assignees = f.assignees;
  if (f.collaborators.length) diff.collaborators = f.collaborators;
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
      collaborators: Array.isArray(d.collaborators) ? d.collaborators : [],
      query: typeof d.query === 'string' ? d.query : '',
      archived: d.archived === true,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function viewHref(view: Omit<SavedView, 'id' | 'name' | 'pinned'> & { id?: string; name?: string; pinned?: boolean }): string {
  const f = encodeFilters(view.filters);
  const params = new URLSearchParams();
  if (f) params.set('f', f);
  if (view.groupBy) params.set('group', view.groupBy);
  const qs = params.toString();
  return qs ? `${view.path}?${qs}` : view.path;
}
