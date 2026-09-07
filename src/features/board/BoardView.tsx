import { useMemo, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Rows3 } from 'lucide-react';
import type { BoardItem } from '@shared/types';
import { useBoard, useSchema, useSetField } from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { Picker, type PickerItem } from '@/components/ui/Picker';
import { useToast } from '@/components/ui/Toast';
import { ASSIGNEE_GROUP, field, filterItems, groupItems, selectFields, sortItems } from '@/model/board';
import { ViewHeader } from '../shell/ViewHeader';
import { useUi } from '../shell/state';
import { CardBody } from './Card';
import { Column } from './Column';
import './board.css';

export function BoardView() {
  const { data: schema } = useSchema();
  const board = useBoard(Boolean(schema));
  const { filters, groupBy, setGroupBy, openIssue, setNewIssueOpen } = useUi();
  const setField = useSetField();
  const toast = useToast();
  const [active, setActive] = useState<BoardItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const items = useMemo(
    () => (schema && board.data ? sortItems(filterItems(board.data.items, filters), 'updated', 'desc', schema) : []),
    [schema, board.data, filters],
  );
  const groups = useMemo(() => (schema ? groupItems(items, groupBy, schema) : []), [schema, items, groupBy]);
  const groupField = schema ? field(schema, groupBy) : undefined;
  const canDrag = Boolean(groupField?.options);

  const groupOptions: PickerItem[] = schema ? [...selectFields(schema).map((f) => ({ id: f.name, label: f.name })), { id: ASSIGNEE_GROUP, label: 'Assignee' }] : [];

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    if (!over || !groupField) return;
    const group = groups.find((g) => g.key === over.id);
    const item = items.find((i) => i.itemId === a.id);
    if (!group || !item) return;
    const current = item.fields[groupField.name];
    const currentId = current?.kind === 'singleSelect' ? current.optionId : undefined;
    if (currentId === group.optionId) return;
    setField.mutate(
      {
        itemId: item.itemId,
        fieldId: groupField.id,
        fieldName: groupField.name,
        value: group.optionId ? { singleSelectOptionId: group.optionId } : null,
        optimistic: group.optionId ? { kind: 'singleSelect', optionId: group.optionId, name: group.label } : null,
      },
      { onError: (e) => toast.error(`Couldn’t move ${item.key}: ${e.message}`) },
    );
  };

  return (
    <>
      <ViewHeader title="Board" count={board.data ? items.length : undefined}>
        <Picker items={groupOptions} value={groupBy} onSelect={setGroupBy} placeholder="Group by…">
          <Button size="sm" variant="ghost" icon={<Rows3 />}>
            {groupBy}
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
          <span>{board.data.items.length === 0 ? 'No issues on the board yet.' : 'No issues match the current filters.'}</span>
          <Button size="sm" onClick={() => setNewIssueOpen(true)}>
            New issue
          </Button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={(e) => setActive(items.find((i) => i.itemId === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
          <div className="board">
            {groups.map((g) => (
              <Column key={g.key} group={g} schema={schema} showTeam={filters.team === null} canDrag={canDrag} onOpen={openIssue} onNew={() => setNewIssueOpen(true)} />
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
    </>
  );
}
