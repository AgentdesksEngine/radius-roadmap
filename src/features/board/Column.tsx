import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import type { ProjectSchema } from '@shared/types';
import { IconButton } from '@/components/ui/Button';
import { Dot } from '@/components/ui/Tag';
import type { Group } from '@/model/board';
import { Card } from './Card';

interface Props {
  group: Group;
  schema: ProjectSchema;
  showTeam: boolean;
  canDrag: boolean;
  onOpen: (key: string) => void;
  onNew?: () => void;
}

export function Column({ group, schema, showTeam, canDrag, onOpen, onNew }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: group.key, disabled: !canDrag });
  return (
    <section className={`column ${isOver ? 'over' : ''}`} aria-label={group.label}>
      <header className="column-head">
        <Dot color={group.color} />
        <span className="truncate">{group.label}</span>
        <span className="count">{group.items.length}</span>
        {onNew && (
          <IconButton label={`New issue in ${group.label}`} size="sm" onClick={onNew}>
            <Plus />
          </IconButton>
        )}
      </header>
      <div ref={setNodeRef} className="column-body">
        {group.items.map((it) => (
          <Card key={it.itemId} item={it} schema={schema} showTeam={showTeam} canDrag={canDrag} onOpen={onOpen} />
        ))}
        {group.items.length === 0 && <div className="column-empty">{canDrag ? 'Drop issues here' : 'No issues'}</div>}
      </div>
    </section>
  );
}
