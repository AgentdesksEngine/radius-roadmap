import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, UserCircle } from 'lucide-react';
import type { FieldWriteValue, OrgMember } from '@shared/types';
import { useAuth, useCreateIssue, useMembers, useSchema } from '@/api/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Logo } from '@/components/ui/Logo';
import { Picker } from '@/components/ui/Picker';
import { Dot } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { MODULE, PRIORITY, STATUS, TEAM, WORK_TYPE, field, selectWrite } from '@/model/board';
import { Composer } from '../issue/Composer';
import { PriorityIcon } from '../board/PriorityIcon';
import { useUi } from '../shell/state';

const QUICK_FIELDS = [STATUS, TEAM, WORK_TYPE, PRIORITY, MODULE];
const DRAFT_KEY = 'bt:new-issue-draft';

interface Draft {
  title: string;
  body: string;
  picks: Record<string, string>;
  assigneeId: string | null;
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d.title?.trim() || d.body?.trim() ? d : null;
  } catch {
    return null;
  }
}

export function NewIssueDialog() {
  const { newIssueOpen, setNewIssueOpen, filters, openIssue } = useUi();
  const { data: schema } = useSchema();
  const { data: members } = useMembers(newIssueOpen);
  const { data: auth } = useAuth();
  const create = useCreateIssue();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [assignee, setAssignee] = useState<OrgMember | null>(null);
  const [createMore, setCreateMore] = useState(false);
  const [restored, setRestored] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const defaults = useMemo(() => {
    const d: Record<string, string> = {};
    const status = field(schema, STATUS);
    const todo =
      status?.options?.find((o) => o.name.toLowerCase() === 'todo') ?? status?.options?.[0];
    if (status && todo) d[status.name] = todo.id;
    const team = field(schema, TEAM);
    const teamOpt = team?.options?.find((o) => o.name === filters.team);
    if (team && teamOpt) d[team.name] = teamOpt.id;
    return d;
  }, [schema, filters.team]);

  const reset = (keepPicks = false) => {
    setTitle('');
    setBody('');
    setAssignee(keepPicks ? assignee : null);
    setPicks(keepPicks ? picks : defaults);
    setRestored(false);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* private mode */
    }
  };

  // NEW-01: a written-up bug is the one thing in this app nothing else has a copy of.
  // It is kept as you type and restored on the next open, so Escape costs nothing.
  useEffect(() => {
    if (!newIssueOpen) return;
    const draft = readDraft();
    if (draft) {
      setTitle(draft.title);
      setBody(draft.body);
      setPicks(draft.picks ?? defaults);
      setAssignee(
        draft.assigneeId ? (members?.find((m) => m.id === draft.assigneeId) ?? null) : null,
      );
      setRestored(true);
    } else {
      setTitle('');
      setBody('');
      setPicks(defaults);
      setAssignee(null);
      setRestored(false);
    }
    // `members` is deliberately out of the deps: a late member fetch must not clobber typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newIssueOpen, defaults]);

  useEffect(() => {
    if (!newIssueOpen) return;
    if (!title.trim() && !body.trim()) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ title, body, picks, assigneeId: assignee?.id ?? null } satisfies Draft),
      );
    } catch {
      /* private mode: the draft only lives as long as the dialog */
    }
  }, [newIssueOpen, title, body, picks, assignee]);

  const quick = QUICK_FIELDS.map((n) => field(schema, n)).filter((f): f is NonNullable<typeof f> =>
    Boolean(f?.options),
  );

  const me = members?.find((m) => m.id === auth?.user?.id);

  const submit = () => {
    const t = title.trim();
    if (!t || create.isPending) return;
    const fields: Record<string, FieldWriteValue> = {};
    for (const [name, id] of Object.entries(picks)) {
      const f = field(schema, name);
      const v = f && selectWrite(f, [id]);
      if (v) fields[name] = v;
    }
    create.mutate(
      {
        title: t,
        body: body.trim() || undefined,
        fields,
        assigneeIds: assignee ? [assignee.id] : undefined,
      },
      {
        onSuccess: (item) => {
          reset(createMore);
          if (createMore) {
            // NEW-02: working down a Slack thread means several in a row.
            toast.success(`Created ${item.key}`, {
              action: { label: 'Open', onClick: () => openIssue(item.key) },
            });
            titleRef.current?.focus();
          } else {
            toast.success(`Created ${item.key}`);
            setNewIssueOpen(false);
            openIssue(item.key);
          }
        },
        onError: (e) => toast.error(`Couldn’t create issue: ${e.message}`),
      },
    );
  };

  return (
    <Dialog
      open={newIssueOpen}
      onOpenChange={setNewIssueOpen}
      title="New issue"
      crumb={<Logo small />}
      width={680}
    >
      <div
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
        }}
      >
        {restored && (
          <div className="draft-restored">
            <span>Picked up where you left off.</span>
            <button className="link-btn" onClick={() => reset()}>
              <Trash2 size={12} /> Discard draft
            </button>
          </div>
        )}
        <input
          ref={titleRef}
          className="input"
          style={{
            height: 34,
            fontSize: 15,
            fontWeight: 500,
            border: 0,
            padding: 0,
            boxShadow: 'none',
          }}
          placeholder="Issue title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Composer
          value={body}
          onChange={setBody}
          minHeight={100}
          placeholder="Add a description…"
        />

        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginTop: 8,
            paddingTop: 12,
            borderTop: '1px solid var(--border)',
          }}
        >
          {quick.map((f) => {
            const cur = f.options?.find((o) => o.id === picks[f.name]);
            const isPrio = f.name === PRIORITY;
            return (
              <Picker
                key={f.id}
                items={(f.options ?? []).map((o) => ({
                  id: o.id,
                  label: o.name,
                  color: isPrio ? undefined : o.color,
                  icon: isPrio ? <PriorityIcon name={o.name} /> : undefined,
                }))}
                value={cur?.id ?? null}
                onSelect={(id) => setPicks((p) => ({ ...p, [f.name]: id }))}
                onClear={() =>
                  setPicks((p) => {
                    const { [f.name]: _x, ...rest } = p;
                    return rest;
                  })
                }
                clearLabel={`No ${f.name.toLowerCase()}`}
                placeholder={`${f.name}…`}
              >
                <Button
                  size="sm"
                  variant={cur ? 'default' : 'ghost'}
                  icon={isPrio ? <PriorityIcon name={cur?.name} /> : <Dot color={cur?.color} />}
                >
                  {cur?.name ?? f.name}
                </Button>
              </Picker>
            );
          })}
          <Picker
            items={(members ?? []).map((m) => ({
              id: m.id,
              label: m.name || 'Unknown',
              keywords: m.name ? [m.name] : [],
              hint: m.id === auth?.user?.id ? 'you' : undefined,
              icon: <Avatar person={m} size={16} />,
            }))}
            value={assignee?.id ?? null}
            onSelect={(id) => setAssignee(members?.find((m) => m.id === id) ?? null)}
            onClear={() => setAssignee(null)}
            clearLabel="Unassigned"
            placeholder="Assignee…"
          >
            <Button
              size="sm"
              variant={assignee ? 'default' : 'ghost'}
              icon={<Avatar person={assignee} size={14} />}
            >
              {assignee ? assignee.name || 'Unknown' : 'Assignee'}
            </Button>
          </Picker>
          {/* NEW-04: the single most common assignment, one click instead of a search. */}
          {me && assignee?.id !== me.id && (
            <Button size="sm" variant="ghost" icon={<UserCircle />} onClick={() => setAssignee(me)}>
              Assign to me
            </Button>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 10,
            marginTop: 14,
          }}
        >
          <label className="create-more">
            <input
              type="checkbox"
              checked={createMore}
              onChange={(e) => setCreateMore(e.target.checked)}
            />
            Create more
          </label>
          <span className="spacer" style={{ flex: 1 }} />
          {/* NEW-04: say what the disabled state wants, rather than just greying out. */}
          <span className="faint">{title.trim() ? '⌘↵ to create' : 'Add a title to create'}</span>
          <Button variant="primary" disabled={!title.trim() || create.isPending} onClick={submit}>
            {create.isPending ? 'Creating…' : 'Create issue'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
