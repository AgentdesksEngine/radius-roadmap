import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { ArrowUpDown, Rows3 } from 'lucide-react';
import type { BoardItem } from '@shared/types';
import { useBoard, useMoveItem, useSchema, useSetField } from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { Picker, type PickerItem } from '@/components/ui/Picker';
import { useToast } from '@/components/ui/Toast';
import {
  ASSIGNEE_GROUP,
  field,
  filterItems,
  groupItems,
  selectFields,
  sortItems,
  type SortKey,
} from '@/model/board';
import { BulkBar } from '../bulk/BulkBar';
import { ViewHeader } from '../shell/ViewHeader';
import { useUi } from '../shell/state';
import { CardBody } from './Card';
import { Column } from './Column';
import './board.css';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'manual', label: 'Manual' },
  { id: 'priority', label: 'Priority' },
  { id: 'updated', label: 'Last updated' },
  { id: 'created', label: 'Newest' },
  { id: 'title', label: 'Title' },
];

/** Cards are smaller targets than the column behind them, so let them win a tie. */
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args).length ? pointerWithin(args) : rectIntersection(args);
  return [...hits].sort(
    (a, b) => Number(String(b.id).startsWith('PVTI_')) - Number(String(a.id).startsWith('PVTI_')),
  );
};

export function BoardView() {
  const { data: schema } = useSchema();
  const board = useBoard(Boolean(schema));
  const {
    filters,
    groupBy,
    setGroupBy,
    sort,
    setSort,
    openIssue,
    setNewIssueOpen,
    selection,
    toggleSelected,
  } = useUi();
  const setField = useSetField();
  const move = useMoveItem();
  const toast = useToast();
  const [active, setActive] = useState<BoardItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const items = useMemo(
    () =>
      schema && board.data
        ? sortItems(filterItems(board.data.items, filters), sort.key, sort.dir, schema)
        : [],
    [schema, board.data, filters, sort],
  );
  const groups = useMemo(
    () => (schema ? groupItems(items, groupBy, schema) : []),
    [schema, items, groupBy],
  );
  const groupField = schema ? field(schema, groupBy) : undefined;
  const canDrag = Boolean(groupField?.options);
  const canSort = sort.key === 'manual';

  const groupOptions: PickerItem[] = schema
    ? [
        ...selectFields(schema).map((f) => ({ id: f.name, label: f.name })),
        { id: ASSIGNEE_GROUP, label: 'Assignee' },
      ]
    : [];

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    const item = items.find((i) => i.itemId === a.id);
    if (!item || !over) return;

    const overItem = items.find((i) => i.itemId === over.id);
    const dest =
      groups.find((g) => g.key === over.id) ??
      groups.find((g) => g.items.some((i) => i.itemId === over.id));
    if (!dest) return;

    // 1. Moving between columns is a field write.
    if (groupField) {
      const current = item.fields[groupField.name];
      const currentId = current?.kind === 'singleSelect' ? current.optionId : undefined;
      if (currentId !== dest.optionId) {
        setField.mutate(
          {
            itemId: item.itemId,
            fieldId: groupField.id,
            fieldName: groupField.name,
            value: dest.optionId ? { singleSelectOptionId: dest.optionId } : null,
            optimistic: dest.optionId
              ? { kind: 'singleSelect', optionId: dest.optionId, name: dest.label }
              : null,
          },
          { onError: (e) => toast.error(`Couldn’t move ${item.key}: ${e.message}`) },
        );
      }
    }

    // 2. Position inside the column is the project's own manual order.
    if (!canSort) return;
    const rest = dest.items.filter((i) => i.itemId !== item.itemId);
    const overIndex = overItem ? rest.findIndex((i) => i.itemId === overItem.itemId) : -1;
    const insertAt = overIndex === -1 ? rest.length : overIndex;
    const afterId = insertAt === 0 ? null : rest[insertAt - 1]!.itemId;

    const wasIndex = dest.items.findIndex((i) => i.itemId === item.itemId);
    const currentAfterId = wasIndex <= 0 ? null : dest.items[wasIndex - 1]!.itemId;
    if (wasIndex !== -1 && afterId === currentAfterId) return;

    move.mutate(
      { itemId: item.itemId, afterId },
      { onError: (e) => toast.error(`Couldn’t reorder ${item.key}: ${e.message}`) },
    );
  };

  return (
    <>
      <ViewHeader
        title={filters.archived ? 'Archived' : 'Board'}
        count={board.data ? items.length : undefined}
      >
        <Picker items={groupOptions} value={groupBy} onSelect={setGroupBy} placeholder="Group by…">
          <Button size="sm" variant="ghost" icon={<Rows3 />}>
            {groupBy}
          </Button>
        </Picker>
        <Picker
          items={SORTS}
          value={sort.key}
          onSelect={(id) => setSort({ key: id as SortKey, dir: id === 'manual' ? 'asc' : 'desc' })}
          placeholder="Order by…"
        >
          <Button size="sm" variant="ghost" icon={<ArrowUpDown />}>
            {SORTS.find((s) => s.id === sort.key)?.label ?? 'Order'}
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

      {!schema || (board.isPending && !board.isError) ? (
        <div className="board-skeleton" aria-busy>
          {[4, 2, 3, 1].map((n, c) => (
            <div key={c} className="col">
              <div className="skeleton h" />
              {Array.from({ length: n }).map((_, i) => (
                <div key={i} className="skeleton" />
              ))}
            </div>
          ))}
        </div>
      ) : items.length === 0 && board.data ? (
        <div className="empty-view">
          <span>
            {filters.archived
              ? 'Nothing archived.'
              : board.data.items.length === 0
                ? 'No issues on the board yet.'
                : 'No issues match the current filters.'}
          </span>
          <Button size="sm" onClick={() => setNewIssueOpen(true)}>
            New issue
          </Button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={(e) => setActive(items.find((i) => i.itemId === e.active.id) ?? null)}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActive(null)}
        >
          <div className="board">
            {groups.map((g) => (
              <Column
                key={g.key}
                group={g}
                schema={schema}
                showTeam={filters.team === null}
                canDrag={canDrag}
                canSort={canSort}
                groupField={groupField}
                selection={selection}
                onSelect={toggleSelected}
                onOpen={openIssue}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {active && (
              <div className="card overlay" style={{ width: 288 }}>
                <CardBody item={active} schema={schema} showTeam={filters.team === null} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
      <BulkBar />
    </>
  );
}
