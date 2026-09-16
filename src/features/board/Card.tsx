import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle2, CornerDownRight, GitPullRequest, ListTree, MessageSquare, XCircle } from 'lucide-react';
import type { BoardItem, ProjectSchema } from '@shared/types';
import { AvatarStack } from '@/components/ui/Avatar';
import { Tag } from '@/components/ui/Tag';
import {
  PRIORITY,
  TEAM,
  WORK_TYPE,
  field,
  selectName,
  selectOption,
  selectOptions,
} from '@/model/board';
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
  const teams = selectOptions(item, field(schema, TEAM));
  const workType = selectOption(item, field(schema, WORK_TYPE));
  const topReaction = item.reactions[0];
  const newestPr = item.pullRequests[item.pullRequests.length - 1];
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
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <AvatarStack people={item.assignees} size={18} />
          <AvatarStack people={item.collaborators} size={18} />
        </span>
      </div>
      <div className="card-title">{item.title}</div>
      <div className="card-meta">
        <PriorityIcon name={selectName(item, PRIORITY)} />
        {workType && (
          <Tag color={workType.color} plain>
            {workType.name}
          </Tag>
        )}
        {showTeam &&
          teams.map((t) => (
            <Tag key={t.id} color={t.color}>
              {t.name}
            </Tag>
          ))}
        {/* Newest PR only: a card is a summary, and the panel lists all of them. */}
        {newestPr && (
          <span className={`pr-chip ${newestPr.state}`} title={`${newestPr.repo}#${newestPr.number} ${newestPr.state}`}>
            <GitPullRequest />#{newestPr.number}
          </span>
        )}
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
      className={`card ${canDrag ? 'draggable' : ''} ${isDragging ? 'dragging' : ''} ${item.state === 'CLOSED' ? 'closed' : ''} ${selected ? 'selected' : ''}`}
      {...attributes}
      {...listeners}
      aria-label={`${item.key}: ${item.title}`}
      // Cmd/Ctrl-click builds a selection for bulk edits; a plain click opens the issue.
      onClick={(e) => (e.metaKey || e.ctrlKey ? onSelect?.(item.itemId, true) : onOpen(item.key))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(item.key);
        // Matches the list views, and gives the selection a keyboard route in.
        if (e.key === 'x') {
          e.preventDefault();
          onSelect?.(item.itemId, true);
        }
      }}
    >
      {onSelect && (
        <input
          type="checkbox"
          className="card-check"
          aria-label={`Select ${item.key}`}
          checked={Boolean(selected)}
          // The card owns both click-to-open and the drag listeners; the box wants neither.
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onSelect(item.itemId, true)}
        />
      )}
      <CardBody item={item} schema={schema} showTeam={showTeam} />
    </div>
  );
}
