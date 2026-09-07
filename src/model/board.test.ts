import { describe, expect, it } from 'vitest';
import type { BoardItem, ProjectSchema } from '@shared/types';
import {
  DEFAULT_FILTERS,
  childrenOf,
  filterItems,
  groupItems,
  intakeItems,
  matchesQuery,
  missingTriageFields,
  needsTriage,
  sortItems,
} from './board';

const schema: ProjectSchema = {
  projectId: 'P',
  title: 't',
  url: '',
  org: 'o',
  number: 6,
  keyPrefix: 'RAD',
  repository: { id: 'R', name: 'r', nameWithOwner: 'o/r', labels: [] },
  fields: [
    {
      id: 'F_status',
      name: 'Status',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'todo', name: 'Todo', color: 'GRAY', description: '' },
        { id: 'done', name: 'Done', color: 'PURPLE', description: '' },
      ],
    },
    {
      id: 'F_team',
      name: 'Team',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'ios', name: 'iOS', color: 'BLUE', description: '' },
        { id: 'web', name: 'Web', color: 'PURPLE', description: '' },
      ],
    },
    {
      id: 'F_prio',
      name: 'Priority',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'urgent', name: 'Urgent', color: 'RED', description: '' },
        { id: 'low', name: 'Low', color: 'GRAY', description: '' },
      ],
    },
  ],
};

function item(partial: Partial<BoardItem> & { number: number }): BoardItem {
  return {
    itemId: `PVTI_${partial.number}`,
    issueId: `I_${partial.number}`,
    key: `RAD-${partial.number}`,
    title: `Issue ${partial.number}`,
    body: '',
    state: 'OPEN',
    stateReason: null,
    url: '',
    repository: 'o/r',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    closedAt: null,
    author: null,
    assignees: [],
    labels: [],
    commentCount: 0,
    isArchived: false,
    parent: null,
    subIssues: { total: 0, completed: 0, percent: 0 },
    reactions: [],
    fields: {},
    ...partial,
  };
}

const items = [
  item({
    number: 1,
    fields: {
      Status: { kind: 'singleSelect', optionId: 'todo', name: 'Todo' },
      Team: { kind: 'singleSelect', optionId: 'ios', name: 'iOS' },
    },
  }),
  item({
    number: 2,
    state: 'CLOSED',
    closedAt: '2020-01-01T00:00:00Z',
    fields: {
      Status: { kind: 'singleSelect', optionId: 'done', name: 'Done' },
      Priority: { kind: 'singleSelect', optionId: 'urgent', name: 'Urgent' },
    },
  }),
  item({
    number: 3,
    title: 'Crash on login',
    body: 'Stack trace mentions keychain',
    assignees: [{ login: 'alice', avatarUrl: '' }],
  }),
];

describe('groupItems', () => {
  it('creates one group per option in schema order plus an empty group first when needed', () => {
    const groups = groupItems(items, 'Status', schema);
    expect(groups.map((g) => g.label)).toEqual(['No status', 'Todo', 'Done']);
    expect(groups[1]!.items.map((i) => i.number)).toEqual([1]);
    expect(groups[0]!.items.map((i) => i.number)).toEqual([3]);
  });
  it('groups by assignee', () => {
    const groups = groupItems(items, 'Assignee', schema);
    expect(groups.map((g) => g.label)).toEqual(['alice', 'Unassigned']);
  });
});

describe('filterItems', () => {
  it('hides long-closed items in the default active view', () => {
    expect(filterItems(items, DEFAULT_FILTERS).map((i) => i.number)).toEqual([1, 3]);
  });
  it('filters by team option name', () => {
    expect(filterItems(items, { ...DEFAULT_FILTERS, team: 'iOS' }).map((i) => i.number)).toEqual([
      1,
    ]);
  });
  it('treats missing values as __none in select filters', () => {
    expect(
      filterItems(items, {
        ...DEFAULT_FILTERS,
        state: 'all',
        select: { Priority: ['__none'] },
      }).map((i) => i.number),
    ).toEqual([1, 3]);
  });
  it('filters unassigned', () => {
    expect(
      filterItems(items, { ...DEFAULT_FILTERS, assignees: ['__none'] }).map((i) => i.number),
    ).toEqual([1]);
  });
});

describe('matchesQuery', () => {
  it('matches key, number, title and body', () => {
    expect(matchesQuery(items[2]!, 'rad-3')).toBe(true);
    expect(matchesQuery(items[2]!, '3')).toBe(true);
    expect(matchesQuery(items[2]!, 'keychain')).toBe(true);
    expect(matchesQuery(items[2]!, 'crash')).toBe(true);
    expect(matchesQuery(items[2]!, 'android')).toBe(false);
  });
});

describe('sortItems', () => {
  it('sorts by priority rank with unset last', () => {
    expect(sortItems(items, 'priority', 'asc', schema).map((i) => i.number)).toEqual([2, 1, 3]);
  });
});

describe('archived items', () => {
  const archived = item({ number: 4, isArchived: true });
  const all = [...items, archived];

  it('are hidden from every normal view', () => {
    expect(filterItems(all, { ...DEFAULT_FILTERS, state: 'all' }).map((i) => i.number)).toEqual([
      1, 2, 3,
    ]);
  });
  it('are the only thing the archived view shows', () => {
    expect(
      filterItems(all, { ...DEFAULT_FILTERS, state: 'all', archived: true }).map((i) => i.number),
    ).toEqual([4]);
  });
});

describe('intake', () => {
  const triaged = item({
    number: 5,
    fields: {
      Team: { kind: 'singleSelect', optionId: 'ios', name: 'iOS' },
      Priority: { kind: 'singleSelect', optionId: 'low', name: 'Low' },
      'Work type': { kind: 'singleSelect', optionId: 'bug', name: 'Bug' },
    },
  });

  it('lists what each issue is still missing', () => {
    expect(missingTriageFields(triaged)).toEqual([]);
    expect(missingTriageFields(items[0]!)).toEqual(['Priority', 'Work type']);
  });
  it('leaves fully triaged, closed and archived issues out of the queue', () => {
    expect(needsTriage(triaged)).toBe(false);
    expect(needsTriage(items[1]!)).toBe(false); // closed
    expect(needsTriage(item({ number: 6, isArchived: true }))).toBe(false);
  });
  it('queues untriaged open issues newest first', () => {
    const older = item({ number: 7, createdAt: '2025-01-01T00:00:00Z' });
    expect(intakeItems([older, ...items, triaged]).map((i) => i.number)).toEqual([1, 3, 7]);
  });
});

describe('childrenOf', () => {
  it('finds sub-issues by their parent number, in issue order', () => {
    const parent = {
      id: 'I_1',
      number: 1,
      key: 'RAD-1',
      title: 'p',
      state: 'OPEN' as const,
      stateReason: null,
      url: '',
      assignees: [],
    };
    const kids = [item({ number: 9, parent }), item({ number: 8, parent }), item({ number: 10 })];
    expect(childrenOf(kids, 1).map((i) => i.number)).toEqual([8, 9]);
  });
});

describe('manual sort', () => {
  it('leaves the project order untouched', () => {
    expect(sortItems(items, 'manual', 'asc', schema).map((i) => i.number)).toEqual([1, 2, 3]);
  });
});
