/**
 * One shared, self-refreshing copy of the board.
 *
 * Before this, every client polled `/api/project/items` every 60 seconds and every poll
 * re-read all ten pages of the project — about 40 rate-limit points per tab per minute
 * against a 5,000/hour budget. Now a request is answered from memory, and the upstream
 * read happens at most once per freshness window no matter how many people are looking.
 *
 * Refresh has three modes, cheapest first:
 *   - cache hit      nothing goes upstream
 *   - delta          one small page of issues touched since the last sync
 *   - full           all pages, on first use, every FULL_MS, and on demand
 * A delta cannot see an item removed from the project, which is what the periodic full
 * refresh is for.
 *
 * Scope: this lives in the lambda instance's memory, so it is per-instance rather than
 * global. That is enough — a warm instance serves many clients, and the numbers above are
 * per-instance too — but it is why the webhook marks the cache stale instead of trying to
 * push the new value into it.
 */
import type { BoardData, BoardItem } from '../../shared/types.js';
import { env } from './env.js';
import { getBoard, getBoardSince } from './github/board.js';
import type { GitHubClient } from './github/gql.js';

/**
 * How long a copy is served without checking upstream. Polling is only a fallback for
 * not being told: with the webhook wired up, changes arrive as invalidations, so the
 * timer can be long. Without it, the timer is the only way anything ever refreshes.
 */
const FRESH_WITH_WEBHOOK_MS = 5 * 60_000;
const FRESH_POLLING_MS = 30_000;

function freshMs(): number {
  return env().GITHUB_WEBHOOK_SECRET ? FRESH_WITH_WEBHOOK_MS : FRESH_POLLING_MS;
}

/** Beyond this, re-read every page rather than delta, so deletions cannot linger. */
const FULL_MS = 10 * 60_000;
/** Overlap the delta window so an item updated during a sync is never missed. */
const DELTA_OVERLAP_MS = 60_000;

export type BoardSource = 'cache' | 'delta' | 'full';

interface Entry {
  items: Map<string, BoardItem>;
  /** When the contents were last known-good. */
  syncedAt: number;
  /** When we last read every page, as opposed to a delta. */
  fullSyncAt: number;
  stale: boolean;
}

let entry: Entry | undefined;
let inFlight: Promise<void> | undefined;

function snapshot(source: BoardSource): BoardData & { source: BoardSource } {
  return {
    items: [...entry!.items.values()],
    fetchedAt: new Date(entry!.syncedAt).toISOString(),
    source,
  };
}

async function fullSync(gh: GitHubClient): Promise<void> {
  const board = await getBoard(gh);
  const at = Date.parse(board.fetchedAt);
  entry = {
    items: new Map(board.items.map((i) => [i.itemId, i])),
    syncedAt: at,
    fullSyncAt: at,
    stale: false,
  };
}

/** Returns false when too much had changed to be worth paging; the caller then goes full. */
async function deltaSync(gh: GitHubClient, current: Entry): Promise<boolean> {
  const since = new Date(current.syncedAt - DELTA_OVERLAP_MS).toISOString();
  const startedAt = Date.now();
  const delta = await getBoardSince(gh, since);
  if (!delta.complete) return false;
  for (const item of delta.items) current.items.set(item.itemId, item);
  current.syncedAt = startedAt;
  current.stale = false;
  return true;
}

/**
 * The board, refreshed only as much as it needs to be. Concurrent callers share one
 * upstream read; if that read fails while we hold data, the stale copy is served rather
 * than failing the request — a board a minute old beats an error banner.
 */
export async function readBoard(
  gh: GitHubClient,
  opts: { force?: boolean } = {},
): Promise<BoardData & { source: BoardSource }> {
  const now = Date.now();
  const current = entry;

  if (!opts.force && current && !current.stale && now - current.syncedAt < freshMs()) {
    return snapshot('cache');
  }

  const needsFull = opts.force || !current || now - current.fullSyncAt > FULL_MS;
  let source: BoardSource = needsFull ? 'full' : 'delta';

  const refresh = async () => {
    if (needsFull || !(await deltaSync(gh, current!))) {
      source = 'full';
      await fullSync(gh);
    }
  };

  inFlight ??= refresh().finally(() => {
    inFlight = undefined;
  });

  try {
    await inFlight;
  } catch (err) {
    if (!entry) throw err;
    entry.stale = true;
    console.error('[board-cache] refresh failed, serving the previous copy:', err);
    return snapshot('cache');
  }
  return snapshot(source);
}

/**
 * Fold a freshly written item back in, so the writer's own next poll cannot show them the
 * value they just replaced.
 */
export function cacheItems(items: BoardItem[]): void {
  if (!entry) return;
  for (const item of items) entry.items.set(item.itemId, item);
}

/** Something changed out of band (a webhook, or a write we cannot fold in): delta next read. */
export function invalidateBoard(): void {
  if (entry) entry.stale = true;
}

/** Test seam. */
export function resetBoardCache(): void {
  entry = undefined;
  inFlight = undefined;
}
