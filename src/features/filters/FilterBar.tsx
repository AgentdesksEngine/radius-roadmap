import { useState } from 'react';
import { ListFilter, X } from 'lucide-react';
import type { ProjectField } from '@shared/types';
import { useBoard, useMembers, useSchema } from '@/api/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { Picker, type PickerItem } from '@/components/ui/Picker';
import { TEAM, activeFilterCount, selectFields, type StateFilter } from '@/model/board';
import { useUi } from '../shell/state';

const STATE_LABEL: Record<StateFilter, string> = { active: 'Active', open: 'Open', closed: 'Closed', all: 'All' };
const ASSIGNEE = '__assignee';

export function FilterBar() {
  const { data: schema } = useSchema();
  const { data: board } = useBoard();
  const { filters, setFilters } = useUi();
  const [picking, setPicking] = useState<string | null>(null);
  const { data: members } = useMembers(picking === ASSIGNEE || filters.assignees.length > 0);

  if (!schema) return null;
  const fields = selectFields(schema).filter((f) => f.name !== TEAM || filters.team === null);

  const fieldItems = (f: ProjectField): PickerItem[] => [
    { id: '__none', label: `No ${f.name.toLowerCase()}` },
    ...(f.options ?? []).map((o) => ({ id: o.name, label: o.name, color: o.color })),
  ];
  const assigneeItems: PickerItem[] = [
    { id: '__none', label: 'Unassigned', icon: <Avatar person={null} size={16} /> },
    ...(members ?? []).map((m) => ({ id: m.login, label: m.name || m.login, keywords: [m.login], icon: <Avatar person={m} size={16} /> })),
  ];
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const chips: { key: string; label: string; values: string[]; onRemove: () => void; items: PickerItem[]; onToggle: (id: string) => void }[] = [];
  for (const [name, values] of Object.entries(filters.select)) {
    if (!values.length) continue;
    const f = schema.fields.find((x) => x.name === name);
    if (!f) continue;
    chips.push({
      key: name,
      label: name,
      values: values.map((v) => (v === '__none' ? 'none' : v)),
      items: fieldItems(f),
      onToggle: (id) => setFilters((p) => ({ ...p, select: { ...p.select, [name]: toggle(p.select[name] ?? [], id) } })),
      onRemove: () => setFilters((p) => ({ ...p, select: { ...p.select, [name]: [] } })),
    });
  }
  if (filters.assignees.length) {
    chips.push({
      key: ASSIGNEE,
      label: 'Assignee',
      values: filters.assignees.map((a) => (a === '__none' ? 'none' : a)),
      items: assigneeItems,
      onToggle: (id) => setFilters((p) => ({ ...p, assignees: toggle(p.assignees, id) })),
      onRemove: () => setFilters((p) => ({ ...p, assignees: [] })),
    });
  }

  const pickingField = picking && picking !== ASSIGNEE ? fields.find((f) => f.name === picking) : undefined;
  const n = activeFilterCount(filters);
  const closedCount = board?.items.filter((i) => i.state === 'CLOSED').length ?? 0;

  return (
    <div className="filter-bar">
      {chips.map((c) => (
        <span key={c.key} className="chip">
          <span className="k">{c.label}</span>
          <Picker items={c.items} value={c.key === ASSIGNEE ? filters.assignees : filters.select[c.key] ?? []} multiple onSelect={c.onToggle} placeholder={`Filter ${c.label.toLowerCase()}…`}>
            <button>{c.values.length > 2 ? `${c.values.length} selected` : c.values.join(', ')}</button>
          </Picker>
          <button className="x" onClick={c.onRemove} aria-label={`Remove ${c.label} filter`}>
            <X />
          </button>
        </span>
      ))}

      <Picker
        items={pickingField ? fieldItems(pickingField) : assigneeItems}
        value={picking === ASSIGNEE ? filters.assignees : pickingField ? filters.select[pickingField.name] ?? [] : []}
        multiple
        open={picking !== null}
        onOpenChange={(o) => !o && setPicking(null)}
        placeholder={picking === ASSIGNEE ? 'Filter assignee…' : `Filter ${picking?.toLowerCase() ?? ''}…`}
        onSelect={(id) => {
          if (picking === ASSIGNEE) setFilters((p) => ({ ...p, assignees: toggle(p.assignees, id) }));
          else if (pickingField) setFilters((p) => ({ ...p, select: { ...p.select, [pickingField.name]: toggle(p.select[pickingField.name] ?? [], id) } }));
        }}
      >
        <span>
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" variant={n ? 'default' : 'ghost'} icon={<ListFilter />}>
                {n ? `Filter · ${n}` : 'Filter'}
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuLabel>Filter by</MenuLabel>
              {fields.map((f) => (
                <MenuItem key={f.id} onSelect={() => setPicking(f.name)}>
                  {f.name}
                </MenuItem>
              ))}
              <MenuItem onSelect={() => setPicking(ASSIGNEE)}>Assignee</MenuItem>
              <MenuSeparator />
              <MenuLabel>Show</MenuLabel>
              {(['active', 'open', 'closed', 'all'] as StateFilter[]).map((s) => (
                <MenuItem key={s} onSelect={() => setFilters((p) => ({ ...p, state: s }))} hint={s === filters.state ? '✓' : s === 'closed' ? String(closedCount) : undefined}>
                  {STATE_LABEL[s]}
                  {s === 'active' && <span className="faint">(open + recently closed)</span>}
                </MenuItem>
              ))}
              {n > 0 && (
                <>
                  <MenuSeparator />
                  <MenuItem onSelect={() => setFilters((p) => ({ ...p, select: {}, assignees: [], state: 'active' }))}>Clear filters</MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </span>
      </Picker>
    </div>
  );
}
