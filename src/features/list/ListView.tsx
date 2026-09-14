import { useEffect, useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { CheckCircle2, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import type { BoardItem } from '@shared/types';
import { useBoard, useSchema } from '@/api/hooks';
import { AvatarStack } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Tag } from '@/components/ui/Tag';
import { TimeAgo } from '@/components/ui/Time';
import {
  PRIORITY,
  STATUS,
  TEAM,
  WORK_TYPE,
  activeFilterCount,
  field,
  filterItems,
  optionRank,
  selectOption,
} from '@/model/board';
import { BulkBar } from '../bulk/BulkBar';
import { SelectCell } from '../issue/SelectCell';
import { ViewHeader } from '../shell/ViewHeader';
import { useUi, useVisibleItems } from '../shell/state';
import './list.css';

export function ListView() {
  const { data: schema } = useSchema();
  const board = useBoard(Boolean(schema));
  const {
    filters,
    setFilters,
    openIssue,
    openKey,
    setNewIssueOpen,
    selection,
    setSelection,
    toggleSelected,
  } = useUi();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'updated', desc: true }]);
  const [cursor, setCursor] = useState(0);
  /** Anchor for shift-click range selection. */
  const [anchor, setAnchor] = useState<number | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  // Read through refs so the column definitions don't rebuild on every selection change.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const toggleRef = useRef(toggleSelected);
  toggleRef.current = toggleSelected;

  const items = useMemo(
    () => (board.data ? filterItems(board.data.items, filters) : []),
    [board.data, filters],
  );

  const columns = useMemo<ColumnDef<BoardItem>[]>(() => {
    if (!schema) return [];
    const statusF = field(schema, STATUS);
    const prioF = field(schema, PRIORITY);
    const teamF = field(schema, TEAM);
    const typeF = field(schema, WORK_TYPE);
    const cols: ColumnDef<BoardItem>[] = [
      {
        id: 'select',
        // LIST-04: a tri-state box for the whole page of rows.
        header: ({ table }) => {
          const rows = table.getRowModel().rows;
          const ids = rows.map((r) => r.original.itemId);
          const picked = ids.filter((id) => selectionRef.current.includes(id)).length;
          const all = picked > 0 && picked === ids.length;
          return (
            <input
              type="checkbox"
              aria-label={all ? 'Clear selection' : 'Select every issue shown'}
              checked={all}
              ref={(el) => {
                if (el) el.indeterminate = picked > 0 && !all;
              }}
              onClick={(e) => e.stopPropagation()}
              onChange={() =>
                setSelection((prev) =>
                  all ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])],
                )
              }
            />
          );
        },
        size: 28,
        enableSorting: false,
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.key}`}
            checked={selectionRef.current.includes(row.original.itemId)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleRef.current(row.original.itemId, true)}
          />
        ),
      },
      {
        id: 'key',
        header: 'ID',
        accessorFn: (i) => i.number,
        size: 84,
        cell: ({ row }) => <span className="mono muted">{row.original.key}</span>,
      },
    ];
    if (prioF) {
      cols.push({
        id: 'priority',
        header: 'P',
        size: 44,
        accessorFn: (i) => optionRank(schema, PRIORITY, i),
        cell: ({ row }) => <SelectCell item={row.original} field={prioF} iconOnly />,
      });
    }
    cols.push({
      id: 'title',
      header: 'Title',
      accessorFn: (i) => i.title,
      cell: ({ row }) => {
        const t = selectOption(row.original, typeF);
        return (
          <span className="title-cell">
            {row.original.state === 'CLOSED' &&
              (row.original.stateReason === 'COMPLETED' ? (
                <CheckCircle2 size={13} style={{ color: 'var(--c-purple)', flex: 'none' }} />
              ) : (
                <XCircle size={13} className="faint" style={{ flex: 'none' }} />
              ))}
            <span className="title">{row.original.title}</span>
            {t && (
              <Tag color={t.color} plain>
                {t.name}
              </Tag>
            )}
          </span>
        );
      },
    });
    if (statusF)
      cols.push({
        id: 'status',
        header: 'Status',
        size: 150,
        accessorFn: (i) => optionRank(schema, STATUS, i),
        cell: ({ row }) => <SelectCell item={row.original} field={statusF} />,
      });
    if (teamF && filters.team === null)
      cols.push({
        id: 'team',
        header: 'Team',
        size: 120,
        accessorFn: (i) => optionRank(schema, TEAM, i),
        cell: ({ row }) => <SelectCell item={row.original} field={teamF} />,
      });
    cols.push({
      id: 'assignees',
      header: 'Assignee',
      size: 90,
      accessorFn: (i) => i.assignees[0]?.name ?? '',
      cell: ({ row }) => <AvatarStack people={row.original.assignees} size={20} />,
    });
    cols.push({
      id: 'updated',
      header: 'Updated',
      size: 80,
      accessorFn: (i) => i.updatedAt,
      // LIST-05: the exact timestamp rides along, as it does in the activity feed.
      cell: ({ row }) => <TimeAgo className="faint" iso={row.original.updatedAt} />,
    });
    return cols;
  }, [schema, filters.team, setSelection]);

  const table = useReactTable({
    data: items,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const rows = table.getRowModel().rows;

  useVisibleItems(rows.map((r) => r.original));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // While the drawer is up it owns j/k, so the hidden cursor doesn't drift behind it.
      if (openKey) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(rows.length - 1, c + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === 'Enter' && rows[cursor]) {
        openIssue(rows[cursor]!.original.key);
      } else if (e.key === 'x' && rows[cursor]) {
        e.preventDefault();
        setAnchor(cursor);
        toggleSelected(rows[cursor]!.original.itemId, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, cursor, openIssue, openKey, toggleSelected]);

  // Keep the cursor in view, and move real focus with it so assistive tech follows along.
  useEffect(() => {
    const el = bodyRef.current?.querySelector<HTMLElement>('tr.cursor');
    el?.scrollIntoView({ block: 'nearest' });
    if (el && !openKey && document.activeElement?.tagName !== 'INPUT')
      el.focus({ preventScroll: true });
  }, [cursor, openKey]);

  const filtered =
    activeFilterCount(filters) > 0 || Boolean(filters.query) || filters.team !== null;

  return (
    <>
      <ViewHeader
        title={filters.archived ? 'Archived' : 'List'}
        count={board.data ? items.length : undefined}
      />
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
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-view">
          <span>
            {board.data?.items.length === 0
              ? 'No issues yet.'
              : 'No issues match the current filters.'}
          </span>
          {filtered ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  select: {},
                  assignees: [],
                  team: null,
                  query: '',
                  state: 'active',
                  archived: false,
                }))
              }
            >
              Clear filters
            </Button>
          ) : (
            <Button size="sm" onClick={() => setNewIssueOpen(true)}>
              New issue
            </Button>
          )}
        </div>
      ) : (
        <div className="list-wrap">
          <table className="list">
            <colgroup>
              {table.getAllLeafColumns().map((c) => (
                <col key={c.id} style={c.id === 'title' ? undefined : { width: c.getSize() }} />
              ))}
            </colgroup>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const dir = h.column.getIsSorted();
                    const content = flexRender(h.column.columnDef.header, h.getContext());
                    return (
                      <th
                        key={h.id}
                        aria-sort={
                          dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'
                        }
                      >
                        {/* LIST-01: sorting lives on a real button, so it is reachable by keyboard. */}
                        {h.column.getCanSort() ? (
                          <button
                            className="th-sort"
                            onClick={h.column.getToggleSortingHandler()}
                            title={`Sort by ${String(h.column.columnDef.header)}`}
                          >
                            {content}
                            {dir === 'asc' ? (
                              <ChevronUp size={11} />
                            ) : dir === 'desc' ? (
                              <ChevronDown size={11} />
                            ) : null}
                          </button>
                        ) : (
                          content
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody ref={bodyRef}>
              {rows.map((row, idx) => {
                const isSelected = selection.includes(row.original.itemId);
                return (
                  <tr
                    key={row.id}
                    tabIndex={-1}
                    aria-selected={isSelected}
                    className={[
                      idx === cursor ? 'cursor' : '',
                      row.original.state === 'CLOSED' ? 'closed' : '',
                      row.original.key === openKey ? 'open' : '',
                      isSelected ? 'selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={(e) => {
                      setCursor(idx);
                      if (e.shiftKey && anchor !== null) {
                        const [from, to] = anchor < idx ? [anchor, idx] : [idx, anchor];
                        const ids = rows.slice(from, to + 1).map((r) => r.original.itemId);
                        setSelection((prev) => [...new Set([...prev, ...ids])]);
                        return;
                      }
                      if (e.metaKey || e.ctrlKey) {
                        setAnchor(idx);
                        toggleSelected(row.original.itemId, true);
                        return;
                      }
                      setAnchor(idx);
                      openIssue(row.original.key);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} data-col={cell.column.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <BulkBar />
    </>
  );
}
