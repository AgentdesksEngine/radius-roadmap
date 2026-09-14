import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowRight, Check, Inbox, Play, X } from 'lucide-react';
import type { BoardItem, FieldValue, ProjectField } from '@shared/types';
import { useArchiveItem, useBoard, useSchema, useSetField } from '@/api/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { TimeAgo } from '@/components/ui/Time';
import { useToast } from '@/components/ui/Toast';
import {
  PRIORITY,
  STATUS,
  TEAM,
  WORK_TYPE,
  field,
  filterItems,
  intakeItems,
  missingTriageFields,
  selectNames,
} from '@/model/board';
import { LOGROCKET_FIELD, parseSessionUrl } from '@/model/logrocket';
import { excerpt } from '@/model/text';
import { BulkBar } from '../bulk/BulkBar';
import { SelectCell } from '../issue/SelectCell';
import { ViewHeader } from '../shell/ViewHeader';
import { useUi, useVisibleItems } from '../shell/state';
import './inbox.css';

/** Context fields worth showing on a triage card without opening the issue. */
const CONTEXT_FIELDS = ['Source', 'Brokerage', 'Reported by', 'Module'];
/** Rendered at once. The rest is one click away, so a 300-item backlog still opens fast. */
const PAGE = 50;

/**
 * The triage queue: everything that arrived without a team, a priority or a work type.
 * One screen, one decision per issue — accept it onto the board, or decline it.
 *
 * It is the highest-volume screen in the product, so it is driven from the keyboard:
 * j/k to move, 1-4 to set priority, a/d/e to accept, decline or archive. Every write
 * is reversible from the toast it raises.
 */
export function InboxView() {
  const { data: schema } = useSchema();
  const board = useBoard(Boolean(schema));
  const { openIssue, openKey, filters, selection, toggleSelected } = useUi();
  const setField = useSetField();
  const archive = useArchiveItem();
  const toast = useToast();

  // Rows stay put after they're triaged so the list doesn't jump out from under the cursor.
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const listRef = useRef<HTMLDivElement>(null);

  const queue = useMemo(() => {
    const all = board.data?.items ?? [];
    // The header carries a filter bar and a search box; the queue has to honour them.
    const items = filterItems(all, { ...filters, state: 'open', archived: false });
    const pending = intakeItems(items);
    const held = all.filter(
      (i) => resolved[i.itemId] && !pending.some((p) => p.itemId === i.itemId),
    );
    return [...pending, ...held].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [board.data, filters, resolved]);

  const visible = queue.slice(0, shown);
  useVisibleItems(visible);

  const statusField = field(schema, STATUS);
  const priorityField = field(schema, PRIORITY);
  const triageFields = [TEAM, PRIORITY, WORK_TYPE]
    .map((n) => field(schema, n))
    .filter((f): f is ProjectField => Boolean(f?.options));

  /** Writes one field and hands back an undo that restores exactly what was there. */
  const writeField = useCallback(
    (item: BoardItem, f: ProjectField, optionId: string | null) => {
      const before: FieldValue | undefined = item.fields[f.name];
      const option = optionId ? f.options?.find((o) => o.id === optionId) : undefined;
      const restore = () =>
        setField.mutate({
          itemId: item.itemId,
          fieldId: f.id,
          fieldName: f.name,
          value: before?.kind === 'singleSelect' ? { singleSelectOptionId: before.optionId } : null,
          optimistic: before?.kind === 'singleSelect' ? before : null,
        });
      setField.mutate(
        {
          itemId: item.itemId,
          fieldId: f.id,
          fieldName: f.name,
          value: option ? { singleSelectOptionId: option.id } : null,
          optimistic: option
            ? { kind: 'singleSelect', optionId: option.id, name: option.name }
            : null,
        },
        { onError: (e) => toast.error(`Couldn’t update ${item.key}: ${e.message}`) },
      );
      return restore;
    },
    [setField, toast],
  );

  const setStatus = useCallback(
    (item: BoardItem, optionName: string, label: string) => {
      const option = statusField?.options?.find((o) => o.name.toLowerCase() === optionName);
      if (!statusField || !option) return;
      const undo = writeField(item, statusField, option.id);
      setResolved((r) => ({ ...r, [item.itemId]: label }));
      toast.success(`${label} ${item.key}`, {
        action: {
          label: 'Undo',
          undo: true,
          onClick: () => {
            undo();
            setResolved((r) => {
              const { [item.itemId]: _gone, ...rest } = r;
              return rest;
            });
          },
        },
      });
    },
    [statusField, writeField, toast],
  );

  const archiveItem = useCallback(
    (item: BoardItem) => {
      archive.mutate(
        { itemId: item.itemId, archived: true },
        {
          onSuccess: () => {
            setResolved((r) => ({ ...r, [item.itemId]: 'Archived' }));
            toast.success(`Archived ${item.key}`, {
              action: {
                label: 'Undo',
                undo: true,
                onClick: () => {
                  archive.mutate({ itemId: item.itemId, archived: false });
                  setResolved((r) => {
                    const { [item.itemId]: _gone, ...rest } = r;
                    return rest;
                  });
                },
              },
            });
          },
          onError: (e) => toast.error(`Couldn’t archive: ${e.message}`),
        },
      );
    },
    [archive, toast],
  );

  // INTAKE-01: the queue is a queue, so it works the way a mail client does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || openKey) return;
      const item = visible[cursor];

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(visible.length - 1, c + 1));
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (!item) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        openIssue(item.key);
      } else if (e.key === 'x') {
        e.preventDefault();
        toggleSelected(item.itemId, true);
      } else if (e.key === 'a') {
        e.preventDefault();
        if (missingTriageFields(item).length === 0) setStatus(item, 'todo', 'Accepted');
        else toast.info(`${item.key} still needs ${missingTriageFields(item).join(', ')}`);
      } else if (e.key === 'd') {
        e.preventDefault();
        setStatus(item, 'canceled', 'Declined');
      } else if (e.key === 'e') {
        e.preventDefault();
        archiveItem(item);
      } else if (priorityField && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        const option = priorityField.options?.[Number(e.key) - 1];
        if (option) {
          writeField(item, priorityField, option.id);
          toast.success(`${item.key} · ${option.name}`);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    visible,
    cursor,
    openKey,
    openIssue,
    toggleSelected,
    setStatus,
    archiveItem,
    writeField,
    priorityField,
    toast,
  ]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('.intake-card.cursor')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // A shrinking queue must not leave the cursor past the end.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, visible.length - 1)));
  }, [visible.length]);

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
        <div className="intake" ref={listRef}>
          <p className="intake-hint faint">
            <kbd className="kbd">J</kbd> <kbd className="kbd">K</kbd> move ·{' '}
            <kbd className="kbd">1</kbd>–<kbd className="kbd">4</kbd> priority ·{' '}
            <kbd className="kbd">A</kbd> accept · <kbd className="kbd">D</kbd> decline ·{' '}
            <kbd className="kbd">E</kbd> archive
          </p>
          {visible.map((item, idx) => {
            const done = resolved[item.itemId];
            const missing = missingTriageFields(item);
            const session = (() => {
              // A replay is the one piece of context worth a click during triage.
              const raw = item.fields[LOGROCKET_FIELD];
              return raw?.kind === 'text' ? parseSessionUrl(raw.text) : null;
            })();
            return (
              <article
                key={item.itemId}
                className={`intake-card ${done ? 'done' : ''} ${idx === cursor ? 'cursor' : ''} ${
                  selection.includes(item.itemId) ? 'selected' : ''
                }`}
                onClick={() => setCursor(idx)}
              >
                <div className="intake-head">
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.key}`}
                    checked={selection.includes(item.itemId)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelected(item.itemId, true)}
                  />
                  <button className="mono muted" onClick={() => openIssue(item.key)}>
                    {item.key}
                  </button>
                  <button className="intake-title" onClick={() => openIssue(item.key)}>
                    {item.title}
                  </button>
                  <TimeAgo className="faint" iso={item.createdAt} suffix=" old" />
                  {item.author && <Avatar person={item.author} size={18} />}
                </div>

                {item.body && <p className="intake-body">{excerpt(item.body, 260)}</p>}

                <div className="intake-context">
                  {session && (
                    <a
                      className="tag intake-replay"
                      href={session.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Play size={10} /> {session.projectName} replay
                    </a>
                  )}
                  {CONTEXT_FIELDS.map((name) => {
                    const v = item.fields[name];
                    const text = v?.kind === 'text' ? v.text : selectNames(item, name).join(', ');
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
                      {/* INTAKE-03: the blocker goes on the button, not in a tooltip on a
                          disabled control nobody hovers. */}
                      <Button
                        size="sm"
                        variant={missing.length ? 'default' : 'primary'}
                        icon={<ArrowRight />}
                        title={missing.length ? undefined : 'Move to Todo'}
                        onClick={() =>
                          missing.length
                            ? toast.info(`${item.key} still needs ${missing.join(', ')}`)
                            : setStatus(item, 'todo', 'Accepted')
                        }
                      >
                        {missing.length
                          ? `Needs ${missing.map((m) => m.toLowerCase()).join(', ')}`
                          : 'Accept'}
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
                        shortcut="E"
                        size="sm"
                        onClick={() => archiveItem(item)}
                      >
                        <Archive />
                      </IconButton>
                    </>
                  )}
                </div>
              </article>
            );
          })}
          {queue.length > shown && (
            <Button
              className="intake-more"
              variant="ghost"
              onClick={() => setShown((n) => n + PAGE)}
            >
              Show {Math.min(PAGE, queue.length - shown)} more · {queue.length - shown} left
            </Button>
          )}
        </div>
      )}
      <BulkBar />
    </>
  );
}
