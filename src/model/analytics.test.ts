import { describe, expect, it } from 'vitest';
import type { BoardItem, ProjectField } from '@shared/types';
import {
  UNASSIGNED_ID,
  ageBuckets,
  completedByPerson,
  cycleTime,
  openByField,
  summarize,
  throughput,
  weekStart,
} from './analytics';

const NOW = Date.parse('2026-09-07T12:00:00Z'); // a Monday
const DAY = 24 * 3600_000;

function item(partial: Partial<BoardItem> & { number: number }): BoardItem {
  return {
    itemId: `PVTI_${partial.number}`,
    issueId: `I_${partial.number}`,
    key: `RAD-${partial.number}`,
    title: 't',
    body: '',
    state: 'OPEN',
    stateReason: null,
    url: '',
    repository: 'o/r',
    createdAt: new Date(NOW - DAY).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
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
    pullRequests: [],
    watcherCount: 0,
    viewerWatching: false,
    viewerStarred: false,
    ...partial,
  };
}

describe('weekStart', () => {
  it('snaps to the Monday of that week', () => {
    expect(new Date(weekStart(Date.parse('2026-09-10T23:00:00Z'))).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
    expect(new Date(weekStart(Date.parse('2026-09-06T01:00:00Z'))).toISOString()).toBe(
      '2026-08-31T00:00:00.000Z',
    );
  });
});

describe('throughput', () => {
  const items = [
    item({ number: 1, createdAt: '2026-09-08T00:00:00Z' }),
    item({
      number: 2,
      createdAt: '2026-09-09T00:00:00Z',
      closedAt: '2026-09-10T00:00:00Z',
      state: 'CLOSED',
    }),
    item({ number: 3, createdAt: '2020-01-01T00:00:00Z' }), // older than the window
  ];

  it('returns one point per week, ending with the current week', () => {
    const weeks = throughput(items, 4, NOW);
    expect(weeks).toHaveLength(4);
    expect(weeks[3]!.weekStart).toBe('2026-09-07');
  });
  it('counts opens and closes into their own weeks and drops anything older', () => {
    const weeks = throughput(items, 4, NOW);
    expect(weeks[3]).toMatchObject({ created: 2, closed: 1 });
    expect(weeks.reduce((a, w) => a + w.created, 0)).toBe(2);
  });
});

describe('ageBuckets', () => {
  it('buckets open issues by age and ignores closed ones', () => {
    const items = [
      item({ number: 1, createdAt: new Date(NOW - 2 * DAY).toISOString() }),
      item({ number: 2, createdAt: new Date(NOW - 40 * DAY).toISOString() }),
      item({ number: 3, createdAt: new Date(NOW - 400 * DAY).toISOString() }),
      item({
        number: 4,
        createdAt: new Date(NOW - 400 * DAY).toISOString(),
        state: 'CLOSED',
        closedAt: new Date(NOW).toISOString(),
      }),
    ];
    expect(ageBuckets(items, NOW).map((b) => b.count)).toEqual([1, 0, 1, 0, 1]);
  });
});

describe('cycleTime', () => {
  it('measures open-to-close over the window only', () => {
    const items = [
      item({
        number: 1,
        createdAt: new Date(NOW - 10 * DAY).toISOString(),
        closedAt: new Date(NOW - 8 * DAY).toISOString(),
        state: 'CLOSED',
      }),
      item({
        number: 2,
        createdAt: new Date(NOW - 20 * DAY).toISOString(),
        closedAt: new Date(NOW - 10 * DAY).toISOString(),
        state: 'CLOSED',
      }),
      item({
        number: 3,
        createdAt: '2020-01-01T00:00:00Z',
        closedAt: '2020-02-01T00:00:00Z',
        state: 'CLOSED',
      }),
    ];
    const c = cycleTime(items, 90, NOW);
    expect(c.sample).toBe(2);
    expect(c.medianDays).toBe(6); // median of a 2-day and a 10-day issue
  });
  it('reports zeros rather than NaN when nothing closed', () => {
    expect(cycleTime([item({ number: 1 })], 90, NOW)).toEqual({
      sample: 0,
      medianDays: 0,
      p90Days: 0,
    });
  });
});

describe('summarize', () => {
  it('reports net backlog change over the window', () => {
    const items = [
      item({ number: 1, createdAt: new Date(NOW - 2 * DAY).toISOString() }),
      item({ number: 2, createdAt: new Date(NOW - 3 * DAY).toISOString() }),
      item({
        number: 3,
        createdAt: new Date(NOW - 4 * DAY).toISOString(),
        closedAt: new Date(NOW - DAY).toISOString(),
        state: 'CLOSED',
      }),
    ];
    const s = summarize(items, 30, NOW);
    expect(s).toMatchObject({ open: 2, createdRecently: 3, closedRecently: 1, net: 2 });
    expect(s.needsTriage).toBe(2);
  });
});

describe('openByField with a multi-valued field', () => {
  const TEAM_FIELD = {
    id: 'f-team',
    name: 'Team',
    dataType: 'MULTI_SELECT',
    options: [
      { id: 'o-ios', name: 'iOS', color: 'BLUE', description: '' },
      { id: 'o-web', name: 'Web', color: 'GREEN', description: '' },
    ],
  } as unknown as ProjectField;

  const withTeams = (number: number, names: [string, string][]) =>
    item({
      number,
      fields: {
        Team: { kind: 'multiSelect', options: names.map(([id, name]) => ({ id, name })) },
      },
    });

  it('counts an issue in every team that owns it', () => {
    const buckets = openByField(
      [withTeams(1, [['o-ios', 'iOS'], ['o-web', 'Web']]), withTeams(2, [['o-ios', 'iOS']])],
      TEAM_FIELD,
    );
    expect(buckets.find((b) => b.label === 'iOS')?.count).toBe(2);
    expect(buckets.find((b) => b.label === 'Web')?.count).toBe(1);
  });

  it('still reports issues with no team at all', () => {
    const buckets = openByField([item({ number: 3 })], TEAM_FIELD);
    expect(buckets.find((b) => b.label === 'No team')?.count).toBe(1);
  });
});

describe('completedByPerson', () => {
  const NOW = Date.parse('2026-09-14T12:00:00Z');
  const ana = { id: 'p-ana', name: 'Ana', avatarUrl: null };
  const bo = { id: 'p-bo', name: 'Bo', avatarUrl: null };

  const done = (number: number, assignees: typeof ana[], closedDaysAgo: number): BoardItem =>
    item({
      number,
      state: 'CLOSED',
      stateReason: 'COMPLETED',
      closedAt: new Date(NOW - closedDaysAgo * 24 * 3600_000).toISOString(),
      assignees,
    });

  it('counts completed issues per assignee, recent and all time', () => {
    const rows = completedByPerson([done(1, [ana], 2), done(2, [ana], 200), done(3, [bo], 5)], 30, NOW);
    expect(rows.map((r) => [r.person.name, r.recent, r.total])).toEqual([
      ['Ana', 1, 2],
      ['Bo', 1, 1],
    ]);
  });

  it('credits every assignee of a shared issue', () => {
    const rows = completedByPerson([done(1, [ana, bo], 1)], 30, NOW);
    expect(rows.every((r) => r.recent === 1 && r.total === 1)).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it('ignores work that was closed but not completed', () => {
    const canceled = item({
      number: 9,
      state: 'CLOSED',
      stateReason: 'NOT_PLANNED',
      closedAt: new Date(NOW).toISOString(),
      assignees: [ana],
    });
    expect(completedByPerson([canceled], 30, NOW)).toEqual([]);
  });

  it('ignores issues that are still open', () => {
    expect(completedByPerson([item({ number: 10, assignees: [ana] })], 30, NOW)).toEqual([]);
  });

  it('keeps unassigned completed work visible rather than dropping it', () => {
    const rows = completedByPerson([done(1, [], 1)], 30, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.person.id).toBe(UNASSIGNED_ID);
    expect(rows[0]!.total).toBe(1);
  });

  it('ranks by recent work first, then by all-time', () => {
    const rows = completedByPerson(
      [done(1, [ana], 500), done(2, [ana], 400), done(3, [ana], 300), done(4, [bo], 1)],
      30,
      NOW,
    );
    expect(rows[0]!.person.name).toBe('Bo');
    expect(rows[1]!.person.name).toBe('Ana');
  });
});
