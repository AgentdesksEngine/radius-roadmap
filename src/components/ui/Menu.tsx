import * as DM from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;
export const MenuSeparator = () => <DM.Separator className="menu-sep" />;
export const MenuLabel = ({ children }: { children: React.ReactNode }) => <DM.Label className="menu-label">{children}</DM.Label>;

export function MenuContent({ children, ...rest }: ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content className="pop" sideOffset={6} align="start" collisionPadding={8} {...rest}>
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({ children, hint, ...rest }: ComponentProps<typeof DM.Item> & { hint?: string }) {
  return (
    <DM.Item className="menu-item" {...rest}>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </DM.Item>
  );
}
