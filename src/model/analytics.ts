import type { BoardItem, OptionColor, ProjectField } from '@shared/types';
import { PRIORITY, needsTriage, selectName } from './board';

const DAY = 24 * 3600_000;
const WEEK = 7 * DAY;

export interface Bucket {
  label: string;
  color?: OptionColor;
  count: number;
}

export interface WeekPoint {
  /** ISO date of the Monday that starts the week. */
  weekStart: string;
  created: number;
  closed: number;
}

/** Monday 00:00 UTC of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.getTime();
}

/** Created vs closed per week — the single chart that says whether the backlog is winning. */
export function throughput(items: BoardItem[], weeks = 12, now = Date.now()): WeekPoint[] {
  const first = weekStart(now) - (weeks - 1) * WEEK;
  const points = new Map<number, WeekPoint>();
  for (let i = 0; i < weeks; i++) {
    const start = first + i * WEEK;
    points.set(start, {
      weekStart: new Date(start).toISOString().slice(0, 10),
      created: 0,
      closed: 0,
    });
  }
  const bump = (iso: string | null, key: 'created' | 'closed') => {
    if (!iso) return;
    const start = weekStart(Date.parse(iso));
    const p = points.get(start);
    if (p) p[key] += 1;
  };
  for (const it of items) {
    bump(it.createdAt, 'created');
    bump(it.closedAt, 'closed');
  }
  return [...points.values()];
}

/** Open issues per option of one single-select field, in the field's own option order. */
export function openByField(items: BoardItem[], f: ProjectField | undefined): Bucket[] {
  if (!f?.options) return [];
  const counts = new Map<string, number>();
  let none = 0;
  for (const it of items) {
    if (it.state !== 'OPEN') continue;
    const name = selectName(it, f.name);
    if (!name) none += 1;
    else counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const buckets: Bucket[] = f.options.map((o) => ({
    label: o.name,
    color: o.color,
    count: counts.get(o.name) ?? 0,
  }));
  if (none) buckets.push({ label: `No ${f.name.toLowerCase()}`, count: none });
  return buckets.filter((b) => b.count > 0);
}

const AGE_BUCKETS: { label: string; maxDays: number; color: OptionColor }[] = [
  { label: '< 1 week', maxDays: 7, color: 'GREEN' },
  { label: '1–4 weeks', maxDays: 28, color: 'BLUE' },
  { label: '1–3 months', maxDays: 90, color: 'YELLOW' },
  { label: '3–6 months', maxDays: 180, color: 'ORANGE' },
  { label: '> 6 months', maxDays: Infinity, color: 'RED' },
];

/** How long open issues have been open. The right-hand bars are the backlog debt. */
export function ageBuckets(items: BoardItem[], now = Date.now()): Bucket[] {
  const counts = AGE_BUCKETS.map((b) => ({ label: b.label, color: b.color, count: 0 }));
  for (const it of items) {
    if (it.state !== 'OPEN') continue;
    const days = (now - Date.parse(it.createdAt)) / DAY;
    const idx = AGE_BUCKETS.findIndex((b) => days < b.maxDays);
    counts[idx === -1 ? counts.length - 1 : idx]!.count += 1;
  }
  return counts;
}

/** Linear interpolation between ranks, so an even-sized sample gets a true median. */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface CycleTime {
  sample: number;
  medianDays: number;
  p90Days: number;
}

/** Days from open to close, over issues closed inside the window. */
export function cycleTime(items: BoardItem[], windowDays = 90, now = Date.now()): CycleTime {
  const cutoff = now - windowDays * DAY;
  const days = items
    .filter((it) => it.closedAt && Date.parse(it.closedAt) >= cutoff)
    .map((it) => (Date.parse(it.closedAt!) - Date.parse(it.createdAt)) / DAY)
    .sort((a, b) => a - b);
  return {
    sample: days.length,
    medianDays: Math.round(percentile(days, 0.5) * 10) / 10,
    p90Days: Math.round(percentile(days, 0.9) * 10) / 10,
  };
}

export interface Summary {
  open: number;
  createdRecently: number;
  closedRecently: number;
  needsTriage: number;
  urgentOpen: number;
  /** created − closed over the window: positive means the backlog grew. */
  net: number;
}

export function summarize(items: BoardItem[], windowDays = 30, now = Date.now()): Summary {
  const cutoff = now - windowDays * DAY;
  let open = 0;
  let createdRecently = 0;
  let closedRecently = 0;
  let triage = 0;
  let urgentOpen = 0;
  for (const it of items) {
    if (it.state === 'OPEN') open += 1;
    if (Date.parse(it.createdAt) >= cutoff) createdRecently += 1;
    if (it.closedAt && Date.parse(it.closedAt) >= cutoff) closedRecently += 1;
    if (needsTriage(it)) triage += 1;
    if (it.state === 'OPEN' && selectName(it, PRIORITY)?.toLowerCase() === 'urgent')
      urgentOpen += 1;
  }
  return {
    open,
    createdRecently,
    closedRecently,
    needsTriage: triage,
    urgentOpen,
    net: createdRecently - closedRecently,
  };
}
