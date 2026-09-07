import type { ReactNode } from 'react';
import type { OptionColor } from '@shared/types';
import { colorVar } from '@/model/board';

export function Dot({ color, size = 8 }: { color: OptionColor | undefined; size?: number }) {
  return <span className="dot" style={{ background: colorVar(color), width: size, height: size }} />;
}

export function Tag({ color, children, plain, title }: { color?: OptionColor; children: ReactNode; plain?: boolean; title?: string }) {
  return (
    <span className={`tag ${plain ? 'plain' : ''}`} title={title}>
      {color && <Dot color={color} />}
      <span className="truncate">{children}</span>
    </span>
  );
}
