import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange } from 'lucide-react';
import type { Dashboard } from '@shared/types';
import { useBoard, useDashboards, useSchema } from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { Picker } from '@/components/ui/Picker';
import { MODULE, PRIORITY, STATUS, TEAM, WORK_TYPE, field, filterItems } from '@/model/board';
import {
  ageBuckets,
  completedByPerson,
  cycleTime,
  openByField,
  summarize,
  throughput,
} from '@/model/analytics';
import { usePref } from '@/model/prefs';
import { encodeFilters } from '@/model/views';
import { ViewHeader } from '../shell/ViewHeader';
import { useUi } from '../shell/state';
import { BarList, CompletedTable, StatTile, ThroughputChart } from './Charts';
import { AddWidget, DashboardPicker, DEFAULT_DASHBOARD_ID, RemoveWidget } from './Dashboards';
import { widgetData, widgetTitle } from './widgets';
import './analytics.css';

/** STATS-02: the windows used to be hard-coded at 30 and 90 days. */
const RANGES = [
  { id: '30d', label: '30 days', days: 30, weeks: 6 },
  { id: '90d', label: '90 days', days: 90, weeks: 13 },
  { id: '12mo', label: '12 months', days: 365, weeks: 52 },
] as const;

type RangeId = (typeof RANGES)[number]['id'];

/**
 * Everything here is computed in the browser from the board the app already has, so the
 * numbers always match what the other views are showing — no second source of truth. Custom
 * dashboards are the same measures rearranged: only the *layout* is stored, never a query.
 * Every figure is also a link into the issues behind it.
 */
export function AnalyticsView() {
  const { data: schema } = useSchema();
  const board = useBoard(Boolean(schema));
  const { data: dashboards } = useDashboards(Boolean(schema));
  const { filters } = useUi();
  const navigate = useNavigate();
  const [rangeId, setRangeId] = usePref<RangeId>('analyticsRange', '30d');
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[0];
  const [currentId, setCurrentId] = useState(DEFAULT_DASHBOARD_ID);
  const current = dashboards?.find((d) => d.id === currentId);

  // Analytics needs the full history, so the state filter is dropped; team and the rest hold.
  const items = useMemo(
    () =>
      board.data ? filterItems(board.data.items, { ...filters, state: 'all', query: '' }) : [],
    [board.data, filters],
  );

  const stats = useMemo(() => summarize(items, range.days), [items, range.days]);
  const weeks = useMemo(() => throughput(items, range.weeks), [items, range.weeks]);
  const cycle = useMemo(() => cycleTime(items, range.days), [items, range.days]);
  const ages = useMemo(() => ageBuckets(items), [items]);
  const completed = useMemo(() => completedByPerson(items), [items]);

  const scope = filters.team ? `${filters.team} · ` : '';

  /** STATS-01: carry the page's scope into the view being opened. */
  const go = (path: string, patch: Partial<Parameters<typeof encodeFilters>[0]> = {}) => {
    const next = { ...filters, state: 'open' as const, query: '', ...patch };
    const encoded = encodeFilters(next);
    navigate(encoded ? `${path}?f=${encodeURIComponent(encoded)}` : path);
  };

  const bySelect = (f: ReturnType<typeof field>) => (value: string) => {
    if (!f) return;
    go('/list', { select: { ...filters.select, [f.name]: [value] } });
  };

  const priorityField = field(schema, PRIORITY);

  return (
    <>
      {/* STATS-03: this view drops filters.query, so it no longer offers a search box. */}
      <ViewHeader title="Analytics" count={board.data ? items.length : undefined} search={false}>
        <DashboardPicker
          dashboards={dashboards ?? []}
          currentId={currentId}
          onSelect={setCurrentId}
        />
        {current && <AddWidget dashboard={current} schema={schema} />}
        <Picker
          items={RANGES.map((r) => ({ id: r.id, label: r.label }))}
          value={rangeId}
          onSelect={(id) => setRangeId(id as RangeId)}
          placeholder="Range…"
        >
          <Button size="sm" variant="ghost" icon={<CalendarRange />}>
            {range.label}
          </Button>
        </Picker>
      </ViewHeader>

      {board.isError && (
        <div className="error-banner">
          <span>Couldn’t load issues: {(board.error as Error).message}</span>
          <Button size="sm" onClick={() => board.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!schema || board.isPending ? (
        <div className="list-skeleton" aria-busy>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 60 }} />
          ))}
        </div>
      ) : current ? (
        <CustomDashboard dashboard={current} items={items} schema={schema} />
      ) : items.length === 0 ? (
        <div className="empty-view">
          <span>Nothing to measure yet — no issues match the current filters.</span>
        </div>
      ) : (
        <div className="analytics">
          <div className="stat-row">
            <StatTile
              label={`${scope}Open issues`}
              value={stats.open}
              onClick={() => go('/list')}
            />
            <StatTile label={`Opened, last ${range.label}`} value={stats.createdRecently} />
            <StatTile label={`Closed, last ${range.label}`} value={stats.closedRecently} />
            <StatTile
              label={`Net change, ${range.label}`}
              value={stats.net > 0 ? `+${stats.net}` : stats.net}
              sub={stats.net > 0 ? 'backlog grew' : stats.net < 0 ? 'backlog shrank' : 'flat'}
              tone={stats.net > 0 ? 'bad' : stats.net < 0 ? 'good' : undefined}
            />
            <StatTile
              label="Waiting on triage"
              value={stats.needsTriage}
              tone={stats.needsTriage > 0 ? 'bad' : 'good'}
              onClick={() => navigate('/inbox')}
            />
            <StatTile
              label="Urgent and open"
              value={stats.urgentOpen}
              tone={stats.urgentOpen > 0 ? 'bad' : 'good'}
              onClick={
                priorityField
                  ? () =>
                      go('/list', {
                        select: { ...filters.select, [priorityField.name]: ['Urgent'] },
                      })
                  : undefined
              }
            />
            <StatTile
              label="Median time to close"
              value={cycle.sample ? `${cycle.medianDays}d` : '—'}
              sub={
                cycle.sample
                  ? `p90 ${cycle.p90Days}d · ${cycle.sample} closed in ${range.label}`
                  : `nothing closed in ${range.label}`
              }
            />
          </div>

          <ThroughputChart data={weeks} />

          <div className="chart-grid">
            <BarList
              title="Open by status"
              buckets={openByField(items, field(schema, STATUS))}
              useOptionColors
              onPick={bySelect(field(schema, STATUS))}
            />
            {filters.team === null && (
              <BarList
                title="Open by team"
                buckets={openByField(items, field(schema, TEAM))}
                useOptionColors
                onPick={bySelect(field(schema, TEAM))}
              />
            )}
            <BarList
              title="Open by work type"
              buckets={openByField(items, field(schema, WORK_TYPE))}
              useOptionColors
              onPick={bySelect(field(schema, WORK_TYPE))}
            />
            <BarList
              title="Open by module"
              buckets={openByField(items, field(schema, MODULE))}
              useOptionColors
              onPick={bySelect(field(schema, MODULE))}
            />
            <BarList
              title="How long open issues have been open"
              buckets={ages}
              empty="No open issues"
            />
            <CompletedTable rows={completed} />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A saved dashboard. Stat widgets share a row so a set of counters reads as a row of tiles,
 * the way the built-in page does; charts each get their own cell.
 */
function CustomDashboard({
  dashboard,
  items,
  schema,
}: {
  dashboard: Dashboard;
  items: Parameters<typeof widgetData>[1];
  schema: Parameters<typeof widgetData>[2];
}) {
  if (dashboard.widgets.length === 0) {
    return (
      <div className="analytics">
        <div className="dash-empty">
          <h2>“{dashboard.name}” is empty</h2>
          <p>Add a widget — a number, a breakdown by any field, throughput, or ageing.</p>
        </div>
      </div>
    );
  }

  const stats = dashboard.widgets.filter((w) => w.measure === 'stat' || w.measure === 'cycleTime');
  const charts = dashboard.widgets.filter((w) => w.measure !== 'stat' && w.measure !== 'cycleTime');

  return (
    <div className="analytics">
      {stats.length > 0 && (
        <div className="stat-row">
          {stats.map((w) => {
            const data = widgetData(w, items, schema);
            if (data.kind !== 'stat') return null;
            return (
              <div key={w.id} className="widget">
                <RemoveWidget dashboard={dashboard} widgetId={w.id} />
                <StatTile label={data.label} value={data.value} sub={data.sub} tone={data.tone} />
              </div>
            );
          })}
        </div>
      )}
      <div className="chart-grid">
        {charts.map((w) => {
          const data = widgetData(w, items, schema);
          return (
            <div key={w.id} className="widget">
              <RemoveWidget dashboard={dashboard} widgetId={w.id} />
              {data.kind === 'throughput' ? (
                <ThroughputChart data={data.data} />
              ) : data.kind === 'people' ? (
                <CompletedTable rows={data.rows} title={data.title} />
              ) : data.kind === 'bars' ? (
                <BarList
                  title={data.title}
                  buckets={data.buckets}
                  useOptionColors={data.useOptionColors}
                  empty={data.empty}
                />
              ) : (
                <StatTile label={widgetTitle(w)} value={data.value} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
