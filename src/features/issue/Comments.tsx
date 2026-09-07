import { useState } from 'react';
import type { BoardItem } from '@shared/types';
import { useAddComment, useComments } from '@/api/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime, timeAgo } from '@/model/time';
import { MarkdownBody } from './Markdown';

export function Comments({ item }: { item: BoardItem }) {
  const comments = useComments(item.issueId);
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

  return (
    <section>
      <div className="section-title">
        <span>Activity</span>
        {comments.data && <span>{comments.data.length} comments</span>}
      </div>
      {comments.isPending && <div className="skeleton" style={{ height: 40 }} />}
      {comments.isError && <div className="faint">Couldn’t load comments.</div>}
      {comments.data?.map((c) => (
        <article key={c.id} className="comment">
          <Avatar person={c.author} size={22} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="comment-head">
              <b>{c.author?.login ?? 'ghost'}</b>
              <span className="faint" title={formatDateTime(c.createdAt)}>
                {timeAgo(c.createdAt)}
              </span>
            </div>
            <MarkdownBody>{c.body}</MarkdownBody>
          </div>
        </article>
      ))}
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
          <Button variant="primary" size="sm" disabled={!draft.trim() || add.isPending} onClick={submit}>
            {add.isPending ? 'Posting…' : 'Comment'}
          </Button>
        </div>
      </div>
    </section>
  );
}
