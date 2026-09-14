import type { BoardItem, ProjectField } from '@shared/types';
import { useSetField } from '@/api/hooks';
import { Picker } from '@/components/ui/Picker';
import { Dot } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { PRIORITY } from '@/model/board';
import { PriorityIcon } from '../board/PriorityIcon';

/** Inline select editor rendered as a quiet button. Handles single- and multi-valued fields. */
export function SelectCell({
  item,
  field,
  className = 'cell-btn',
  iconOnly,
}: {
  item: BoardItem;
  field: ProjectField;
  className?: string;
  iconOnly?: boolean;
}) {
  const setField = useSetField();
  const toast = useToast();
  const multi = field.dataType === 'MULTI_SELECT';
  const v = item.fields[field.name];
  const selectedIds = multi
    ? v?.kind === 'multiSelect'
      ? v.options.map((o) => o.id)
      : []
    : v?.kind === 'singleSelect'
      ? [v.optionId]
      : [];
  const selected = (field.options ?? []).filter((o) => selectedIds.includes(o.id));
  const current = selected[0];
  const isPriority = field.name === PRIORITY;

  const write = (
    value: Parameters<typeof setField.mutate>[0]['value'],
    optimistic: Parameters<typeof setField.mutate>[0]['optimistic'],
  ) =>
    setField.mutate(
      { itemId: item.itemId, fieldId: field.id, fieldName: field.name, value, optimistic },
      { onError: (e) => toast.error(`Couldn’t update ${field.name.toLowerCase()}: ${e.message}`) },
    );

  const onSelect = (id: string) => {
    if (!multi) {
      const o = field.options?.find((x) => x.id === id);
      if (!o) return;
      write({ singleSelectOptionId: id }, { kind: 'singleSelect', optionId: id, name: o.name });
      return;
    }
    // Multi-valued: the picker toggles one option at a time.
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    const options = (field.options ?? [])
      .filter((o) => next.includes(o.id))
      .map((o) => ({ id: o.id, name: o.name }));
    write(
      next.length ? { multiSelectOptionIds: next } : null,
      next.length ? { kind: 'multiSelect', options } : null,
    );
  };

  return (
    <Picker
      items={(field.options ?? []).map((o) => ({
        id: o.id,
        label: o.name,
        color: isPriority ? undefined : o.color,
        icon: isPriority ? <PriorityIcon name={o.name} /> : undefined,
      }))}
      value={multi ? selectedIds : (current?.id ?? null)}
      multiple={multi}
      placeholder={`Set ${field.name.toLowerCase()}…`}
      onClear={() =>
        setField.mutate(
          {
            itemId: item.itemId,
            fieldId: field.id,
            fieldName: field.name,
            value: null,
            optimistic: null,
          },
          { onError: (e) => toast.error(e.message) },
        )
      }
      clearLabel={`No ${field.name.toLowerCase()}`}
      onSelect={onSelect}
    >
      <button
        className={`${className} ${current ? '' : 'empty'}`}
        onClick={(e) => e.stopPropagation()}
        title={field.name}
      >
        {isPriority ? (
          <PriorityIcon name={current?.name} />
        ) : selected.length > 1 ? (
          <span className="dot-stack">
            {selected.map((o) => (
              <Dot key={o.id} color={o.color} />
            ))}
          </span>
        ) : (
          <Dot color={current?.color} />
        )}
        {!iconOnly && (
          <span className="truncate">
            {selected.length
              ? selected.map((o) => o.name).join(', ')
              : isPriority
                ? 'No priority'
                : `No ${field.name.toLowerCase()}`}
          </span>
        )}
      </button>
    </Picker>
  );
}
