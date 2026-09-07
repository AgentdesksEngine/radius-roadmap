import { useEffect, useState } from 'react';
import type { BoardItem, ProjectField } from '@shared/types';
import { useSetField } from '@/api/hooks';
import { Picker } from '@/components/ui/Picker';
import { Dot } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/model/time';
import { SelectCell } from './SelectCell';

/** Property-rail editor for one custom field, dispatching on data type. */
export function FieldEditor({ item, field }: { item: BoardItem; field: ProjectField }) {
  switch (field.dataType) {
    case 'SINGLE_SELECT':
      return <SelectCell item={item} field={field} className="prop-btn" />;
    case 'MULTI_SELECT':
      return <MultiSelectEditor item={item} field={field} />;
    case 'DATE':
      return <DateEditor item={item} field={field} />;
    case 'TEXT':
      return <TextEditor item={item} field={field} />;
    case 'NUMBER':
      return <NumberEditor item={item} field={field} />;
    default:
      return <span className="faint">—</span>;
  }
}

function useWrite(item: BoardItem, field: ProjectField) {
  const setField = useSetField();
  const toast = useToast();
  return (value: Parameters<typeof setField.mutate>[0]['value'], optimistic: Parameters<typeof setField.mutate>[0]['optimistic']) =>
    setField.mutate({ itemId: item.itemId, fieldId: field.id, fieldName: field.name, value, optimistic }, { onError: (e) => toast.error(`Couldn’t update ${field.name.toLowerCase()}: ${e.message}`) });
}

function MultiSelectEditor({ item, field }: { item: BoardItem; field: ProjectField }) {
  const write = useWrite(item, field);
  const v = item.fields[field.name];
  const selected = v?.kind === 'multiSelect' ? v.options.map((o) => o.id) : [];
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    const options = (field.options ?? []).filter((o) => next.includes(o.id)).map((o) => ({ id: o.id, name: o.name }));
    write(next.length ? { multiSelectOptionIds: next } : null, next.length ? { kind: 'multiSelect', options } : null);
  };
  const names = (field.options ?? []).filter((o) => selected.includes(o.id));
  return (
    <Picker items={(field.options ?? []).map((o) => ({ id: o.id, label: o.name, color: o.color }))} value={selected} multiple onSelect={toggle} placeholder={`Set ${field.name.toLowerCase()}…`}>
      <button className={`prop-btn ${names.length ? '' : 'empty'}`}>
        {names.length ? (
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            {names.map((o) => (
              <span key={o.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Dot color={o.color} />
                {o.name}
              </span>
            ))}
          </span>
        ) : (
          <>
            <Dot color={undefined} /> Empty
          </>
        )}
      </button>
    </Picker>
  );
}

function DateEditor({ item, field }: { item: BoardItem; field: ProjectField }) {
  const write = useWrite(item, field);
  const v = item.fields[field.name];
  const date = v?.kind === 'date' ? v.date : '';
  return (
    <span className="date-wrap">
      <span className={`prop-btn ${date ? '' : 'empty'}`}>{date ? formatDate(date) : 'Empty'}</span>
      <input
        type="date"
        aria-label={field.name}
        value={date}
        onChange={(e) => {
          const d = e.target.value;
          write(d ? { date: d } : null, d ? { kind: 'date', date: d } : null);
        }}
      />
    </span>
  );
}

function TextEditor({ item, field }: { item: BoardItem; field: ProjectField }) {
  const write = useWrite(item, field);
  const v = item.fields[field.name];
  const remote = v?.kind === 'text' ? v.text : '';
  const [text, setText] = useState(remote);
  useEffect(() => setText(remote), [remote]);
  const commit = () => {
    const t = text.trim();
    if (t === remote) return;
    write(t ? { text: t } : null, t ? { kind: 'text', text: t } : null);
  };
  const isUrl = /^https?:\/\//.test(remote);
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        className="prop-input"
        value={text}
        placeholder="Empty"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(remote);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {isUrl && (
        <a href={remote} target="_blank" rel="noreferrer" className="faint" style={{ flex: 'none', fontSize: 11 }}>
          Open ↗
        </a>
      )}
    </span>
  );
}

function NumberEditor({ item, field }: { item: BoardItem; field: ProjectField }) {
  const write = useWrite(item, field);
  const v = item.fields[field.name];
  const remote = v?.kind === 'number' ? String(v.number) : '';
  const [text, setText] = useState(remote);
  useEffect(() => setText(remote), [remote]);
  return (
    <input
      type="number"
      className="prop-input"
      value={text}
      placeholder="Empty"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text === remote) return;
        const n = Number(text);
        write(text === '' || Number.isNaN(n) ? null : { number: n }, text === '' || Number.isNaN(n) ? null : { kind: 'number', number: n });
      }}
    />
  );
}
