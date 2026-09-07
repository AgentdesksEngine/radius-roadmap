import { Archive, ArchiveRestore, X } from 'lucide-react';
import { useArchiveItem, useBulkField, useSchema } from '@/api/hooks';
import { Button, IconButton } from '@/components/ui/Button';
import { Picker } from '@/components/ui/Picker';
import { Dot } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { PRIORITY, STATUS, TEAM, WORK_TYPE, field } from '@/model/board';
import { PriorityIcon } from '../board/PriorityIcon';
import { useUi } from '../shell/state';
import './bulk.css';

const BULK_FIELDS = [STATUS, TEAM, PRIORITY, WORK_TYPE];

/**
 * Floating action bar for a multi-item selection. Writes go through one bulk request so a
 * 40-issue triage sweep is one round trip, and partial failures are reported rather than
 * rolled back — the issues that did move should stay moved.
 */
export function BulkBar() {
  const { data: schema } = useSchema();
  const { selection, setSelection, filters } = useUi();
  const bulk = useBulkField();
  const archive = useArchiveItem();
  const toast = useToast();

  if (!schema || selection.length === 0) return null;

  const report = (verb: string, failed: { itemId: string }[]) => {
    if (failed.length)
      toast.error(`${verb} ${selection.length - failed.length}, ${failed.length} failed`);
    else toast.success(`${verb} ${selection.length} issue${selection.length === 1 ? '' : 's'}`);
    setSelection([]);
  };

  const apply = (fieldId: string, optionId: string, label: string) =>
    bulk.mutate(
      { itemIds: selection, fieldId, value: { singleSelectOptionId: optionId } },
      {
        onSuccess: (r) => report(`Set ${label} on`, r.failed),
        onError: (e) => toast.error(`Bulk update failed: ${e.message}`),
      },
    );

  const archiveAll = async () => {
    const target = !filters.archived;
    const results = await Promise.allSettled(
      selection.map((itemId) => archive.mutateAsync({ itemId, archived: target })),
    );
    report(
      target ? 'Archived' : 'Restored',
      results.filter((r) => r.status === 'rejected').map(() => ({ itemId: '' })),
    );
  };

  const fields = BULK_FIELDS.map((n) => field(schema, n)).filter((f): f is NonNullable<typeof f> =>
    Boolean(f?.options),
  );

  return (
    <div className="bulk-bar" role="region" aria-label="Bulk actions">
      <strong>{selection.length} selected</strong>
      {fields.map((f) => {
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
            value={null}
            onSelect={(id) => apply(f.id, id, f.name.toLowerCase())}
            placeholder={`Set ${f.name.toLowerCase()}…`}
          >
            <Button
              size="sm"
              variant="ghost"
              icon={isPrio ? <PriorityIcon /> : <Dot color={undefined} />}
              disabled={bulk.isPending}
            >
              {f.name}
            </Button>
          </Picker>
        );
      })}
      <Button
        size="sm"
        variant="ghost"
        icon={filters.archived ? <ArchiveRestore /> : <Archive />}
        disabled={archive.isPending}
        onClick={archiveAll}
      >
        {filters.archived ? 'Restore' : 'Archive'}
      </Button>
      {bulk.isPending && <span className="spinner" />}
      <IconButton label="Clear selection" shortcut="Esc" size="sm" onClick={() => setSelection([])}>
        <X />
      </IconButton>
    </div>
  );
}
