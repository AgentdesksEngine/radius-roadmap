import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as RD from '@radix-ui/react-dialog';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Pencil,
  X,
  XCircle,
} from 'lucide-react';
import type { BoardItem, Person } from '@shared/types';
import { useArchiveItem, useBoard, useMembers, useSchema, useUpdateIssue } from '@/api/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { Confirm } from '@/components/ui/Confirm';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { Picker } from '@/components/ui/Picker';
import { useToast } from '@/components/ui/Toast';
import { customFields } from '@/model/board';
import { usePref } from '@/model/prefs';
import { formatDateTime, timeAgo } from '@/model/time';
import { useUi } from '../shell/state';
import { Activity } from './Activity';
import { Composer } from './Composer';
import { DirtyCtx, useDirtyDraft } from './drafts';
import { FieldEditor } from './FieldEditor';
import { MarkdownBody } from './Markdown';
import { Reactions } from './Reactions';
import { SubIssues } from './SubIssues';
import './issue.css';

export function IssuePanel() {
  const { openKey, openIssue, visibleKeys } = useUi();
  const { data: schema } = useSchema();
  const board = useBoard(Boolean(schema));
  const [width, setWidth] = usePref<number>('panelWidth', 600);
  const dirty = useRef(new Set<string>());
  const [confirmClose, setConfirmClose] = useState(false);

  const mark = useCallback((id: string, isDirty: boolean) => {
    if (isDirty) dirty.current.add(id);
    else dirty.current.delete(id);
  }, []);

  const close = useCallback(() => {
    dirty.current.clear();
    setConfirmClose(false);
    openIssue(null);
  }, [openIssue]);

  // DRAWER-02: unsaved writing is the one thing here nothing else has a copy of.
  const requestClose = useCallback(() => {
    if (dirty.current.size > 0) setConfirmClose(true);
    else close();
  }, [close]);

  const item = board.data?.items.find((i) => i.key.toLowerCase() === openKey?.toLowerCase());

  // DRAWER-05: walk the order the view behind is showing.
  const idx = openKey ? visibleKeys.indexOf(openKey) : -1;
  const goTo = useCallback(
    (delta: number) => {
      if (idx === -1) return;
      const next = visibleKeys[idx + delta];
      if (!next) return;
      if (dirty.current.size > 0) {
        setConfirmClose(true);
        return;
      }
      openIssue(next);
    },
    [idx, visibleKeys, openIssue],
  );

  useEffect(() => {
    if (!openKey) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        goTo(1);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        goTo(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openKey, goTo]);

  // DRAWER-06: drag the left edge to resize; the width is remembered.
  const onResize = (startX: number) => {
    const startWidth = width;
    const move = (e: PointerEvent) =>
      setWidth(Math.min(Math.max(420, startWidth + (startX - e.clientX)), window.innerWidth - 120));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!openKey) return null;

  return (
    <DirtyCtx.Provider value={mark}>
      <RD.Root open onOpenChange={(o) => !o && requestClose()}>
        <RD.Portal>
          <RD.Overlay className="panel-backdrop" />
          <RD.Content
            className="panel"
            style={{ width: `min(${width}px, 100vw)` }}
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).focus();
            }}
            // The confirm dialog owns the decision when there is unsaved text.
            onEscapeKeyDown={(e) => {
              e.preventDefault();
              requestClose();
            }}
            onInteractOutside={(e) => {
              e.preventDefault();
              requestClose();
            }}
          >
            <RD.Title className="sr-only">{item ? `${item.key}: ${item.title}` : openKey}</RD.Title>
            {item && schema ? (
              <PanelContent
                key={item.itemId}
                item={item}
                onClose={requestClose}
                onPrev={idx > 0 ? () => goTo(-1) : undefined}
                onNext={idx !== -1 && idx < visibleKeys.length - 1 ? () => goTo(1) : undefined}
                position={idx === -1 ? undefined : `${idx + 1} of ${visibleKeys.length}`}
              />
            ) : (
              <>
                <header className="panel-head">
                  <span className="mono muted">{openKey}</span>
                  <span className="spacer" />
                  <IconButton label="Close" shortcut="Esc" onClick={requestClose}>
                    <X />
                  </IconButton>
                </header>
                <div className="panel-notfound">
                  {board.isPending ? (
                    <span className="spinner" />
                  ) : (
                    `${openKey} isn’t on this board.`
                  )}
                </div>
              </>
            )}
            <div
              className="panel-resize"
              role="separator"
              aria-label="Resize panel"
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={(e) => {
                e.preventDefault();
                onResize(e.clientX);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft')
                  setWidth((w) => Math.min(w + 32, window.innerWidth - 120));
                if (e.key === 'ArrowRight') setWidth((w) => Math.max(w - 32, 420));
              }}
            />
          </RD.Content>
        </RD.Portal>
      </RD.Root>

      <Confirm
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Discard what you’ve written?"
        body="This issue has an unsaved description or comment. Closing now throws it away."
        confirmLabel="Discard"
        danger
        onConfirm={close}
      />
    </DirtyCtx.Provider>
  );
}

function PanelContent({
  item,
  onClose,
  onPrev,
  onNext,
  position,
}: {
  item: BoardItem;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: string;
}) {
  const { data: schema } = useSchema();
  const update = useUpdateIssue();
  const archive = useArchiveItem();
  const toast = useToast();
  const { data: members } = useMembers();

  const [title, setTitle] = useState(item.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => setTitle(item.title), [item.title]);
  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = '0px';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [title]);

  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState(item.body);
  useDirtyDraft('body', editingBody && bodyDraft !== item.body);

  // DRAWER-04: a write that happens on blur needs to say that it happened.
  const flagSaved = (what: string) => {
    setSaved(what);
    window.setTimeout(() => setSaved((s) => (s === what ? null : s)), 1800);
  };

  const patch = (body: Parameters<typeof update.mutate>[0], what: string) =>
    update.mutate(body, {
      onSuccess: () => flagSaved(what),
      onError: (e) => toast.error(`Couldn’t update ${what}: ${e.message}`),
    });

  const commitTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(item.title);
    if (t !== item.title) patch({ issueId: item.issueId, itemId: item.itemId, title: t }, 'title');
  };

  const setAssignees = (next: Person[]) =>
    patch(
      {
        issueId: item.issueId,
        itemId: item.itemId,
        assigneeIds: next.map((p) => p.id),
        optimisticAssignees: next,
      },
      'assignees',
    );

  const toggleAssignee = (id: string) => {
    const has = item.assignees.some((a) => a.id === id);
    const person = members?.find((m) => m.id === id);
    if (has) setAssignees(item.assignees.filter((a) => a.id !== id));
    else if (person) setAssignees([...item.assignees, person]);
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      toast.success(label);
    } catch {
      toast.error('Couldn’t reach the clipboard. Copy the address bar instead.');
    }
  };

  const fields = schema ? customFields(schema) : [];
  const closed = item.state === 'CLOSED';

  return (
    <>
      <header className="panel-head">
        <span className="mono muted">{item.key}</span>
        <Menu>
          <MenuTrigger asChild>
            <button
              className={`state-pill ${closed ? (item.stateReason === 'COMPLETED' ? 'closed' : 'not-planned') : ''}`}
            >
              {closed ? (
                item.stateReason === 'COMPLETED' ? (
                  <CheckCircle2 />
                ) : (
                  <XCircle />
                )
              ) : (
                <CircleDot />
              )}
              {closed
                ? item.stateReason === 'COMPLETED'
                  ? 'Closed'
                  : item.stateReason === 'DUPLICATE'
                    ? 'Duplicate'
                    : 'Not planned'
                : 'Open'}
              <ChevronDown />
            </button>
          </MenuTrigger>
          <MenuContent>
            {closed ? (
              <MenuItem
                onSelect={() =>
                  patch({ issueId: item.issueId, itemId: item.itemId, state: 'OPEN' }, 'state')
                }
              >
                <CircleDot /> Reopen issue
              </MenuItem>
            ) : (
              <>
                <MenuItem
                  onSelect={() =>
                    patch(
                      {
                        issueId: item.issueId,
                        itemId: item.itemId,
                        state: 'CLOSED',
                        stateReason: 'COMPLETED',
                      },
                      'state',
                    )
                  }
                >
                  <CheckCircle2 /> Close as completed
                </MenuItem>
                <MenuItem
                  onSelect={() =>
                    patch(
                      {
                        issueId: item.issueId,
                        itemId: item.itemId,
                        state: 'CLOSED',
                        stateReason: 'NOT_PLANNED',
                      },
                      'state',
                    )
                  }
                >
                  <XCircle /> Close as not planned
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>
        {saved && <span className="saved-flag">Saved</span>}
        <span className="spacer" />
        {item.isArchived && <span className="tag">Archived</span>}

        {/* DRAWER-05 */}
        <span className="panel-nav">
          <IconButton
            label="Previous issue"
            shortcut="K"
            size="sm"
            disabled={!onPrev}
            onClick={onPrev}
          >
            <ChevronUp />
          </IconButton>
          <IconButton label="Next issue" shortcut="J" size="sm" disabled={!onNext} onClick={onNext}>
            <ChevronDown />
          </IconButton>
          {position && <span className="faint panel-pos">{position}</span>}
        </span>

        <Menu>
          <MenuTrigger asChild>
            <button className="icon-btn" aria-label="More actions">
              <MoreHorizontal />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem
              onSelect={() =>
                void copy(
                  `${window.location.origin}/board?i=${item.key}`,
                  `Copied a link to ${item.key}`,
                )
              }
            >
              <Link2 /> Copy link
            </MenuItem>
            <MenuItem
              onSelect={() =>
                archive.mutate(
                  { itemId: item.itemId, archived: !item.isArchived },
                  {
                    onSuccess: () =>
                      toast.success(
                        item.isArchived ? `${item.key} restored` : `${item.key} archived`,
                        {
                          action: {
                            label: 'Undo',
                            undo: true,
                            onClick: () =>
                              archive.mutate({ itemId: item.itemId, archived: item.isArchived }),
                          },
                        },
                      ),
                    onError: (e) => toast.error(`Couldn’t archive: ${e.message}`),
                  },
                )
              }
            >
              {item.isArchived ? <ArchiveRestore /> : <Archive />}
              {item.isArchived ? 'Restore to board' : 'Archive'}
            </MenuItem>
          </MenuContent>
        </Menu>
        {/* DRAWER-03: this used to be a second "Copy link" wearing an external-link icon. */}
        <IconButton
          label="Open in GitHub"
          onClick={() => window.open(item.url, '_blank', 'noopener')}
        >
          <ExternalLink />
        </IconButton>
        <IconButton label="Close" shortcut="Esc" onClick={onClose}>
          <X />
        </IconButton>
      </header>

      <div className="panel-body">
        <textarea
          ref={titleRef}
          className="panel-title"
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
            if (e.key === 'Escape') {
              e.preventDefault(); // reverting is handling it; the drawer stays open
              setTitle(item.title);
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          aria-label="Title"
        />

        {editingBody ? (
          <div className="composer">
            <Composer
              value={bodyDraft}
              onChange={setBodyDraft}
              minHeight={160}
              autoFocus
              placeholder="Describe the bug…"
            />
            <div className="actions">
              <Button size="sm" variant="ghost" onClick={() => setEditingBody(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  if (bodyDraft !== item.body)
                    patch(
                      { issueId: item.issueId, itemId: item.itemId, body: bodyDraft },
                      'description',
                    );
                  setEditingBody(false);
                }}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="body-view">
            {item.body ? (
              <MarkdownBody>{item.body}</MarkdownBody>
            ) : (
              <p className="body-empty">No description</p>
            )}
            <IconButton
              label="Edit description"
              size="sm"
              className="edit"
              onClick={() => {
                setBodyDraft(item.body);
                setEditingBody(true);
              }}
            >
              <Pencil />
            </IconButton>
          </div>
        )}

        <Reactions subjectId={item.issueId} reactions={item.reactions} itemId={item.itemId} />

        <SubIssues item={item} />

        <div className="props">
          <span className="label">Assignees</span>
          <Picker
            items={(members ?? []).map((m) => ({
              id: m.id,
              label: m.name || 'Unknown',
              keywords: m.name ? [m.name] : [],
              icon: <Avatar person={m} size={16} />,
            }))}
            value={item.assignees.map((a) => a.id)}
            multiple
            onSelect={toggleAssignee}
            placeholder="Assign to…"
          >
            <button className={`prop-btn ${item.assignees.length ? '' : 'empty'}`}>
              {item.assignees.length ? (
                <span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
                  {item.assignees.map((a) => (
                    <span
                      key={a.id}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    >
                      <Avatar person={a} size={16} />
                      {a.name || 'Unknown'}
                    </span>
                  ))}
                </span>
              ) : (
                <>
                  <Avatar person={null} size={16} /> Unassigned
                </>
              )}
            </button>
          </Picker>
          {fields.map((f) => (
            <FieldRow key={f.id} label={f.name}>
              <FieldEditor item={item} field={f} />
            </FieldRow>
          ))}
          {item.labels.length > 0 && (
            <FieldRow label="Labels">
              <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                {item.labels.map((l) => (
                  <span key={l.name} className="tag">
                    <span className="dot" style={{ background: `#${l.color}` }} />
                    {l.name}
                  </span>
                ))}
              </span>
            </FieldRow>
          )}
        </div>

        <div className="meta-line">
          Opened {timeAgo(item.createdAt)} ago by {item.author?.name ?? 'unknown'} · updated{' '}
          {formatDateTime(item.updatedAt)}
          {item.closedAt && ` · closed ${formatDateTime(item.closedAt)}`}
        </div>

        <Activity item={item} />
      </div>
    </>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="label">{label}</span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </>
  );
}
