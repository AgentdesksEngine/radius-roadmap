import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle2, CornerDownRight, ListTree, MessageSquare, XCircle } from 'lucide-react';
import type { BoardItem, ProjectSchema } from '@shared/types';
import { AvatarStack } from '@/components/ui/Avatar';
import { Tag } from '@/components/ui/Tag';
import { PRIORITY, TEAM, WORK_TYPE, field, selectName, selectOption } from '@/model/board';
import { REACTION_EMOJI } from '../issue/Reactions';
import { PriorityIcon } from './PriorityIcon';

interface Props {
  item: BoardItem;
  schema: ProjectSchema;
  showTeam: boolean;
  canDrag: boolean;
  selected?: boolean;
  onSelect?: (itemId: string, additive: boolean) => void;
  onOpen: (key: string) => void;
}

export function CardBody({ item, schema, showTeam }: Pick<Props, 'item' | 'schema' | 'showTeam'>) {
  const team = selectOption(item, field(schema, TEAM));
  const workType = selectOption(item, field(schema, WORK_TYPE));
  const topReaction = item.reactions[0];
  return (
    <>
      <div className="card-top">
        <span className="mono">{item.key}</span>
        {item.parent && (
          <span className="faint card-parent" title={`Sub-issue of ${item.parent.key}`}>
            <CornerDownRight size={11} />
            {item.parent.key}
          </span>
        )}
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
          {item.subIssues.total > 0 && (
            <span title={`${item.subIssues.completed} of ${item.subIssues.total} sub-issues done`}>
              <ListTree size={11} />
              {item.subIssues.completed}/{item.subIssues.total}
            </span>
          )}
          {topReaction && (
            <span title={`${topReaction.count} reaction${topReaction.count === 1 ? '' : 's'}`}>
              <span aria-hidden>{REACTION_EMOJI[topReaction.content]}</span>
              {topReaction.count}
            </span>
          )}
          {item.state === 'CLOSED' &&
            (item.stateReason === 'COMPLETED' ? (
              <CheckCircle2 size={12} style={{ color: 'var(--c-purple)' }} />
            ) : (
              <XCircle size={12} />
            ))}
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

export function Card({ item, schema, showTeam, canDrag, selected, onSelect, onOpen }: Props) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({
    id: item.itemId,
    disabled: !canDrag,
    data: { item },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`card ${isDragging ? 'dragging' : ''} ${item.state === 'CLOSED' ? 'closed' : ''} ${selected ? 'selected' : ''}`}
      {...attributes}
      {...listeners}
      // Cmd/Ctrl-click builds a selection for bulk edits; a plain click opens the issue.
      onClick={(e) => (e.metaKey || e.ctrlKey ? onSelect?.(item.itemId, true) : onOpen(item.key))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(item.key);
      }}
    >
      <CardBody item={item} schema={schema} showTeam={showTeam} />
    </div>
  );
}
