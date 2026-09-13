import type { ReactNode } from 'react';
import { Menu as MenuIcon, RefreshCw } from 'lucide-react';
import { useBoard } from '@/api/hooks';
import { IconButton, Tooltip } from '@/components/ui/Button';
import { useNow } from '@/components/ui/Time';
import { formatDateTime, timeAgo } from '@/model/time';
import { FilterBar } from '../filters/FilterBar';
import { SearchBox } from '../filters/SearchBox';
import { useUi } from './state';

export function ViewHeader({
  title,
  count,
  children,
  search = true,
}: {
  title: string;
  count?: number;
  children?: ReactNode;
  /** Off for views that don't read filters.query, so the box never sits there inert. */
  search?: boolean;
}) {
  const board = useBoard();
  const { setSidebarOpen } = useUi();
  const now = useNow(30_000);

  const synced = board.data ? `Synced ${formatDateTime(board.data.fetchedAt)}` : 'Not synced yet';

  return (
    <header className="view-header">
      <IconButton
        label="Menu"
        className="nav-toggle"
        size="sm"
        onClick={() => setSidebarOpen(true)}
      >
        <MenuIcon />
      </IconButton>
      <h1>
        {title}
        {count != null && <span className="count">{count}</span>}
      </h1>
      {children}
      <span className="spacer" />
      <FilterBar />
      {search && <SearchBox />}
      <Tooltip label={`${synced} · click to refresh`}>
        <button
          className="sync"
          onClick={() => board.refetch()}
          disabled={board.isFetching}
          aria-label={`${synced}. Refresh.`}
        >
          {board.isFetching ? (
            <span className="spinner" style={{ width: 11, height: 11 }} />
          ) : (
            <RefreshCw size={11} />
          )}
          {board.data && !board.isFetching ? timeAgo(board.data.fetchedAt, now) : ''}
        </button>
      </Tooltip>
    </header>
  );
}
