import { useEffect, useState } from 'react';
import { formatDateTime, timeAgo } from '@/model/time';

/**
 * Re-renders on an interval so relative timestamps stay honest. A "2m" stamp that never
 * moves quietly promises the data is fresh when it is an hour old.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** A relative timestamp that carries the exact one for hover and assistive tech. */
export function TimeAgo({
  iso,
  suffix = '',
  className,
  live = true,
}: {
  iso: string;
  /** e.g. " ago", " old" — kept out of timeAgo() so the bare value stays reusable. */
  suffix?: string;
  className?: string;
  live?: boolean;
}) {
  const now = useNow(live ? 30_000 : 3_600_000);
  return (
    <time className={className} dateTime={iso} title={formatDateTime(iso)}>
      {timeAgo(iso, now)}
      {suffix}
    </time>
  );
}
