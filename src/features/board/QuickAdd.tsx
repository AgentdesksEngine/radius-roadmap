import { useEffect, useRef, useState } from 'react';
import type { FieldWriteValue, ProjectField } from '@shared/types';
import { useCreateIssue, useSchema } from '@/api/hooks';
import { useToast } from '@/components/ui/Toast';
import { STATUS, TEAM, field } from '@/model/board';
import { useUi } from '../shell/state';

interface Props {
  /** The column's field and option, pre-applied to whatever gets created here. */
  groupField: ProjectField | undefined;
  optionId: string | undefined;
  onClose: () => void;
}

/**
 * Inline "type a title, press Enter" create at the foot of a column. The column's own
 * grouping value is filled in for free, which is the whole reason to do it here instead
 * of in the full dialog.
 */
export function QuickAdd({ groupField, optionId, onClose }: Props) {
  const { data: schema } = useSchema();
  const { filters } = useUi();
  const create = useCreateIssue();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => ref.current?.focus(), []);

  const submit = (keepOpen: boolean) => {
    const t = title.trim();
    if (!t || create.isPending) return;

    const fields: Record<string, FieldWriteValue> = {};
    if (groupField && optionId) fields[groupField.name] = { singleSelectOptionId: optionId };

    const statusField = field(schema, STATUS);
    if (statusField && !fields[statusField.name]) {
      const todo =
        statusField.options?.find((o) => o.name.toLowerCase() === 'todo') ??
        statusField.options?.[0];
      if (todo) fields[statusField.name] = { singleSelectOptionId: todo.id };
    }
    const teamField = field(schema, TEAM);
    const teamOption = teamField?.options?.find((o) => o.name === filters.team);
    if (teamField && teamOption && !fields[teamField.name])
      fields[teamField.name] = { singleSelectOptionId: teamOption.id };

    create.mutate(
      { title: t, fields },
      {
        onSuccess: (item) => {
          setTitle('');
          toast.success(`Created ${item.key}`);
          if (!keepOpen) onClose();
          else ref.current?.focus();
        },
        onError: (e) => toast.error(`Couldn’t create issue: ${e.message}`),
      },
    );
  };

  return (
    <div className="quick-add">
      <textarea
        ref={ref}
        rows={2}
        value={title}
        placeholder="Issue title…"
        disabled={create.isPending}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && onClose()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit(e.metaKey || e.ctrlKey);
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="faint">↵ to create · ⌘↵ to create and keep going · Esc to cancel</span>
    </div>
  );
}
