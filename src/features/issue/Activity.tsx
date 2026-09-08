import { useState } from 'react';
import {
  CheckCircle2,
  CircleDot,
  Copy,
  CornerDownRight,
  Link2,
  Pencil,
  Tag as TagIcon,
  UserPlus,
  XCircle,
} from 'lucide-react';
import type { ActivityEvent, BoardItem } from '@shared/types';
import { useActivity, useAddComment } from '@/api/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime, timeAgo } from '@/model/time';
import { MarkdownBody } from './Markdown';
import { Reactions } from './Reactions';

/** Icon and sentence for one non-comment timeline event. */
function describe(e: ActivityEvent): { icon: React.ReactNode; text: React.ReactNode } | null {
  switch (e.kind) {
    case 'closed':
      return { icon: <CheckCircle2 />, text: <>closed this as {e.detail}</> };
    case 'reopened':
      return { icon: <CircleDot />, text: <>reopened this</> };
    case 'assigned':
      return { icon: <UserPlus />, text: <>assigned {e.detail}</> };
    case 'unassigned':
      return { icon: <UserPlus />, text: <>unassigned {e.detail}</> };
    case 'labeled':
      return {
        icon: <TagIcon />,
        text: (
          <>
            added the <b>{e.detail}</b> label
          </>
        ),
      };
    case 'unlabeled':
      return {
        icon: <TagIcon />,
        text: (
          <>
            removed the <b>{e.detail}</b> label
          </>
        ),
      };
    case 'renamed':
      return { icon: <Pencil />, text: <>renamed this from “{e.from}”</> };
    case 'status':
      return {
        icon: <CornerDownRight />,
        text: (
          <>
            moved status <b>{e.from || 'none'}</b> → <b>{e.to || 'none'}</b>
          </>
        ),
      };
    case 'referenced':
      return { icon: <Link2 />, text: <>referenced this in {e.detail}</> };
    case 'sub-issue-added':
      return {
        icon: <CornerDownRight />,
        text: (
          <>
            added <b>{e.detail}</b> as a sub-issue
          </>
        ),
      };
    case 'sub-issue-removed':
      return {
        icon: <CornerDownRight />,
        text: (
          <>
            removed sub-issue <b>{e.detail}</b>
          </>
        ),
      };
    case 'parent-added':
      return {
        icon: <CornerDownRight />,
        text: (
          <>
            made this a sub-issue of <b>{e.detail}</b>
          </>
        ),
      };
    case 'parent-removed':
      return {
        icon: <CornerDownRight />,
        text: (
          <>
            detached this from <b>{e.detail}</b>
          </>
        ),
      };
    case 'duplicate':
      return {
        icon: <Copy />,
        text: (
          <>
            marked this as a duplicate of <b>{e.detail}</b>
          </>
        ),
      };
    default:
      return null;
  }
}

/** Comments and GitHub timeline events in one feed, oldest first. */
export function Activity({ item }: { item: BoardItem }) {
  const activity = useActivity(item.issueId);
  const add = useAddComment(item.issueId, item.itemId);
  const toast = useToast();
  const [draft, setDraft] = useState('');

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    add.mutate(body, {
      onSuccess: () => setDraft(''),
      onError: (e) => toast.error(`Couldn’t post comment: ${e.message}`),
    });
  };

  const events = activity.data ?? [];
  const commentCount = events.filter((e) => e.kind === 'comment').length;

  return (
    <section>
      <div className="section-title">
        <span>Activity</span>
        {activity.data && (
          <span>{commentCount === 1 ? '1 comment' : `${commentCount} comments`}</span>
        )}
      </div>
      {activity.isPending && <div className="skeleton" style={{ height: 40 }} />}
      {activity.isError && <div className="faint">Couldn’t load activity.</div>}

      {events.map((e) =>
        e.kind === 'comment' ? (
          <article key={e.id} className="comment">
            <Avatar person={e.actor} size={22} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="comment-head">
                <b>{e.actor?.name ?? 'ghost'}</b>
                <span className="faint" title={formatDateTime(e.createdAt)}>
                  {timeAgo(e.createdAt)}
                </span>
              </div>
              <MarkdownBody>{e.body ?? ''}</MarkdownBody>
              <Reactions subjectId={e.id} reactions={e.reactions ?? []} issueId={item.issueId} />
            </div>
          </article>
        ) : (
          <EventRow key={e.id} event={e} />
        ),
      )}

      <div className="composer">
        <textarea
          className="textarea"
          placeholder="Leave a comment… (Markdown supported)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
          }}
        />
        <div className="actions">
          <span className="faint">⌘↵ to post</span>
          <Button
            variant="primary"
            size="sm"
            disabled={!draft.trim() || add.isPending}
            onClick={submit}
          >
            {add.isPending ? 'Posting…' : 'Comment'}
          </Button>
        </div>
      </div>
    </section>
  );
}

function EventRow({ event }: { event: ActivityEvent }) {
  const d = describe(event);
  if (!d) return null;
  const body = (
    <>
      <span className="event-icon">{d.icon}</span>
      <Avatar person={event.actor} size={16} />
      <span className="truncate">
        <b>{event.actor?.name ?? 'someone'}</b> {d.text}
      </span>
      <span className="faint" title={formatDateTime(event.createdAt)}>
        {timeAgo(event.createdAt)}
      </span>
    </>
  );
  return event.url ? (
    <a className="event" href={event.url} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <div className="event">{body}</div>
  );
}
