import type { BoardItem, ProjectSchema, Widget, WidgetMeasure, WidgetStat } from '@shared/types';
import { field } from '@/model/board';
import {
  ageBuckets,
  completedByPerson,
  cycleTime,
  openByField,
  summarize,
  throughput,
  type Bucket,
  type PersonCompleted,
  type WeekPoint,
} from '@/model/analytics';

/**
 * A dashboard widget is a *name of a measure*, not a query. Everything below runs over the
 * board that is already in the cache, using the same helpers /analytics uses, so a custom
 * dashboard can never disagree with the default one.
 */

export const STAT_LABELS: Record<WidgetStat, string> = {
  open: 'Open issues',
  createdRecently: 'Opened, last 30 days',
  closedRecently: 'Closed, last 30 days',
  needsTriage: 'Waiting on triage',
  urgentOpen: 'Urgent and open',
  net: 'Net change, 30 days',
};

export const MEASURE_LABELS: Record<WidgetMeasure, string> = {
  stat: 'A single number',
  openByField: 'Open issues, broken down by a field',
  throughput: 'Opened vs closed, by week',
  age: 'How long open issues have been open',
  cycleTime: 'Median time to close',
  completedByPerson: 'Completed issues per person',
};

/** Fields worth grouping by — the select fields, which are the ones with a fixed option list. */
export function groupableFields(schema: ProjectSchema | undefined): string[] {
  return (schema?.fields ?? []).filter((f) => f.options?.length).map((f) => f.name);
}

export function widgetTitle(w: Widget): string {
  if (w.title) return w.title;
  switch (w.measure) {
    case 'stat':
      return w.stat ? STAT_LABELS[w.stat] : 'Number';
    case 'openByField':
      return w.groupBy ? `Open by ${w.groupBy.toLowerCase()}` : 'Open issues';
    case 'throughput':
      return 'Throughput';
    case 'age':
      return 'Age of open issues';
    case 'cycleTime':
      return 'Median time to close';
    case 'completedByPerson':
      return 'Completed per person';
  }
}

export type WidgetData =
  | { kind: 'stat'; label: string; value: string | number; sub?: string; tone?: 'good' | 'bad' }
  | { kind: 'bars'; title: string; buckets: Bucket[]; useOptionColors: boolean; empty?: string }
  | { kind: 'throughput'; data: WeekPoint[] }
  | { kind: 'people'; title: string; rows: PersonCompleted[] };

export function widgetData(w: Widget, items: BoardItem[], schema: ProjectSchema | undefined): WidgetData {
  switch (w.measure) {
    case 'throughput':
      return { kind: 'throughput', data: throughput(items) };

    case 'completedByPerson':
      return { kind: 'people', title: widgetTitle(w), rows: completedByPerson(items) };

    case 'age':
      return {
        kind: 'bars',
        title: widgetTitle(w),
        buckets: ageBuckets(items),
        useOptionColors: false,
        empty: 'No open issues',
      };

    case 'openByField':
      return {
        kind: 'bars',
        title: widgetTitle(w),
        buckets: w.groupBy ? openByField(items, field(schema, w.groupBy)) : [],
        useOptionColors: true,
        empty: 'Pick a field for this widget',
      };

    case 'cycleTime': {
      const cycle = cycleTime(items);
      return {
        kind: 'stat',
        label: widgetTitle(w),
        value: cycle.sample ? `${cycle.medianDays}d` : '—',
        sub: cycle.sample
          ? `p90 ${cycle.p90Days}d · ${cycle.sample} closed in 90 days`
          : 'nothing closed in 90 days',
      };
    }

    case 'stat': {
      const stats = summarize(items);
      const stat = w.stat ?? 'open';
      if (stat === 'net') {
        return {
          kind: 'stat',
          label: w.title ?? STAT_LABELS.net,
          value: stats.net > 0 ? `+${stats.net}` : stats.net,
          sub: stats.net > 0 ? 'backlog grew' : stats.net < 0 ? 'backlog shrank' : 'flat',
          tone: stats.net > 0 ? 'bad' : stats.net < 0 ? 'good' : undefined,
        };
      }
      const value = stats[stat];
      const bad = stat === 'needsTriage' || stat === 'urgentOpen';
      return {
        kind: 'stat',
        label: w.title ?? STAT_LABELS[stat],
        value,
        ...(bad ? { tone: value > 0 ? ('bad' as const) : ('good' as const) } : {}),
      };
    }
  }
}

/** Ids only need to be unique inside one dashboard's widget array. */
export function newWidgetId(): string {
  return `w${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
}
