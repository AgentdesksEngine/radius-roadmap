import { useMemo, useState } from 'react';
import { Archive, ArrowRight, Check, Inbox, Play, X } from 'lucide-react';
import type { BoardItem, ProjectField } from '@shared/types';
import { useArchiveItem, useBoard, useSchema, useSetField } from '@/api/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import {
  PRIORITY,
  STATUS,
  TEAM,
  WORK_TYPE,
  field,
  intakeItems,
  missingTriageFields,
  selectName,
} from '@/model/board';
import { LOGROCKET_FIELD, parseSessionUrl } from '@/model/logrocket';
import { timeAgo } from '@/model/time';
import { SelectCell } from '../issue/SelectCell';
import { ViewHeader } from '../shell/ViewHeader';
import { useUi } from '../shell/state';
import './inbox.css';

/** Context fields worth showing on a triage card without opening the issue. */
const CONTEXT_FIELDS = ['Source', 'Brokerage', 'Reported by', 'Module'];

/**
 * The triage queue: everything that arrived without a team, a priority or a work type.
 * One screen, one decision per issue — accept it onto the board, or decline it.
 */
export function InboxView() {
  const { data: schema } = useSchema();
  const board = useBoard(Boolean(schema));
  const { openIssue } = useUi();
  const setField = useSetField();
  const archive = useArchiveItem();
  const toast = useToast();

  // Rows stay put after they're triaged so the list doesn't jump out from under the cursor.
  const [resolved, setResolved] = useState<Record<string, string>>({});

  const queue = useMemo(() => {
    const items = board.data?.items ?? [];
    const pending = intakeItems(items);
    const held = items.filter(
      (i) => resolved[i.itemId] && !pending.some((p) => p.itemId === i.itemId),
    );
    return [...pending, ...held].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [board.data, resolved]);

  const statusField = field(schema, STATUS);
  const triageFields = [TEAM, PRIORITY, WORK_TYPE]
    .map((n) => field(schema, n))
    .filter((f): f is ProjectField => Boolean(f?.options));

  const setStatus = (item: BoardItem, optionName: string, label: string) => {
    const option = statusField?.options?.find((o) => o.name.toLowerCase() === optionName);
    if (!statusField || !option) return;
    setField.mutate(
      {
        itemId: item.itemId,
        fieldId: statusField.id,
        fieldName: statusField.name,
        value: { singleSelectOptionId: option.id },
        optimistic: { kind: 'singleSelect', optionId: option.id, name: option.name },
      },
      {
        onSuccess: () => setResolved((r) => ({ ...r, [item.itemId]: label })),
        onError: (e) => toast.error(`Couldn’t update ${item.key}: ${e.message}`),
      },
    );
  };

  const pendingCount = queue.filter((i) => !resolved[i.itemId]).length;

  return (
    <>
      <ViewHeader title="Intake" count={board.data ? pendingCount : undefined} />

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
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 96 }} />
          ))}
        </div>
      ) : queue.length === 0 ? (
        <div className="empty-view">
          <Inbox size={22} />
          <span>Intake is clear. Every open issue has a team, a priority and a work type.</span>
        </div>
      ) : (
        <div className="intake">
          {queue.map((item) => {
            const done = resolved[item.itemId];
            const missing = missingTriageFields(item);
            return (
              <article key={item.itemId} className={`intake-card ${done ? 'done' : ''}`}>
                <div className="intake-head">
                  <button className="mono muted" onClick={() => openIssue(item.key)}>
                    {item.key}
                  </button>
                  <button className="intake-title" onClick={() => openIssue(item.key)}>
                    {item.title}
                  </button>
                  <span className="faint">{timeAgo(item.createdAt)} old</span>
                  {item.author && <Avatar person={item.author} size={18} />}
                </div>

                {item.body && (
                  <p className="intake-body">{item.body.replace(/\s+/g, ' ').slice(0, 260)}</p>
                )}

                <div className="intake-context">
                  {(() => {
                    // A replay is the one piece of context worth a click during triage.
                    const raw = item.fields[LOGROCKET_FIELD];
                    const session = raw?.kind === 'text' ? parseSessionUrl(raw.text) : null;
                    return session ? (
                      <a className="tag intake-replay" href={session.url} target="_blank" rel="noreferrer">
                        <Play size={10} /> {session.projectName} replay
                      </a>
                    ) : null;
                  })()}
                  {CONTEXT_FIELDS.map((name) => {
                    const v = item.fields[name];
                    const text = v?.kind === 'text' ? v.text : selectName(item, name);
                    return text ? (
                      <span key={name} className="tag" title={name}>
                        <span className="faint">{name}</span> {text}
                      </span>
                    ) : null;
                  })}
                </div>

                <div className="intake-actions">
                  {triageFields.map((f) => (
                    <span
                      key={f.id}
                      className={`intake-field ${missing.includes(f.name) ? 'missing' : ''}`}
                    >
                      <SelectCell item={item} field={f} />
                    </span>
                  ))}
                  <span className="spacer" />
                  {done ? (
                    <span className="intake-done">
                      <Check size={13} /> {done}
                    </span>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<ArrowRight />}
                        disabled={missing.length > 0 || setField.isPending}
                        title={
                          missing.length ? `Still needs: ${missing.join(', ')}` : 'Move to Todo'
                        }
                        onClick={() => setStatus(item, 'todo', 'Accepted')}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<X />}
                        onClick={() => setStatus(item, 'canceled', 'Declined')}
                      >
                        Decline
                      </Button>
                      <IconButton
                        label="Archive"
                        size="sm"
                        onClick={() =>
                          archive.mutate(
                            { itemId: item.itemId, archived: true },
                            {
                              onSuccess: () =>
                                setResolved((r) => ({ ...r, [item.itemId]: 'Archived' })),
                              onError: (e) => toast.error(`Couldn’t archive: ${e.message}`),
                            },
                          )
                        }
                      >
                        <Archive />
                      </IconButton>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
