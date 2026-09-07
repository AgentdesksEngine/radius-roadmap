import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check } from 'lucide-react';
import type { OptionColor } from '@shared/types';
import { Dot } from './Tag';

export interface PickerItem {
  id: string;
  label: string;
  color?: OptionColor;
  icon?: ReactNode;
  hint?: string;
  keywords?: string[];
}

interface Props {
  items: PickerItem[];
  /** Selected id(s). */
  value: string | string[] | null;
  onSelect: (id: string) => void;
  onClear?: () => void;
  clearLabel?: string;
  multiple?: boolean;
  placeholder?: string;
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
  side?: 'top' | 'bottom' | 'left' | 'right';
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  disabled?: boolean;
}

/** Linear-style searchable option picker in a popover. */
export function Picker({ items, value, onSelect, onClear, clearLabel = 'No value', multiple, placeholder = 'Change…', children, align = 'start', side = 'bottom', open, onOpenChange, disabled }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = (o: boolean) => {
    setInternalOpen(o);
    onOpenChange?.(o);
  };
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);

  return (
    <Popover.Root open={isOpen} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop picker" align={align} side={side} sideOffset={6} collisionPadding={8} onOpenAutoFocus={(e) => e.preventDefault()}>
          <Command loop>
            <Command.Input autoFocus placeholder={placeholder} />
            <Command.List>
              <Command.Empty>No matches</Command.Empty>
              {onClear && (
                <Command.Item
                  className="menu-item"
                  value="__clear"
                  keywords={['none', 'clear', 'remove']}
                  onSelect={() => {
                    onClear();
                    if (!multiple) setOpen(false);
                  }}
                >
                  <Dot color={undefined} />
                  <span className="muted">{clearLabel}</span>
                  {selected.size === 0 && <Check className="check" size={14} />}
                </Command.Item>
              )}
              {items.map((it) => (
                <Command.Item
                  key={it.id}
                  className="menu-item"
                  value={it.id}
                  keywords={[it.label, ...(it.keywords ?? [])]}
                  onSelect={() => {
                    onSelect(it.id);
                    if (!multiple) setOpen(false);
                  }}
                >
                  {it.icon ?? (it.color !== undefined ? <Dot color={it.color} /> : null)}
                  <span className="truncate">{it.label}</span>
                  {it.hint && <span className="hint">{it.hint}</span>}
                  {selected.has(it.id) && <Check className="check" size={14} />}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
