import { useEffect, useMemo, useState } from 'react';
import type { FieldWriteValue, OrgMember } from '@shared/types';
import { useCreateIssue, useMembers, useSchema } from '@/api/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Logo } from '@/components/ui/Logo';
import { Picker } from '@/components/ui/Picker';
import { Dot } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { MODULE, PRIORITY, STATUS, TEAM, WORK_TYPE, field } from '@/model/board';
import { PriorityIcon } from '../board/PriorityIcon';
import { useUi } from '../shell/state';

const QUICK_FIELDS = [STATUS, TEAM, WORK_TYPE, PRIORITY, MODULE];

export function NewIssueDialog() {
  const { newIssueOpen, setNewIssueOpen, filters, openIssue } = useUi();
  const { data: schema } = useSchema();
  const { data: members } = useMembers(newIssueOpen);
  const create = useCreateIssue();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [assignee, setAssignee] = useState<OrgMember | null>(null);

  const defaults = useMemo(() => {
    const d: Record<string, string> = {};
    const status = field(schema, STATUS);
    const todo = status?.options?.find((o) => o.name.toLowerCase() === 'todo') ?? status?.options?.[0];
    if (status && todo) d[status.name] = todo.id;
    const team = field(schema, TEAM);
    const teamOpt = team?.options?.find((o) => o.name === filters.team);
    if (team && teamOpt) d[team.name] = teamOpt.id;
    return d;
  }, [schema, filters.team]);

  useEffect(() => {
    if (newIssueOpen) {
      setPicks(defaults);
      setTitle('');
      setBody('');
      setAssignee(null);
    }
  }, [newIssueOpen, defaults]);

  const quick = QUICK_FIELDS.map((n) => field(schema, n)).filter((f): f is NonNullable<typeof f> => Boolean(f?.options));

  const submit = () => {
    const t = title.trim();
    if (!t || create.isPending) return;
    const fields: Record<string, FieldWriteValue> = {};
    for (const [name, id] of Object.entries(picks)) fields[name] = { singleSelectOptionId: id };
    create.mutate(
      { title: t, body: body.trim() || undefined, fields, assigneeIds: assignee ? [assignee.id] : undefined },
      {
        onSuccess: (item) => {
          toast.success(`Created ${item.key}`);
          setNewIssueOpen(false);
          openIssue(item.key);
        },
        onError: (e) => toast.error(`Couldn’t create issue: ${e.message}`),
      },
    );
  };

  return (
    <Dialog open={newIssueOpen} onOpenChange={setNewIssueOpen} title="New issue" crumb={<Logo small />} width={680}>
      <div
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
        }}
      >
        <input className="input" style={{ height: 34, fontSize: 15, fontWeight: 500, border: 0, padding: 0, boxShadow: 'none' }} placeholder="Issue title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="textarea" style={{ border: 0, padding: 0, minHeight: 100, boxShadow: 'none' }} placeholder="Add a description… (Markdown supported)" value={body} onChange={(e) => setBody(e.target.value)} />

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {quick.map((f) => {
            const cur = f.options?.find((o) => o.id === picks[f.name]);
            const isPrio = f.name === PRIORITY;
            return (
              <Picker
                key={f.id}
                items={(f.options ?? []).map((o) => ({ id: o.id, label: o.name, color: isPrio ? undefined : o.color, icon: isPrio ? <PriorityIcon name={o.name} /> : undefined }))}
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
                <Button size="sm" variant={cur ? 'default' : 'ghost'} icon={isPrio ? <PriorityIcon name={cur?.name} /> : <Dot color={cur?.color} />}>
                  {cur?.name ?? f.name}
                </Button>
              </Picker>
            );
          })}
          <Picker
            items={(members ?? []).map((m) => ({ id: m.id, label: m.name || 'Unknown', keywords: m.name ? [m.name] : [], icon: <Avatar person={m} size={16} /> }))}
            value={assignee?.id ?? null}
            onSelect={(id) => setAssignee(members?.find((m) => m.id === id) ?? null)}
            onClear={() => setAssignee(null)}
            clearLabel="Unassigned"
            placeholder="Assignee…"
          >
            <Button size="sm" variant={assignee ? 'default' : 'ghost'} icon={<Avatar person={assignee} size={14} />}>
              {assignee ? assignee.name || 'Unknown' : 'Assignee'}
            </Button>
          </Picker>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <span className="faint">⌘↵ to create</span>
          <Button variant="primary" disabled={!title.trim() || create.isPending} onClick={submit}>
            {create.isPending ? 'Creating…' : 'Create issue'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
