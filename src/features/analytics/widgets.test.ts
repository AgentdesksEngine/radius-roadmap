/**
 * A widget is a name of a measure. These tests pin the mapping from that name to the chart
 * shape and the label, which is the only logic a custom dashboard actually adds — the numbers
 * themselves are src/model/analytics.ts, tested separately.
 */
import { describe, expect, it } from 'vitest';
import type { BoardItem, ProjectSchema, Widget } from '@shared/types';
import { widgetData, widgetTitle } from './widgets';

const SCHEMA = {
  keyPrefix: 'RAD',
  fields: [
    {
      id: 'f-status',
      name: 'Status',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'o-todo', name: 'Todo', color: 'GRAY', description: '' },
        { id: 'o-done', name: 'Done', color: 'PURPLE', description: '' },
      ],
    },
    { id: 'f-brokerage', name: 'Brokerage', dataType: 'TEXT' },
  ],
} as unknown as ProjectSchema;

function item(partial: Partial<BoardItem> & { number: number }): BoardItem {
  const now = new Date().toISOString();
  return {
    itemId: `i${partial.number}`,
    issueId: `i${partial.number}`,
    key: `RAD-${partial.number}`,
    title: 't',
    body: '',
    state: 'OPEN',
    stateReason: null,
    url: '',
    repository: 'o/r',
    createdAt: now,
    updatedAt: now,
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

const ITEMS = [
  item({ number: 1, fields: { Status: { kind: 'singleSelect', optionId: 'o-todo', name: 'Todo' } } }),
  item({ number: 2, fields: { Status: { kind: 'singleSelect', optionId: 'o-todo', name: 'Todo' } } }),
  item({ number: 3, fields: { Status: { kind: 'singleSelect', optionId: 'o-done', name: 'Done' } } }),
];

const w = (over: Partial<Widget>): Widget => ({ id: 'w1', measure: 'stat', ...over });

describe('widgetTitle', () => {
  it('names a breakdown after the field it groups by', () => {
    expect(widgetTitle(w({ measure: 'openByField', groupBy: 'Team' }))).toBe('Open by team');
  });

  it('names a counter after the number it shows', () => {
    expect(widgetTitle(w({ measure: 'stat', stat: 'urgentOpen' }))).toBe('Urgent and open');
  });

  it('lets an explicit title win', () => {
    expect(widgetTitle(w({ measure: 'throughput', title: 'Ship rate' }))).toBe('Ship rate');
  });
});

describe('widgetData', () => {
  it('turns a breakdown into bars, using the option colours', () => {
    const data = widgetData(w({ measure: 'openByField', groupBy: 'Status' }), ITEMS, SCHEMA);
    expect(data.kind).toBe('bars');
    if (data.kind !== 'bars') return;
    expect(data.useOptionColors).toBe(true);
    expect(data.buckets.find((b) => b.label === 'Todo')?.count).toBe(2);
  });

  it('says what to do instead of rendering an empty chart when no field is chosen', () => {
    const data = widgetData(w({ measure: 'openByField' }), ITEMS, SCHEMA);
    expect(data.kind).toBe('bars');
    if (data.kind !== 'bars') return;
    expect(data.buckets).toEqual([]);
    expect(data.empty).toMatch(/pick a field/i);
  });

  it('counts open issues for the open stat', () => {
    const data = widgetData(w({ measure: 'stat', stat: 'open' }), ITEMS, SCHEMA);
    expect(data).toMatchObject({ kind: 'stat', value: 3 });
  });

  it('signs the net-change stat and tells the reader which way is bad', () => {
    const data = widgetData(w({ measure: 'stat', stat: 'net' }), ITEMS, SCHEMA);
    expect(data.kind).toBe('stat');
    if (data.kind !== 'stat') return;
    expect(data.value).toBe('+3');
    expect(data.tone).toBe('bad');
  });

  it('produces a week series for throughput', () => {
    const data = widgetData(w({ measure: 'throughput' }), ITEMS, SCHEMA);
    expect(data.kind).toBe('throughput');
    if (data.kind !== 'throughput') return;
    expect(data.data.length).toBeGreaterThan(0);
  });

  it('shows a dash, not a zero, when nothing has closed', () => {
    const data = widgetData(w({ measure: 'cycleTime' }), ITEMS, SCHEMA);
    expect(data).toMatchObject({ kind: 'stat', value: '—' });
  });

  it('turns completed-per-person into table rows', () => {
    const closed = item({
      number: 9,
      state: 'CLOSED',
      stateReason: 'COMPLETED',
      closedAt: new Date().toISOString(),
      assignees: [{ id: 'p1', name: 'Ana', avatarUrl: null }],
    });
    const data = widgetData(w({ measure: 'completedByPerson' }), [...ITEMS, closed], SCHEMA);
    expect(data.kind).toBe('people');
    if (data.kind !== 'people') return;
    expect(data.title).toBe('Completed per person');
    expect(data.rows.map((r) => [r.person.name, r.total])).toEqual([['Ana', 1]]);
  });

  it('round-trips through the JSON that gets stored on the dashboard', () => {
    const widget = w({ measure: 'openByField', groupBy: 'Status' });
    const restored = JSON.parse(JSON.stringify([widget]))[0] as Widget;
    expect(widgetData(restored, ITEMS, SCHEMA)).toEqual(widgetData(widget, ITEMS, SCHEMA));
  });
});
