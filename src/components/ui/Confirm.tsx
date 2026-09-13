import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

/**
 * A held breath before something that would take a while to undo by hand. Used sparingly —
 * anything that can offer an Undo toast instead should do that rather than ask first.
 */
export function Confirm({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} width={420}>
      <p className="confirm-body">{body}</p>
      <div className="confirm-actions">
        <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant={danger ? 'danger' : 'primary'}
          autoFocus
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
