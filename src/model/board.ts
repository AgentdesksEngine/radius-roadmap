import type { BoardItem, FieldOption, FieldValue, OptionColor, ProjectField, ProjectSchema } from '@shared/types';

export const STATUS = 'Status';
export const TEAM = 'Team';
export const PRIORITY = 'Priority';
export const SEVERITY = 'Severity';
export const WORK_TYPE = 'Work type';
export const MODULE = 'Module';

/** Built-in fields that are not editable custom fields. */
const BUILT_IN = new Set([
  'TITLE',
  'ASSIGNEES',
  'LABELS',
  'LINKED_PULL_REQUESTS',
  'MILESTONE',
  'REPOSITORY',
  'REVIEWERS',
  'PARENT_ISSUE',
  'SUB_ISSUES_PROGRESS',
  'TRACKS',
  'TRACKED_BY',
  'CREATED',
  'UPDATED',
  'CLOSED',
  'ISSUE_TYPE',
]);

export function customFields(schema: ProjectSchema): ProjectField[] {
  return schema.fields.filter((f) => !BUILT_IN.has(f.dataType));
}

export function selectFields(schema: ProjectSchema): ProjectField[] {
  return schema.fields.filter((f) => f.dataType === 'SINGLE_SELECT');
}

export function field(schema: ProjectSchema | undefined, name: string): ProjectField | undefined {
  return schema?.fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
}

export function fieldValue(item: BoardItem, name: string): FieldValue | undefined {
  return item.fields[name];
}

export function selectName(item: BoardItem, name: string): string | undefined {
  const v = item.fields[name];
  return v?.kind === 'singleSelect' ? v.name : undefined;
}

export function selectOption(item: BoardItem, f: ProjectField | undefined): FieldOption | undefined {
  if (!f) return undefined;
  const v = item.fields[f.name];
  return v?.kind === 'singleSelect' ? f.options?.find((o) => o.id === v.optionId) : undefined;
}

export function colorVar(color: OptionColor | undefined): string {
  switch (color) {
    case 'BLUE':
      return 'var(--c-blue)';
    case 'GREEN':
      return 'var(--c-green)';
    case 'YELLOW':
      return 'var(--c-yellow)';
    case 'ORANGE':
      return 'var(--c-orange)';
    case 'RED':
      return 'var(--c-red)';
    case 'PINK':
      return 'var(--c-pink)';
    case 'PURPLE':
      return 'var(--c-purple)';
    default:
      return 'var(--c-gray)';
  }
}

// ---------- Grouping ----------

export const ASSIGNEE_GROUP = 'Assignee';

export interface Group {
  key: string;
  label: string;
  color?: OptionColor;
  /** Set when the group corresponds to a single-select option (drop target). */
  optionId?: string;
  /** Set for the "no value" group. */
  empty?: boolean;
  items: BoardItem[];
}

export function groupItems(items: BoardItem[], groupBy: string, schema: ProjectSchema): Group[] {
  if (groupBy === ASSIGNEE_GROUP) {
    const map = new Map<string, Group>();
    const none: Group = { key: '__none', label: 'Unassigned', empty: true, items: [] };
    for (const it of items) {
      if (!it.assignees.length) {
        none.items.push(it);
        continue;
      }
      for (const a of it.assignees) {
        let g = map.get(a.login);
        if (!g) {
          g = { key: a.login, label: a.name || a.login, items: [] };
          map.set(a.login, g);
        }
        g.items.push(it);
      }
    }
    const groups = [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
    if (none.items.length) groups.push(none);
    return groups;
  }

  const f = field(schema, groupBy);
  if (!f?.options) return [{ key: '__all', label: 'All', items }];
  const byOption = new Map<string, Group>(
    f.options.map((o) => [o.id, { key: o.id, label: o.name, color: o.color, optionId: o.id, items: [] }]),
  );
  const none: Group = { key: '__none', label: `No ${f.name.toLowerCase()}`, empty: true, items: [] };
  for (const it of items) {
    const v = it.fields[f.name];
    const g = v?.kind === 'singleSelect' ? byOption.get(v.optionId) : undefined;
    (g ?? none).items.push(it);
  }
  const groups = [...byOption.values()];
  if (none.items.length) groups.unshift(none);
  return groups;
}

// ---------- Filtering ----------

export type StateFilter = 'active' | 'open' | 'closed' | 'all';

export interface Filters {
  team: string | null; // option name, null = all teams
  state: StateFilter;
  /** field name -> set of option names */
  select: Record<string, string[]>;
  assignees: string[]; // logins, '__none' = unassigned
  query: string;
}

export const DEFAULT_FILTERS: Filters = { team: null, state: 'active', select: {}, assignees: [], query: '' };

const RECENT_MS = 14 * 24 * 3600_000;

export function matchesState(item: BoardItem, state: StateFilter, now = Date.now()): boolean {
  switch (state) {
    case 'open':
      return item.state === 'OPEN';
    case 'closed':
      return item.state === 'CLOSED';
    case 'all':
      return true;
    default:
      return item.state === 'OPEN' || (item.closedAt != null && now - Date.parse(item.closedAt) < RECENT_MS);
  }
}

export function normalizeQuery(q: string) {
  return q.trim().toLowerCase();
}

export function matchesQuery(item: BoardItem, q: string): boolean {
  if (!q) return true;
  const key = item.key.toLowerCase();
  if (key === q || key.endsWith(`-${q}`) || String(item.number) === q) return true;
  if (item.title.toLowerCase().includes(q)) return true;
  if (item.body.toLowerCase().includes(q)) return true;
  return item.assignees.some((a) => a.login.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q));
}

export function filterItems(items: BoardItem[], filters: Filters, now = Date.now()): BoardItem[] {
  const q = normalizeQuery(filters.query);
  const selectEntries = Object.entries(filters.select).filter(([, v]) => v.length);
  return items.filter((it) => {
    if (filters.team && selectName(it, TEAM) !== filters.team) return false;
    if (!matchesState(it, filters.state, now)) return false;
    for (const [fname, names] of selectEntries) {
      const v = selectName(it, fname) ?? '__none';
      if (!names.includes(v)) return false;
    }
    if (filters.assignees.length) {
      const logins = it.assignees.map((a) => a.login);
      const hit = filters.assignees.some((a) => (a === '__none' ? logins.length === 0 : logins.includes(a)));
      if (!hit) return false;
    }
    return matchesQuery(it, q);
  });
}

export function activeFilterCount(f: Filters) {
  return Object.values(f.select).filter((v) => v.length).length + (f.assignees.length ? 1 : 0) + (f.state !== 'active' ? 1 : 0);
}

// ---------- Sorting ----------

export type SortKey = 'updated' | 'created' | 'priority' | 'number' | 'title' | 'status';

export function optionRank(schema: ProjectSchema, fieldName: string, item: BoardItem): number {
  const f = field(schema, fieldName);
  const v = item.fields[fieldName];
  if (!f?.options || v?.kind !== 'singleSelect') return Number.MAX_SAFE_INTEGER;
  const idx = f.options.findIndex((o) => o.id === v.optionId);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

export function sortItems(items: BoardItem[], sort: SortKey, dir: 'asc' | 'desc', schema: ProjectSchema): BoardItem[] {
  const m = dir === 'asc' ? 1 : -1;
  const cmp = (a: BoardItem, b: BoardItem): number => {
    switch (sort) {
      case 'created':
        return a.createdAt.localeCompare(b.createdAt);
      case 'number':
        return a.number - b.number;
      case 'title':
        return a.title.localeCompare(b.title);
      case 'priority':
        return optionRank(schema, PRIORITY, a) - optionRank(schema, PRIORITY, b) || b.updatedAt.localeCompare(a.updatedAt) * m;
      case 'status':
        return optionRank(schema, STATUS, a) - optionRank(schema, STATUS, b) || b.updatedAt.localeCompare(a.updatedAt) * m;
      default:
        return a.updatedAt.localeCompare(b.updatedAt);
    }
  };
  return [...items].sort((a, b) => cmp(a, b) * m);
}

export function teamCounts(items: BoardItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    if (it.state !== 'OPEN') continue;
    const t = selectName(it, TEAM) ?? '__none';
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}
