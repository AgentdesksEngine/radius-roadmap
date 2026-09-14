import type {
  BoardItem,
  FieldOption,
  FieldValue,
  FieldWriteValue,
  OptionColor,
  ProjectField,
  ProjectSchema,
} from '@shared/types';

export const STATUS = 'Status';
export const TEAM = 'Team';
export const PRIORITY = 'Priority';
export const SEVERITY = 'Severity';
export const WORK_TYPE = 'Work type';
export const MODULE = 'Module';
export const PLATFORM = 'Platform';

/** Fields an issue must have before anyone can pick it up. Drives the intake queue. */
export const TRIAGE_FIELDS = [TEAM, PRIORITY, WORK_TYPE];

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

/** Fields the board can group by / drag between — one option per item, so one column per item. */
export function selectFields(schema: ProjectSchema): ProjectField[] {
  return schema.fields.filter((f) => f.dataType === 'SINGLE_SELECT');
}

/** Fields that can be filtered on. Unlike grouping, a multi-select filter is well defined. */
export function filterableFields(schema: ProjectSchema): ProjectField[] {
  return schema.fields.filter(
    (f) => f.dataType === 'SINGLE_SELECT' || f.dataType === 'MULTI_SELECT',
  );
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

/** Option names set on `item` for a select field, single- or multi-valued. */
export function selectNames(item: BoardItem, name: string): string[] {
  const v = item.fields[name];
  if (v?.kind === 'singleSelect') return [v.name];
  if (v?.kind === 'multiSelect') return v.options.map((o) => o.name);
  return [];
}

export function selectOption(
  item: BoardItem,
  f: ProjectField | undefined,
): FieldOption | undefined {
  if (!f) return undefined;
  const v = item.fields[f.name];
  return v?.kind === 'singleSelect' ? f.options?.find((o) => o.id === v.optionId) : undefined;
}

/**
 * Options set on `item` for a select field, resolved against the schema so callers get the
 * colour too — the stored multi-select value carries only id and name.
 */
export function selectOptions(item: BoardItem, f: ProjectField | undefined): FieldOption[] {
  if (!f) return [];
  const v = item.fields[f.name];
  const ids =
    v?.kind === 'singleSelect'
      ? [v.optionId]
      : v?.kind === 'multiSelect'
        ? v.options.map((o) => o.id)
        : [];
  return ids
    .map((id) => f.options?.find((o) => o.id === id))
    .filter((o): o is FieldOption => Boolean(o));
}

/**
 * Shapes a field write to match the field's arity, so callers that set an option don't
 * have to care whether the field is single- or multi-valued.
 */
export function selectWrite(f: ProjectField, optionIds: string[]): FieldWriteValue | null {
  if (!optionIds.length) return null;
  return f.dataType === 'MULTI_SELECT'
    ? { multiSelectOptionIds: optionIds }
    : { singleSelectOptionId: optionIds[0]! };
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
        let g = map.get(a.id);
        if (!g) {
          g = { key: a.id, label: a.name || 'Unknown', items: [] };
          map.set(a.id, g);
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
    f.options.map((o) => [
      o.id,
      { key: o.id, label: o.name, color: o.color, optionId: o.id, items: [] },
    ]),
  );
  const none: Group = {
    key: '__none',
    label: `No ${f.name.toLowerCase()}`,
    empty: true,
    items: [],
  };
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
  assignees: string[]; // profile ids, '__none' = unassigned
  query: string;
  /** Archived items are a separate world: true shows only them, false only the live board. */
  archived: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  team: null,
  state: 'active',
  select: {},
  assignees: [],
  query: '',
  archived: false,
};

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
      return (
        item.state === 'OPEN' ||
        (item.closedAt != null && now - Date.parse(item.closedAt) < RECENT_MS)
      );
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
  return item.assignees.some((a) => a.name?.toLowerCase().includes(q));
}

export function filterItems(items: BoardItem[], filters: Filters, now = Date.now()): BoardItem[] {
  const q = normalizeQuery(filters.query);
  const selectEntries = Object.entries(filters.select).filter(([, v]) => v.length);
  return items.filter((it) => {
    if (it.isArchived !== filters.archived) return false;
    if (filters.team && !selectNames(it, TEAM).includes(filters.team)) return false;
    if (!matchesState(it, filters.state, now)) return false;
    for (const [fname, names] of selectEntries) {
      // A multi-valued field matches if any of its options was picked.
      const vs = selectNames(it, fname);
      const hit = vs.length ? vs.some((v) => names.includes(v)) : names.includes('__none');
      if (!hit) return false;
    }
    if (filters.assignees.length) {
      const ids = it.assignees.map((a) => a.id);
      const hit = filters.assignees.some((a) =>
        a === '__none' ? ids.length === 0 : ids.includes(a),
      );
      if (!hit) return false;
    }
    return matchesQuery(it, q);
  });
}

export function activeFilterCount(f: Filters) {
  return (
    Object.values(f.select).filter((v) => v.length).length +
    (f.assignees.length ? 1 : 0) +
    (f.state !== 'active' ? 1 : 0) +
    (f.archived ? 1 : 0)
  );
}

// ---------- Intake ----------

/**
 * An issue is in intake until someone has said who owns it, how urgent it is and what
 * kind of work it is. Everything else about triage is a judgement call; this part isn't.
 */
export function missingTriageFields(item: BoardItem): string[] {
  return TRIAGE_FIELDS.filter((name) => selectNames(item, name).length === 0);
}

export function needsTriage(item: BoardItem): boolean {
  return item.state === 'OPEN' && !item.isArchived && missingTriageFields(item).length > 0;
}

export function intakeItems(items: BoardItem[]): BoardItem[] {
  return items.filter(needsTriage).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- Sub-issues ----------

/** Children are derived from the board rather than fetched: every issue here is a project item. */
export function childrenOf(items: BoardItem[], parentNumber: number): BoardItem[] {
  return items.filter((i) => i.parent?.number === parentNumber).sort((a, b) => a.number - b.number);
}

// ---------- Sorting ----------

export type SortKey = 'manual' | 'updated' | 'created' | 'priority' | 'number' | 'title' | 'status';

export function optionRank(schema: ProjectSchema, fieldName: string, item: BoardItem): number {
  const f = field(schema, fieldName);
  if (!f?.options) return Number.MAX_SAFE_INTEGER;
  // A multi-valued field sorts by its highest-ranked option.
  const ranks = selectOptions(item, f).map((o) => f.options!.findIndex((x) => x.id === o.id));
  const best = Math.min(...ranks.filter((i) => i !== -1));
  return Number.isFinite(best) ? best : Number.MAX_SAFE_INTEGER;
}

export function sortItems(
  items: BoardItem[],
  sort: SortKey,
  dir: 'asc' | 'desc',
  schema: ProjectSchema,
): BoardItem[] {
  // 'manual' is the project's own item order, which is how the API returns them.
  if (sort === 'manual') return items;
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
        return (
          optionRank(schema, PRIORITY, a) - optionRank(schema, PRIORITY, b) ||
          b.updatedAt.localeCompare(a.updatedAt) * m
        );
      case 'status':
        return (
          optionRank(schema, STATUS, a) - optionRank(schema, STATUS, b) ||
          b.updatedAt.localeCompare(a.updatedAt) * m
        );
      default:
        return a.updatedAt.localeCompare(b.updatedAt);
    }
  };
  return [...items].sort((a, b) => cmp(a, b) * m);
}

/**
 * Sort key for an arbitrary field, so a spreadsheet column of any data type can be
 * ordered. Select fields sort by the option order the project defines rather than
 * alphabetically — "Urgent" before "Low", not after it. Empty always sorts last.
 */
export function fieldSortValue(
  schema: ProjectSchema,
  item: BoardItem,
  fieldName: string,
): string | number {
  const f = field(schema, fieldName);
  const v = item.fields[fieldName];
  const emptyRank = f?.options ? Number.MAX_SAFE_INTEGER : '\uffff';
  if (!v) return emptyRank;
  switch (v.kind) {
    case 'singleSelect':
      return optionRank(schema, fieldName, item);
    case 'multiSelect':
      return v.options.length
        ? v.options
            .map((o) => o.name)
            .join(', ')
            .toLowerCase()
        : '\uffff';
    case 'text':
      return v.text ? v.text.toLowerCase() : '\uffff';
    case 'number':
      return v.number;
    case 'date':
      return v.date;
    case 'iteration':
      return v.startDate;
    default:
      return emptyRank;
  }
}

export function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function teamCounts(items: BoardItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    if (it.state !== 'OPEN' || it.isArchived) continue;
    // An issue owned by several teams counts once under each, so the per-team
    // tallies can add up to more than the board total.
    const ts = selectNames(it, TEAM);
    for (const t of ts.length ? ts : ['__none']) m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}
