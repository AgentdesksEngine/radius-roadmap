import type { BoardItem, ProjectField } from '@shared/types';
import { useSetField } from '@/api/hooks';
import { Picker } from '@/components/ui/Picker';
import { Dot } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { PRIORITY } from '@/model/board';
import { PriorityIcon } from '../board/PriorityIcon';

/** Inline single-select editor rendered as a quiet button. */
export function SelectCell({ item, field, className = 'cell-btn', iconOnly }: { item: BoardItem; field: ProjectField; className?: string; iconOnly?: boolean }) {
  const setField = useSetField();
  const toast = useToast();
  const v = item.fields[field.name];
  const current = v?.kind === 'singleSelect' ? field.options?.find((o) => o.id === v.optionId) : undefined;
  const isPriority = field.name === PRIORITY;

  return (
    <Picker
      items={(field.options ?? []).map((o) => ({ id: o.id, label: o.name, color: isPriority ? undefined : o.color, icon: isPriority ? <PriorityIcon name={o.name} /> : undefined }))}
      value={current?.id ?? null}
      placeholder={`Set ${field.name.toLowerCase()}…`}
      onClear={() =>
        setField.mutate({ itemId: item.itemId, fieldId: field.id, fieldName: field.name, value: null, optimistic: null }, { onError: (e) => toast.error(e.message) })
      }
      clearLabel={`No ${field.name.toLowerCase()}`}
      onSelect={(id) => {
        const o = field.options?.find((x) => x.id === id);
        if (!o) return;
        setField.mutate(
          { itemId: item.itemId, fieldId: field.id, fieldName: field.name, value: { singleSelectOptionId: id }, optimistic: { kind: 'singleSelect', optionId: id, name: o.name } },
          { onError: (e) => toast.error(`Couldn’t update ${field.name.toLowerCase()}: ${e.message}`) },
        );
      }}
    >
      <button className={`${className} ${current ? '' : 'empty'}`} onClick={(e) => e.stopPropagation()} title={field.name}>
        {isPriority ? <PriorityIcon name={current?.name} /> : <Dot color={current?.color} />}
        {!iconOnly && <span className="truncate">{current?.name ?? (isPriority ? 'No priority' : `No ${field.name.toLowerCase()}`)}</span>}
      </button>
    </Picker>
  );
}
