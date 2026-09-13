import { useState } from 'react';
import { Archive, ArchiveRestore, ListChecks, X } from 'lucide-react';
import type { BoardItem, FieldWriteValue, ProjectField } from '@shared/types';
import { useArchiveItem, useBoard, useBulkField, useSchema } from '@/api/hooks';
import { Button, IconButton } from '@/components/ui/Button';
import { Confirm } from '@/components/ui/Confirm';
import { Picker } from '@/components/ui/Picker';
import { Dot } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import { PRIORITY, STATUS, TEAM, WORK_TYPE, field } from '@/model/board';
import { PriorityIcon } from '../board/PriorityIcon';
import { useUi } from '../shell/state';
import './bulk.css';

const BULK_FIELDS = [STATUS, TEAM, PRIORITY, WORK_TYPE];
/** Above this many items an archive asks first; below it, the Undo toast is enough. */
const CONFIRM_OVER = 20;

/**
 * Floating action bar for a multi-item selection. Writes go through one bulk request so a
 * 40-issue triage sweep is one round trip, and partial failures are reported rather than
 * rolled back — the issues that did move should stay moved.
 *
 * Every write hands back an Undo, restoring each item's own previous value rather than a
 * single shared one, since a selection rarely started out uniform.
 */
export function BulkBar() {
  const { data: schema } = useSchema();
  const { data: board } = useBoard();
  const { selection, setSelection, visibleIds } = useUi();
  const bulk = useBulkField();
  const archive = useArchiveItem();
  const toast = useToast();
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (!schema || selection.length === 0) return null;

  const items = (board?.items ?? []).filter((i) => selection.includes(i.itemId));
  const unselected = visibleIds.filter((id) => !selection.includes(id));

  const report = (verb: string, failed: { itemId: string }[], undo?: () => void) => {
    if (failed.length) {
      toast.error(`${verb} ${selection.length - failed.length}, ${failed.length} failed`);
    } else {
      toast.success(`${verb} ${selection.length} issue${selection.length === 1 ? '' : 's'}`, {
        action: undo ? { label: 'Undo', undo: true, onClick: undo } : undefined,
      });
    }
    setSelection([]);
  };

  /** Puts every item back to the value it held before the sweep, one call per old value. */
  const undoFor = (f: ProjectField, before: BoardItem[]) => () => {
    const groups = new Map<string, string[]>();
    for (const i of before) {
      const v = i.fields[f.name];
      const key = v?.kind === 'singleSelect' ? v.optionId : '__none';
      groups.set(key, [...(groups.get(key) ?? []), i.itemId]);
    }
    for (const [optionId, itemIds] of groups) {
      const value: FieldWriteValue =
        optionId === '__none' ? null : { singleSelectOptionId: optionId };
      bulk.mutate(
        { itemIds, fieldId: f.id, value },
        { onError: (e) => toast.error(`Couldn’t undo: ${e.message}`) },
      );
    }
  };

  const apply = (f: ProjectField, optionId: string) => {
    const before = items.map((i) => ({ ...i, fields: { ...i.fields } }));
    bulk.mutate(
      { itemIds: selection, fieldId: f.id, value: { singleSelectOptionId: optionId } },
      {
        onSuccess: (r) => report(`Set ${f.name.toLowerCase()} on`, r.failed, undoFor(f, before)),
        onError: (e) => toast.error(`Bulk update failed: ${e.message}`),
      },
    );
  };

  // BULK-02: what the button does follows the selection, not whatever the filter happens to be.
  const archivedCount = items.filter((i) => i.isArchived).length;
  const restoring = archivedCount > items.length / 2;
  const target = !restoring;

  const runArchive = async () => {
    const ids = items.filter((i) => i.isArchived !== target).map((i) => i.itemId);
    const results = await Promise.allSettled(
      ids.map((itemId) => archive.mutateAsync({ itemId, archived: target })),
    );
    const failed = results.filter((r) => r.status === 'rejected').map(() => ({ itemId: '' }));
    report(target ? 'Archived' : 'Restored', failed, () => {
      for (const itemId of ids) archive.mutate({ itemId, archived: !target });
    });
  };

  const fields = BULK_FIELDS.map((n) => field(schema, n)).filter((f): f is ProjectField =>
    Boolean(f?.options),
  );

  return (
    <div className="bulk-bar" role="region" aria-label="Bulk actions">
      <strong>{selection.length} selected</strong>
      {unselected.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          icon={<ListChecks />}
          onClick={() => setSelection((prev) => [...new Set([...prev, ...visibleIds])])}
        >
          Select all {visibleIds.length}
        </Button>
      )}
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
            onSelect={(id) => apply(f, id)}
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
        icon={restoring ? <ArchiveRestore /> : <Archive />}
        disabled={archive.isPending}
        onClick={() =>
          selection.length > CONFIRM_OVER ? setConfirmArchive(true) : void runArchive()
        }
      >
        {restoring ? 'Restore' : 'Archive'}
      </Button>
      {bulk.isPending && <span className="spinner" />}
      <IconButton label="Clear selection" shortcut="Esc" size="sm" onClick={() => setSelection([])}>
        <X />
      </IconButton>

      <Confirm
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={restoring ? 'Restore these issues?' : 'Archive these issues?'}
        body={
          restoring
            ? `${selection.length} issues will come back onto the board.`
            : `${selection.length} issues will come off the board. You can undo this, or restore them from the Archived view.`
        }
        confirmLabel={restoring ? `Restore ${selection.length}` : `Archive ${selection.length}`}
        onConfirm={() => void runArchive()}
      />
    </div>
  );
}
