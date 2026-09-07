import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardItem } from '../../shared/types';

// The cache reads config through env(), which insists on a session secret.
process.env.SESSION_SECRET ??= 'test-session-secret-that-is-long-enough-to-pass';

const getBoard = vi.fn();
const getBoardSince = vi.fn();
vi.mock('./github/board', () => ({
  getBoard: (...args: unknown[]) => getBoard(...args),
  getBoardSince: (...args: unknown[]) => getBoardSince(...args),
}));

const { cacheItems, invalidateBoard, readBoard, resetBoardCache } = await import('./board-cache');

/** The cache only ever looks at itemId, so the rest can stay minimal. */
function item(id: string, title = id): BoardItem {
  return { itemId: id, title } as unknown as BoardItem;
}

const gh = {} as never;
const board = (items: BoardItem[], fetchedAt = new Date().toISOString()) => ({ items, fetchedAt });
const delta = (items: BoardItem[], complete = true) => ({ items, complete });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));
  resetBoardCache();
  getBoard.mockReset();
  getBoardSince.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('readBoard', () => {
  it('reads every page on first use, then serves memory', async () => {
    getBoard.mockResolvedValue(board([item('a'), item('b')]));

    expect((await readBoard(gh)).source).toBe('full');
    expect((await readBoard(gh)).source).toBe('cache');
    expect((await readBoard(gh)).items).toHaveLength(2);
    expect(getBoard).toHaveBeenCalledTimes(1);
  });

  it('delta-syncs once the copy goes stale rather than re-reading everything', async () => {
    getBoard.mockResolvedValue(board([item('a', 'old')]));
    await readBoard(gh);

    getBoardSince.mockResolvedValue(delta([item('a', 'new'), item('c')]));
    vi.advanceTimersByTime(45_000);

    const second = await readBoard(gh);
    expect(second.source).toBe('delta');
    expect(getBoard).toHaveBeenCalledTimes(1);
    expect(second.items.map((i) => i.title).sort()).toEqual(['c', 'new']);
  });

  it('asks for a window that overlaps the last sync so nothing slips through the gap', async () => {
    getBoard.mockResolvedValue(board([item('a')]));
    await readBoard(gh);
    getBoardSince.mockResolvedValue(delta([]));
    vi.advanceTimersByTime(45_000);
    await readBoard(gh);

    const since = Date.parse(getBoardSince.mock.calls[0]![1] as string);
    expect(since).toBeLessThan(Date.parse('2026-09-07T12:00:00Z'));
  });

  it('re-reads every page again after the full-refresh interval, to catch deletions', async () => {
    getBoard.mockResolvedValue(board([item('a')]));
    await readBoard(gh);
    getBoardSince.mockResolvedValue(delta([]));

    vi.advanceTimersByTime(11 * 60_000);
    expect((await readBoard(gh)).source).toBe('full');
    expect(getBoard).toHaveBeenCalledTimes(2);
  });

  it('forces a full read on demand', async () => {
    getBoard.mockResolvedValue(board([item('a')]));
    await readBoard(gh);
    expect((await readBoard(gh, { force: true })).source).toBe('full');
    expect(getBoard).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent callers into one upstream read', async () => {
    let release!: (v: unknown) => void;
    getBoard.mockReturnValue(new Promise((r) => (release = r)));

    const both = Promise.all([readBoard(gh), readBoard(gh)]);
    release(board([item('a')]));
    await both;

    expect(getBoard).toHaveBeenCalledTimes(1);
  });

  it('serves the previous copy when a refresh fails, instead of failing the request', async () => {
    getBoard.mockResolvedValue(board([item('a')]));
    await readBoard(gh);

    getBoardSince.mockRejectedValue(new Error('GitHub rate limit reached'));
    vi.advanceTimersByTime(45_000);

    const result = await readBoard(gh);
    expect(result.source).toBe('cache');
    expect(result.items).toHaveLength(1);
  });

  it('propagates the failure when there is nothing cached to fall back to', async () => {
    getBoard.mockRejectedValue(new Error('GitHub rate limit reached'));
    await expect(readBoard(gh)).rejects.toThrow('rate limit');
  });

  it('falls back to a full read when more changed than the delta budget covers', async () => {
    getBoard.mockResolvedValue(board([item('a')]));
    await readBoard(gh);

    getBoardSince.mockResolvedValue(delta([item('b')], false));
    getBoard.mockResolvedValue(board([item('a'), item('b'), item('c')]));
    vi.advanceTimersByTime(45_000);

    const result = await readBoard(gh);
    expect(result.source).toBe('full');
    expect(result.items).toHaveLength(3);
  });
});

describe('keeping the cache honest after a write', () => {
  it('folds a written item in, so the writer does not poll back their old value', async () => {
    getBoard.mockResolvedValue(board([item('a', 'before')]));
    await readBoard(gh);

    cacheItems([item('a', 'after')]);

    const result = await readBoard(gh);
    expect(result.source).toBe('cache');
    expect(result.items[0]!.title).toBe('after');
  });

  it('invalidating forces the next read to sync even inside the freshness window', async () => {
    getBoard.mockResolvedValue(board([item('a')]));
    await readBoard(gh);
    getBoardSince.mockResolvedValue(delta([item('b')]));

    invalidateBoard();

    expect((await readBoard(gh)).source).toBe('delta');
  });
});
