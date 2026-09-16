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
  optionRank,
  selectNames,
  selectOptions,
  sortItems,
  teamCounts,
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
    collaborators: [],
    labels: [],
    commentCount: 0,
    isArchived: false,
    parent: null,
    subIssues: { total: 0, completed: 0, percent: 0 },
    reactions: [],
    fields: {},
    pullRequests: [],
    watcherCount: 0,
    viewerWatching: false,
    viewerStarred: false,
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
    assignees: [{ id: 'alice', name: 'Alice', avatarUrl: null }],
    collaborators: [{ id: 'bob', name: 'Bob', avatarUrl: null }],
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
    expect(groups.map((g) => g.label)).toEqual(['Alice', 'Unassigned']);
  });
  it('groups by collaborator', () => {
    const groups = groupItems(items, 'Collaborator', schema);
    expect(groups.map((g) => g.label)).toEqual(['Bob', 'No collaborators']);
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
  it('filters by collaborator id', () => {
    expect(
      filterItems(items, { ...DEFAULT_FILTERS, collaborators: ['bob'] }).map((i) => i.number),
    ).toEqual([3]);
  });
  it('filters by no collaborators', () => {
    expect(
      filterItems(items, { ...DEFAULT_FILTERS, collaborators: ['__none'] }).map((i) => i.number),
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

// ---------- Multi-valued Team ----------

const multiSchema: ProjectSchema = {
  ...schema,
  fields: schema.fields.map((f) =>
    f.name === 'Team' ? { ...f, dataType: 'MULTI_SELECT' as const } : f,
  ),
};

const teamItem = (number: number, names: ('iOS' | 'Web')[]) =>
  item({
    number,
    fields: {
      Team: {
        kind: 'multiSelect',
        options: names.map((n) => ({ id: n === 'iOS' ? 'ios' : 'web', name: n })),
      },
      Priority: { kind: 'singleSelect', optionId: 'low', name: 'Low' },
      'Work type': { kind: 'singleSelect', optionId: 'bug', name: 'Bug' },
    },
  });

describe('multi-valued Team', () => {
  it('reads every option name, and still reads single-select fields', () => {
    expect(selectNames(teamItem(1, ['iOS', 'Web']), 'Team')).toEqual(['iOS', 'Web']);
    expect(selectNames(teamItem(1, []), 'Team')).toEqual([]);
    expect(selectNames(items[0]!, 'Team')).toEqual(['iOS']);
  });

  it('resolves options against the schema so colours survive', () => {
    const opts = selectOptions(
      teamItem(1, ['Web']),
      multiSchema.fields.find((f) => f.name === 'Team'),
    );
    expect(opts.map((o) => [o.name, o.color])).toEqual([['Web', 'PURPLE']]);
  });

  it('matches the team lens if the issue belongs to that team among others', () => {
    const list = [teamItem(1, ['iOS', 'Web']), teamItem(2, ['Web']), teamItem(3, [])];
    const onlyIos = filterItems(list, { ...DEFAULT_FILTERS, team: 'iOS' });
    expect(onlyIos.map((i) => i.number)).toEqual([1]);
    const onlyWeb = filterItems(list, { ...DEFAULT_FILTERS, team: 'Web' });
    expect(onlyWeb.map((i) => i.number)).toEqual([1, 2]);
  });

  it('matches a select filter when any of its options was picked', () => {
    const list = [teamItem(1, ['iOS', 'Web']), teamItem(2, ['Web']), teamItem(3, [])];
    const picked = filterItems(list, { ...DEFAULT_FILTERS, select: { Team: ['iOS'] } });
    expect(picked.map((i) => i.number)).toEqual([1]);
    const none = filterItems(list, { ...DEFAULT_FILTERS, select: { Team: ['__none'] } });
    expect(none.map((i) => i.number)).toEqual([3]);
  });

  it('counts an issue under each of its teams', () => {
    const counts = teamCounts([teamItem(1, ['iOS', 'Web']), teamItem(2, ['Web']), teamItem(3, [])]);
    expect(counts.get('iOS')).toBe(1);
    expect(counts.get('Web')).toBe(2);
    expect(counts.get('__none')).toBe(1);
  });

  it('treats any team as satisfying the Team triage requirement', () => {
    expect(missingTriageFields(teamItem(1, ['Web']))).not.toContain('Team');
    expect(missingTriageFields(teamItem(2, []))).toContain('Team');
  });

  it('sorts a multi-team issue by its highest-ranked team', () => {
    // iOS is option 0, Web option 1, so an iOS+Web issue ranks with iOS.
    expect(optionRank(multiSchema, 'Team', teamItem(1, ['Web', 'iOS']))).toBe(0);
    expect(optionRank(multiSchema, 'Team', teamItem(2, ['Web']))).toBe(1);
    expect(optionRank(multiSchema, 'Team', teamItem(3, []))).toBe(Number.MAX_SAFE_INTEGER);
  });
});
