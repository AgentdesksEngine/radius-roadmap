import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronDown,
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
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { Picker } from '@/components/ui/Picker';
import { useToast } from '@/components/ui/Toast';
import { customFields } from '@/model/board';
import { formatDateTime, timeAgo } from '@/model/time';
import { useUi } from '../shell/state';
import { Activity } from './Activity';
import { FieldEditor } from './FieldEditor';
import { MarkdownBody } from './Markdown';
import { Reactions } from './Reactions';
import { SubIssues } from './SubIssues';
import './issue.css';

export function IssuePanel() {
  const { openKey, openIssue } = useUi();
  const { data: schema } = useSchema();
  const board = useBoard(Boolean(schema));
  if (!openKey) return null;
  const item = board.data?.items.find((i) => i.key.toLowerCase() === openKey.toLowerCase());
  return (
    <>
      <div className="panel-backdrop" onClick={() => openIssue(null)} />
      <aside className="panel" aria-label={`Issue ${openKey}`}>
        {item && schema ? (
          <PanelContent key={item.itemId} item={item} onClose={() => openIssue(null)} />
        ) : (
          <>
            <header className="panel-head">
              <span className="mono muted">{openKey}</span>
              <span className="spacer" />
              <IconButton label="Close" shortcut="Esc" onClick={() => openIssue(null)}>
                <X />
              </IconButton>
            </header>
            <div className="panel-notfound">
              {board.isPending ? <span className="spinner" /> : `${openKey} isn’t on this board.`}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function PanelContent({ item, onClose }: { item: BoardItem; onClose: () => void }) {
  const { data: schema } = useSchema();
  const update = useUpdateIssue();
  const archive = useArchiveItem();
  const toast = useToast();
  const { data: members } = useMembers();

  const [title, setTitle] = useState(item.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
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

  const patch = (body: Parameters<typeof update.mutate>[0], what: string) =>
    update.mutate(body, { onError: (e) => toast.error(`Couldn’t update ${what}: ${e.message}`) });

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
        assigneeLogins: next.map((p) => p.login),
        optimisticAssignees: next,
      },
      'assignees',
    );

  const toggleAssignee = (login: string) => {
    const has = item.assignees.some((a) => a.login === login);
    const person = members?.find((m) => m.login === login);
    if (has) setAssignees(item.assignees.filter((a) => a.login !== login));
    else if (person)
      setAssignees([
        ...item.assignees,
        { login: person.login, avatarUrl: person.avatarUrl, name: person.name },
      ]);
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
        <span className="spacer" />
        {item.isArchived && <span className="tag">Archived</span>}
        <Menu>
          <MenuTrigger asChild>
            <button className="icon-btn" aria-label="More actions">
              <MoreHorizontal />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem
              onSelect={() => {
                void navigator.clipboard?.writeText(
                  `${window.location.origin}/board?i=${item.key}`,
                );
                toast.success(`Copied a link to ${item.key}`);
              }}
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
        <IconButton label="Open in GitHub" onClick={() => window.open(item.url, '_blank')}>
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
              setTitle(item.title);
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          aria-label="Title"
        />

        {editingBody ? (
          <div className="composer">
            <textarea
              className="textarea"
              style={{ minHeight: 160 }}
              autoFocus
              value={bodyDraft}
              onChange={(e) => setBodyDraft(e.target.value)}
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
              id: m.login,
              label: m.name || m.login,
              keywords: [m.login],
              icon: <Avatar person={m} size={16} />,
            }))}
            value={item.assignees.map((a) => a.login)}
            multiple
            onSelect={toggleAssignee}
            placeholder="Assign to…"
          >
            <button className={`prop-btn ${item.assignees.length ? '' : 'empty'}`}>
              {item.assignees.length ? (
                <span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
                  {item.assignees.map((a) => (
                    <span
                      key={a.login}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    >
                      <Avatar person={a} size={16} />
                      {a.name || a.login}
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
          Opened {timeAgo(item.createdAt)} ago by {item.author?.login ?? 'unknown'} · updated{' '}
          {formatDateTime(item.updatedAt)}
          {item.closedAt && ` · closed ${formatDateTime(item.closedAt)}`}
        </div>

        <Activity item={item} />
      </div>
    </>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="label">{label}</span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </>
  );
}
