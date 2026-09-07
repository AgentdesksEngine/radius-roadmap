import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import type { ProjectField, ProjectSchema } from '@shared/types';
import { IconButton } from '@/components/ui/Button';
import { Dot } from '@/components/ui/Tag';
import type { Group } from '@/model/board';
import { Card } from './Card';
import { QuickAdd } from './QuickAdd';

interface Props {
  group: Group;
  schema: ProjectSchema;
  showTeam: boolean;
  canDrag: boolean;
  /** Reordering inside a column only makes sense when the board is in manual order. */
  canSort: boolean;
  groupField: ProjectField | undefined;
  selection: string[];
  onSelect: (itemId: string, additive: boolean) => void;
  onOpen: (key: string) => void;
}

export function Column({
  group,
  schema,
  showTeam,
  canDrag,
  canSort,
  groupField,
  selection,
  onSelect,
  onOpen,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: group.key, disabled: !canDrag });
  const [adding, setAdding] = useState(false);

  return (
    <section className={`column ${isOver ? 'over' : ''}`} aria-label={group.label}>
      <header className="column-head">
        <Dot color={group.color} />
        <span className="truncate">{group.label}</span>
        <span className="count">{group.items.length}</span>
        <IconButton label={`New issue in ${group.label}`} size="sm" onClick={() => setAdding(true)}>
          <Plus />
        </IconButton>
      </header>
      <div ref={setNodeRef} className="column-body">
        <SortableContext
          items={group.items.map((i) => i.itemId)}
          strategy={verticalListSortingStrategy}
          disabled={!canSort}
        >
          {group.items.map((it) => (
            <Card
              key={it.itemId}
              item={it}
              schema={schema}
              showTeam={showTeam}
              canDrag={canDrag}
              selected={selection.includes(it.itemId)}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          ))}
        </SortableContext>
        {adding && (
          <QuickAdd
            groupField={groupField}
            optionId={group.optionId}
            onClose={() => setAdding(false)}
          />
        )}
        {group.items.length === 0 && !adding && (
          <div className="column-empty">{canDrag ? 'Drop issues here' : 'No issues'}</div>
        )}
      </div>
    </section>
  );
}
