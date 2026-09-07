import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Columns3, XCircle } from 'lucide-react';
import type { ProjectField } from '@shared/types';
import { useBoard, useSchema } from '@/api/hooks';
import { AvatarStack } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Picker, type PickerItem } from '@/components/ui/Picker';
import { customFields, filterItems, sortItems } from '@/model/board';
import { usePref } from '@/model/prefs';
import { timeAgo } from '@/model/time';
import { BulkBar } from '../bulk/BulkBar';
import { FieldEditor } from '../issue/FieldEditor';
import { ViewHeader } from '../shell/ViewHeader';
import { useUi } from '../shell/state';
import './sheet.css';

const ROW_H = 32;
const OVERSCAN = 8;

/**
 * Every field of every issue in one editable grid — the layout for bulk data work, where
 * opening a panel per issue is the bottleneck. Rows are windowed so a 1,000-issue board
 * scrolls at full speed.
 */
export function SheetView() {
  const { data: schema } = useSchema();
  const board = useBoard(Boolean(schema));
  const { filters, sort, openIssue, selection, toggleSelected } = useUi();
  const [hidden, setHidden] = usePref<string[]>('sheetHidden', []);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  // The window size depends on the viewport, so it has to follow resizes as well as mounts.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [board.isPending, schema]);

  const items = useMemo(
    () =>
      schema && board.data
        ? sortItems(filterItems(board.data.items, filters), sort.key, sort.dir, schema)
        : [],
    [schema, board.data, filters, sort],
  );

  const allFields = schema ? customFields(schema) : [];
  const fields = allFields.filter((f) => !hidden.includes(f.name));
  const columnItems: PickerItem[] = allFields.map((f) => ({ id: f.name, label: f.name }));

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);
  const visible = items.slice(first, last);

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
          <Button size="sm" variant="ghost" icon={<Columns3 />}>
            {fields.length} columns
          </Button>
        </Picker>
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
      ) : (
        <div
          className="sheet-wrap"
          ref={scroller}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div
            className="sheet"
            style={{
              gridTemplateColumns: `28px 88px minmax(280px, 1.4fr) ${fields.map(() => 'minmax(130px, 1fr)').join(' ')} 92px 78px`,
            }}
          >
            <div className="sheet-head">
              <span />
              <span>ID</span>
              <span>Title</span>
              {fields.map((f) => (
                <span key={f.id}>{f.name}</span>
              ))}
              <span>Assignee</span>
              <span>Updated</span>
            </div>
            <div style={{ height: first * ROW_H, gridColumn: '1 / -1' }} />
            {visible.map((item) => (
              <div
                key={item.itemId}
                className={`sheet-row ${selection.includes(item.itemId) ? 'selected' : ''}`}
                style={{ height: ROW_H }}
              >
                <span className="cell">
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.key}`}
                    checked={selection.includes(item.itemId)}
                    onChange={() => toggleSelected(item.itemId, true)}
                  />
                </span>
                <span className="cell mono muted">{item.key}</span>
                <button
                  className="cell title"
                  onClick={() => openIssue(item.key)}
                  title={item.title}
                >
                  {item.state === 'CLOSED' &&
                    (item.stateReason === 'COMPLETED' ? (
                      <CheckCircle2 size={12} style={{ color: 'var(--c-purple)', flex: 'none' }} />
                    ) : (
                      <XCircle size={12} className="faint" style={{ flex: 'none' }} />
                    ))}
                  <span className="truncate">{item.title}</span>
                </button>
                {fields.map((f: ProjectField) => (
                  <span className="cell" key={f.id}>
                    <FieldEditor item={item} field={f} />
                  </span>
                ))}
                <span className="cell">
                  <AvatarStack people={item.assignees} size={18} />
                </span>
                <span className="cell faint">{timeAgo(item.updatedAt)}</span>
              </div>
            ))}
            <div
              style={{ height: Math.max(0, (items.length - last) * ROW_H), gridColumn: '1 / -1' }}
            />
          </div>
          {items.length === 0 && (
            <div className="empty-view">No issues match the current filters.</div>
          )}
        </div>
      )}
      <BulkBar />
    </>
  );
}
