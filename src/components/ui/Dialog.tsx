import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function Dialog({ open, onOpenChange, title, crumb, children, width }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; crumb?: ReactNode; children: ReactNode; width?: number }) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="dialog-overlay" />
        <RD.Content className="dialog" style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined} aria-describedby={undefined}>
          <div className="dialog-header">
            {crumb}
            <RD.Title asChild>
              <h2>{title}</h2>
            </RD.Title>
            <RD.Close className="icon-btn sm" aria-label="Close">
              <X />
            </RD.Close>
          </div>
          <div className="dialog-body">{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
