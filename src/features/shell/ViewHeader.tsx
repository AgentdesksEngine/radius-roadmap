import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useBoard } from '@/api/hooks';
import { timeAgo } from '@/model/time';
import { FilterBar } from '../filters/FilterBar';
import { SearchBox } from '../filters/SearchBox';

export function ViewHeader({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  const board = useBoard();
  return (
    <header className="view-header">
      <h1>
        {title}
        {count != null && <span className="count">{count}</span>}
      </h1>
      {children}
      <span className="spacer" />
      <FilterBar />
      <SearchBox />
      <span className="sync" title={board.data ? `Synced ${new Date(board.data.fetchedAt).toLocaleTimeString()}` : ''}>
        {board.isFetching ? <span className="spinner" style={{ width: 11, height: 11 }} /> : board.data ? <RefreshCw size={11} /> : null}
        {board.data && !board.isFetching ? timeAgo(board.data.fetchedAt) : ''}
      </span>
    </header>
  );
}
