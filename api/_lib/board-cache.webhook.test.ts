import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardItem } from '../../shared/types';

// With a webhook secret configured, changes arrive as invalidations, so the poll timer is
// only a safety net and the freshness window widens. Separate file because env() caches.
process.env.SESSION_SECRET ??= 'test-session-secret-that-is-long-enough-to-pass';
process.env.GITHUB_WEBHOOK_SECRET = 'configured';

const getBoard = vi.fn();
const getBoardSince = vi.fn();
vi.mock('./github/board', () => ({
  getBoard: (...a: unknown[]) => getBoard(...a),
  getBoardSince: (...a: unknown[]) => getBoardSince(...a),
}));

const { invalidateBoard, readBoard, resetBoardCache } = await import('./board-cache');
const gh = {} as never;
const item = (id: string) => ({ itemId: id }) as unknown as BoardItem;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));
  resetBoardCache();
  getBoard
    .mockReset()
    .mockResolvedValue({ items: [item('a')], fetchedAt: new Date().toISOString() });
  getBoardSince.mockReset().mockResolvedValue({ items: [], complete: true });
});
afterEach(() => vi.useRealTimers());

describe('freshness window when webhooks are configured', () => {
  it('stops polling upstream every 30 seconds', async () => {
    await readBoard(gh);
    vi.advanceTimersByTime(45_000);

    expect((await readBoard(gh)).source).toBe('cache');
    expect(getBoardSince).not.toHaveBeenCalled();
  });

  it('still refreshes once the wider window lapses', async () => {
    await readBoard(gh);
    vi.advanceTimersByTime(6 * 60_000);
    expect((await readBoard(gh)).source).toBe('delta');
  });

  it('refreshes immediately when a webhook says something changed', async () => {
    await readBoard(gh);
    invalidateBoard();
    expect((await readBoard(gh)).source).toBe('delta');
  });
});
