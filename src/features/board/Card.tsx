import { useDraggable } from '@dnd-kit/core';
import { CheckCircle2, MessageSquare, XCircle } from 'lucide-react';
import type { BoardItem, ProjectSchema } from '@shared/types';
import { AvatarStack } from '@/components/ui/Avatar';
import { Tag } from '@/components/ui/Tag';
import { PRIORITY, TEAM, WORK_TYPE, field, selectName, selectOption } from '@/model/board';
import { PriorityIcon } from './PriorityIcon';

interface Props {
  item: BoardItem;
  schema: ProjectSchema;
  showTeam: boolean;
  canDrag: boolean;
  onOpen: (key: string) => void;
  overlay?: boolean;
}

export function CardBody({ item, schema, showTeam }: Pick<Props, 'item' | 'schema' | 'showTeam'>) {
  const team = selectOption(item, field(schema, TEAM));
  const workType = selectOption(item, field(schema, WORK_TYPE));
  return (
    <>
      <div className="card-top">
        <span className="mono">{item.key}</span>
        <AvatarStack people={item.assignees} size={18} />
      </div>
      <div className="card-title">{item.title}</div>
      <div className="card-meta">
        <PriorityIcon name={selectName(item, PRIORITY)} />
        {workType && (
          <Tag color={workType.color} plain>
            {workType.name}
          </Tag>
        )}
        {showTeam && team && <Tag color={team.color}>{team.name}</Tag>}
        <span className="right">
          {item.state === 'CLOSED' && (item.stateReason === 'COMPLETED' ? <CheckCircle2 size={12} style={{ color: 'var(--c-purple)' }} /> : <XCircle size={12} />)}
          {item.commentCount > 0 && (
            <>
              <MessageSquare size={11} />
              {item.commentCount}
            </>
          )}
        </span>
      </div>
    </>
  );
}

export function Card({ item, schema, showTeam, canDrag, onOpen }: Props) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: item.itemId, disabled: !canDrag, data: { item } });
  return (
    <div
      ref={setNodeRef}
      className={`card ${isDragging ? 'dragging' : ''} ${item.state === 'CLOSED' ? 'closed' : ''}`}
      role="button"
      tabIndex={0}
      {...listeners}
      onClick={() => onOpen(item.key)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(item.key);
      }}
    >
      <CardBody item={item} schema={schema} showTeam={showTeam} />
    </div>
  );
}
