import { useMemo } from 'react';
import { useBoard, useSchema } from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { MODULE, STATUS, TEAM, WORK_TYPE, field, filterItems } from '@/model/board';
import { ageBuckets, cycleTime, openByField, summarize, throughput } from '@/model/analytics';
import { ViewHeader } from '../shell/ViewHeader';
import { useUi } from '../shell/state';
import { BarList, StatTile, ThroughputChart } from './Charts';
import './analytics.css';

/**
 * Everything here is computed in the browser from the board the app already has, so the
 * numbers always match what the other views are showing — no second source of truth.
 */
export function AnalyticsView() {
  const { data: schema } = useSchema();
  const board = useBoard(Boolean(schema));
  const { filters } = useUi();

  // Analytics needs the full history, so the state filter is dropped; team and the rest hold.
  const items = useMemo(
    () =>
      board.data ? filterItems(board.data.items, { ...filters, state: 'all', query: '' }) : [],
    [board.data, filters],
  );

  const stats = useMemo(() => summarize(items), [items]);
  const weeks = useMemo(() => throughput(items), [items]);
  const cycle = useMemo(() => cycleTime(items), [items]);
  const ages = useMemo(() => ageBuckets(items), [items]);

  const scope = filters.team ? `${filters.team} · ` : '';

  return (
    <>
      <ViewHeader title="Analytics" count={board.data ? items.length : undefined} />

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
      ) : (
        <div className="analytics">
          <div className="stat-row">
            <StatTile label={`${scope}Open issues`} value={stats.open} />
            <StatTile label="Opened, last 30 days" value={stats.createdRecently} />
            <StatTile label="Closed, last 30 days" value={stats.closedRecently} />
            <StatTile
              label="Net change, 30 days"
              value={stats.net > 0 ? `+${stats.net}` : stats.net}
              sub={stats.net > 0 ? 'backlog grew' : stats.net < 0 ? 'backlog shrank' : 'flat'}
              tone={stats.net > 0 ? 'bad' : stats.net < 0 ? 'good' : undefined}
            />
            <StatTile
              label="Waiting on triage"
              value={stats.needsTriage}
              tone={stats.needsTriage > 0 ? 'bad' : 'good'}
            />
            <StatTile
              label="Urgent and open"
              value={stats.urgentOpen}
              tone={stats.urgentOpen > 0 ? 'bad' : 'good'}
            />
            <StatTile
              label="Median time to close"
              value={cycle.sample ? `${cycle.medianDays}d` : '—'}
              sub={
                cycle.sample
                  ? `p90 ${cycle.p90Days}d · ${cycle.sample} closed in 90 days`
                  : 'nothing closed in 90 days'
              }
            />
          </div>

          <ThroughputChart data={weeks} />

          <div className="chart-grid">
            <BarList
              title="Open by status"
              buckets={openByField(items, field(schema, STATUS))}
              useOptionColors
            />
            {filters.team === null && (
              <BarList
                title="Open by team"
                buckets={openByField(items, field(schema, TEAM))}
                useOptionColors
              />
            )}
            <BarList
              title="Open by work type"
              buckets={openByField(items, field(schema, WORK_TYPE))}
              useOptionColors
            />
            <BarList
              title="Open by module"
              buckets={openByField(items, field(schema, MODULE))}
              useOptionColors
            />
            <BarList
              title="How long open issues have been open"
              buckets={ages}
              empty="No open issues"
            />
          </div>
        </div>
      )}
    </>
  );
}
