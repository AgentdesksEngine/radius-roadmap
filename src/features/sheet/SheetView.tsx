import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Columns3, RotateCcw, XCircle } from 'lucide-react';
import type { BoardItem, ProjectField } from '@shared/types';
import { useBoard, useSchema } from '@/api/hooks';
import { AvatarStack } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Picker, type PickerItem } from '@/components/ui/Picker';
import { TimeAgo } from '@/components/ui/Time';
import { compareValues, customFields, fieldSortValue, filterItems } from '@/model/board';
import { usePref } from '@/model/prefs';
import { BulkBar } from '../bulk/BulkBar';
import { FieldEditor } from '../issue/FieldEditor';
import { ViewHeader } from '../shell/ViewHeader';
import { useUi, useVisibleItems } from '../shell/state';
import './sheet.css';

const ROW_H = 32;
const OVERSCAN = 8;
/** Columns the grid always carries, either side of the field columns. */
const FIXED_LEFT = ['select', 'key', 'title'] as const;

interface SheetSort {
  col: string;
  dir: 'asc' | 'desc';
}

/**
 * Every field of every issue in one editable grid — the layout for bulk data work, where
 * opening a panel per issue is the bottleneck. Rows are windowed so a 1,000-issue board
 * scrolls at full speed.
 */
export function SheetView() {
  const { data: schema } = useSchema();
  const board = useBoard(Boolean(schema));
  const { filters, openIssue, selection, toggleSelected } = useUi();
  const [hidden, setHidden] = usePref<string[]>('sheetHidden', []);
  // The grid orders itself. It used to read the board's sort, which meant the order came
  // from a control on another screen with nothing here to say so.
  const [sort, setSort] = usePref<SheetSort>('sheetSort', { col: 'updated', dir: 'desc' });
  const scroller = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  /** Roving focus: which cell the keyboard is on, as [row, column]. */
  const [cell, setCell] = useState<[number, number]>([0, 0]);

  // The window size depends on the viewport, so it has to follow resizes as well as mounts.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [board.isPending, schema]);

  const allFields = useMemo(() => (schema ? customFields(schema) : []), [schema]);
  const fields = useMemo(
    () => allFields.filter((f) => !hidden.includes(f.name)),
    [allFields, hidden],
  );

  const items = useMemo(() => {
    if (!schema || !board.data) return [];
    const rows = filterItems(board.data.items, filters);
    const m = sort.dir === 'asc' ? 1 : -1;
    const value = (i: BoardItem): string | number => {
      switch (sort.col) {
        case 'key':
          return i.number;
        case 'title':
          return i.title.toLowerCase();
        case 'assignee':
          return i.assignees[0]?.name?.toLowerCase() ?? '￿';
        case 'updated':
          return i.updatedAt;
        default:
          return fieldSortValue(schema, i, sort.col);
      }
    };
    return [...rows].sort((a, b) => compareValues(value(a), value(b)) * m);
  }, [schema, board.data, filters, sort]);

  useVisibleItems(items);

  const columnItems: PickerItem[] = allFields.map((f) => ({ id: f.name, label: f.name }));

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);
  const visible = items.slice(first, last);

  const toggleSort = (col: string) =>
    setSort((s) => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }));

  // Column ids in render order, for arrow-key movement.
  const colIds = useMemo(
    () => [...FIXED_LEFT, ...fields.map((f) => f.name), 'assignee', 'updated'],
    [fields],
  );

  const focusCell = useCallback((row: number, col: number) => {
    const el = gridRef.current?.querySelector<HTMLElement>(
      `[data-row="${row}"][data-col="${col}"]`,
    );
    const target = el?.matches('button, input, a')
      ? el
      : el?.querySelector<HTMLElement>('button, input, a');
    (target ?? el)?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);

  // SHEET-03: arrow keys walk the grid, Enter opens the editor under the cursor.
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const [r, c] = cell;
    let next: [number, number] | null = null;
    if (e.key === 'ArrowDown' || e.key === 'j') next = [Math.min(items.length - 1, r + 1), c];
    else if (e.key === 'ArrowUp' || e.key === 'k') next = [Math.max(0, r - 1), c];
    else if (e.key === 'ArrowRight') next = [r, Math.min(colIds.length - 1, c + 1)];
    else if (e.key === 'ArrowLeft') next = [r, Math.max(0, c - 1)];
    else if (e.key === 'Home') next = [r, 0];
    else if (e.key === 'End') next = [r, colIds.length - 1];
    else if (e.key === 'x' && items[r]) {
      e.preventDefault();
      toggleSelected(items[r]!.itemId, true);
      return;
    } else if (e.key === 'Enter' && items[r]) {
      e.preventDefault();
      if (colIds[c] === 'title') openIssue(items[r]!.key);
      else focusCell(r, c);
      return;
    }
    if (!next) return;
    e.preventDefault();
    setCell(next);
    // The row may be outside the window; let it render before reaching for it.
    requestAnimationFrame(() => focusCell(next[0], next[1]));
  };

  return (
    <>
      <ViewHeader
        title={filters.archived ? 'Archived' : 'Spreadsheet'}
        count={board.data ? items.length : undefined}
      >
        <Picker
          items={columnItems}
          value={fields.map((f) => f.name)}
          multiple
          onSelect={(name) =>
            setHidden((h) => (h.includes(name) ? h.filter((x) => x !== name) : [...h, name]))
          }
          placeholder="Show columns…"
        >
          <Button size="sm" variant={hidden.length ? 'default' : 'ghost'} icon={<Columns3 />}>
            {/* SHEET-04: hidden columns are state worth seeing. */}
            {hidden.length
              ? `${fields.length} of ${allFields.length} columns`
              : `${fields.length} columns`}
          </Button>
        </Picker>
        {hidden.length > 0 && (
          <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setHidden([])}>
            Show all
          </Button>
        )}
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
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty-view">
          <span>No issues match the current filters.</span>
        </div>
      ) : (
        <div
          className="sheet-wrap"
          ref={scroller}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div
            className="sheet"
            ref={gridRef}
            role="grid"
            aria-rowcount={items.length}
            onKeyDown={onGridKeyDown}
            style={{
              gridTemplateColumns: `28px 88px minmax(280px, 1.4fr) ${fields.map(() => 'minmax(130px, 1fr)').join(' ')} 92px 78px`,
            }}
          >
            <div className="sheet-head" role="row">
              <span />
              <SortHeader id="key" label="ID" sort={sort} onSort={toggleSort} />
              <SortHeader id="title" label="Title" sort={sort} onSort={toggleSort} />
              {fields.map((f) => (
                <SortHeader key={f.id} id={f.name} label={f.name} sort={sort} onSort={toggleSort} />
              ))}
              <SortHeader id="assignee" label="Assignee" sort={sort} onSort={toggleSort} />
              <SortHeader id="updated" label="Updated" sort={sort} onSort={toggleSort} />
            </div>
            <div style={{ height: first * ROW_H, gridColumn: '1 / -1' }} />
            {visible.map((item, vi) => {
              const r = first + vi;
              return (
                <div
                  key={item.itemId}
                  role="row"
                  className={`sheet-row ${selection.includes(item.itemId) ? 'selected' : ''} ${r === cell[0] ? 'cursor' : ''}`}
                  style={{ height: ROW_H }}
                >
                  <span className="cell sticky-col col-select" data-row={r} data-col={0}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.key}`}
                      checked={selection.includes(item.itemId)}
                      onFocus={() => setCell([r, 0])}
                      onChange={() => toggleSelected(item.itemId, true)}
                    />
                  </span>
                  <span
                    className="cell sticky-col col-key mono muted"
                    data-row={r}
                    data-col={1}
                    tabIndex={-1}
                    onFocus={() => setCell([r, 1])}
                  >
                    {item.key}
                  </span>
                  <button
                    className="cell sticky-col col-title title"
                    data-row={r}
                    data-col={2}
                    onFocus={() => setCell([r, 2])}
                    onClick={() => openIssue(item.key)}
                    title={item.title}
                  >
                    {item.state === 'CLOSED' &&
                      (item.stateReason === 'COMPLETED' ? (
                        <CheckCircle2
                          size={12}
                          style={{ color: 'var(--c-purple)', flex: 'none' }}
                        />
                      ) : (
                        <XCircle size={12} className="faint" style={{ flex: 'none' }} />
                      ))}
                    <span className="truncate">{item.title}</span>
                  </button>
                  {fields.map((f: ProjectField, fi) => (
                    <span
                      className="cell"
                      key={f.id}
                      data-row={r}
                      data-col={3 + fi}
                      onFocus={() => setCell([r, 3 + fi])}
                    >
                      <FieldEditor item={item} field={f} />
                    </span>
                  ))}
                  <span
                    className="cell"
                    data-row={r}
                    data-col={3 + fields.length}
                    tabIndex={-1}
                    onFocus={() => setCell([r, 3 + fields.length])}
                  >
                    <AvatarStack people={item.assignees} size={18} />
                  </span>
                  <span
                    className="cell faint"
                    data-row={r}
                    data-col={4 + fields.length}
                    tabIndex={-1}
                    onFocus={() => setCell([r, 4 + fields.length])}
                  >
                    <TimeAgo iso={item.updatedAt} />
                  </span>
                </div>
              );
            })}
            <div
              style={{ height: Math.max(0, (items.length - last) * ROW_H), gridColumn: '1 / -1' }}
            />
          </div>
        </div>
      )}
      <BulkBar />
    </>
  );
}

function SortHeader({
  id,
  label,
  sort,
  onSort,
}: {
  id: string;
  label: string;
  sort: SheetSort;
  onSort: (col: string) => void;
}) {
  const active = sort.col === id;
  return (
    <span
      role="columnheader"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button className="sheet-sort" onClick={() => onSort(id)} title={`Sort by ${label}`}>
        <span className="truncate">{label}</span>
        {active && (sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
      </button>
    </span>
  );
}
