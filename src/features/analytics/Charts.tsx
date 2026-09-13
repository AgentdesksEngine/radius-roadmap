import { useEffect, useState } from 'react';
import { colorVar } from '@/model/board';
import type { Bucket, WeekPoint } from '@/model/analytics';

/** True while the viewport is narrower than `px`. */
function useNarrow(px = 600): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${px}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [px]);
  return narrow;
}

/** Rounded only at the data end, square on the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h} Z`;
}

const W = 720;
const H = 200;
const PAD = { top: 10, right: 8, bottom: 22, left: 30 };

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

const monthDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Issues opened vs closed, by week. Two series, so it carries a legend as well as the
 * hover read-out — identity is never left to colour alone.
 */
export function ThroughputChart({ data }: { data: WeekPoint[] }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number; w: number } | null>(null);
  const narrow = useNarrow(600);
  const [asTable, setAsTable] = useState(narrow);
  useEffect(() => setAsTable(narrow), [narrow]);

  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.created, d.closed])));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / data.length;
  const barW = Math.max(3, (band - 8) / 2 - 1); // 2px surface gap between the pair
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [...new Set([0, Math.round(max / 2), max])];

  const total = data.reduce(
    (a, d) => ({ created: a.created + d.created, closed: a.closed + d.closed }),
    { created: 0, closed: 0 },
  );

  return (
    <figure className="chart">
      <figcaption>
        <span>Opened vs closed, last {data.length} weeks</span>
        <span className="legend">
          <span>
            <i style={{ background: 'var(--chart-1)' }} /> Opened {total.created}
          </span>
          <span>
            <i style={{ background: 'var(--chart-2)' }} /> Closed {total.closed}
          </span>
          <button className="link" onClick={() => setAsTable((t) => !t)}>
            {asTable ? 'Chart' : 'Table'}
          </button>
        </span>
      </figcaption>

      {asTable ? (
        <div className="chart-table-wrap">
          <table className="chart-table">
            <thead>
              <tr>
                <th>Week of</th>
                <th>Opened</th>
                <th>Closed</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.weekStart}>
                  <td>{monthDay(d.weekStart)}</td>
                  <td>{d.created}</td>
                  <td>{d.closed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-plot" onMouseLeave={() => setHover(null)}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Opened ${total.created} and closed ${total.closed} issues over ${data.length} weeks`}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
                <text x={PAD.left - 6} y={y(t) + 3.5} className="axis" textAnchor="end">
                  {t}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = PAD.left + i * band + 4;
              return (
                <g key={d.weekStart}>
                  <path
                    d={topRounded(x0, y(d.created), barW, plotH - (y(d.created) - PAD.top))}
                    fill="var(--chart-1)"
                  />
                  <path
                    d={topRounded(
                      x0 + barW + 2,
                      y(d.closed),
                      barW,
                      plotH - (y(d.closed) - PAD.top),
                    )}
                    fill="var(--chart-2)"
                  />
                  {(i === 0 || i === data.length - 1 || i % 3 === 0) && (
                    <text x={x0 + barW} y={H - 6} className="axis" textAnchor="middle">
                      {monthDay(d.weekStart)}
                    </text>
                  )}
                  <rect
                    x={PAD.left + i * band}
                    y={PAD.top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`Week of ${monthDay(d.weekStart)}: ${d.created} opened, ${d.closed} closed`}
                    onFocus={(e) => {
                      const box = (
                        e.currentTarget.ownerSVGElement!.parentElement as HTMLElement
                      ).getBoundingClientRect();
                      const x = ((PAD.left + i * band + band / 2) / W) * box.width;
                      setHover({ i, x, y: box.height / 2, w: box.width });
                    }}
                    onBlur={() => setHover(null)}
                    onMouseMove={(e) => {
                      const box = (
                        e.currentTarget.ownerSVGElement!.parentElement as HTMLElement
                      ).getBoundingClientRect();
                      setHover({
                        i,
                        x: e.clientX - box.left,
                        y: e.clientY - box.top,
                        w: box.width,
                      });
                    }}
                  />
                  {hover?.i === i && (
                    <rect
                      x={PAD.left + i * band}
                      y={PAD.top}
                      width={band}
                      height={plotH}
                      className="hover-band"
                    />
                  )}
                </g>
              );
            })}
          </svg>
          {hover && data[hover.i] && (
            <div
              className="chart-tip"
              style={{
                left: hover.x,
                top: hover.y - 8,
                transform: `translate(${hover.x > hover.w / 2 ? 'calc(-100% - 12px)' : '12px'}, -100%)`,
              }}
            >
              <b>Week of {monthDay(data[hover.i]!.weekStart)}</b>
              <span>
                <i style={{ background: 'var(--chart-1)' }} /> {data[hover.i]!.created} opened
              </span>
              <span>
                <i style={{ background: 'var(--chart-2)' }} /> {data[hover.i]!.closed} closed
              </span>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

interface BarListProps {
  title: string;
  buckets: Bucket[];
  /** Use each bucket's own option colour (Status, Team…) rather than one sequential hue. */
  useOptionColors?: boolean;
  empty?: string;
  /** Given a bucket's filter value, opens the issues it counts. */
  onPick?: (value: string) => void;
}

/** Horizontal bars with the value written at the end of every bar — no tooltip needed. */
export function BarList({
  title,
  buckets,
  useOptionColors,
  empty = 'Nothing to show',
  onPick,
}: BarListProps) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((a, b) => a + b.count, 0);
  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <span className="faint">{total}</span>
      </figcaption>
      {buckets.length === 0 ? (
        <p className="faint" style={{ margin: '8px 0 0' }}>
          {empty}
        </p>
      ) : (
        <div className="bar-list">
          {buckets.map((b) => {
            const pick = onPick && b.value ? () => onPick(b.value!) : undefined;
            const Row = pick ? 'button' : 'div';
            return (
              <Row
                key={b.label}
                className={`bar-row ${pick ? 'pickable' : ''}`}
                {...(pick
                  ? { onClick: pick, title: `Show the ${b.count} issues in ${b.label}` }
                  : {})}
              >
                <span className="bar-label truncate" title={b.label}>
                  {b.label}
                </span>
                <span className="bar-track" aria-label={`${b.label}: ${b.count}`} role="img">
                  <span
                    className="bar-fill"
                    style={{
                      width: `${Math.max(2, (b.count / max) * 100)}%`,
                      background: useOptionColors ? colorVar(b.color) : 'var(--chart-seq)',
                    }}
                  />
                </span>
                <span className="bar-value">{b.count}</span>
              </Row>
            );
          })}
        </div>
      )}
    </figure>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'good' | 'bad';
  onClick?: () => void;
}) {
  const Box = onClick ? 'button' : 'div';
  return (
    <Box className={`stat ${onClick ? 'pickable' : ''}`} {...(onClick ? { onClick } : {})}>
      <span className="stat-label">{label}</span>
      <strong className={`stat-value ${tone ?? ''}`}>{value}</strong>
      {sub && <span className="faint">{sub}</span>}
    </Box>
  );
}
