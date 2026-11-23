import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { FOCUS, LIST_CARD } from './styles';

/**
 * ActionStrip — one slim row of 1–3 equal action cells (the plan screen's Observe · Answer key · Download). Each cell is
 * the 56px target: a neutral 20px icon over its word (16px/600). The row is min 56px and grows in Urdu under
 * `rtl:leading-[1.8]` (never clips); dividers sit on each cell's start edge, so the row mirrors. A missing cell leaves the
 * others sharing the row; no cells → nothing drawn.
 *
 *   to / onPress  a link or a button
 *   spoken        its accessible name when the word alone is not it ("Start DC observation" for Observe)
 *   state         a state word that replaces the word after a press (Opening… / Paste in browser), announced
 */
export interface ActionStripItem {
  key: string;
  icon: LucideIcon;
  label: string;
  spoken?: string;
  to?: string;
  onPress?: () => void;
  state?: string | null;
}

export interface ActionStripProps {
  items: readonly ActionStripItem[];
  className?: string;
  testId?: string;
}

const CELL = 'flex min-h-[56px] min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 px-2 py-1.5 text-center text-[#33374a] active:bg-[#f4f5f8]';

export function ActionStrip({ items, className, testId }: ActionStripProps) {
  if (!items.length) return null;
  return (
    <div data-testid={testId ?? 'action-strip'} className={cn(LIST_CARD, 'flex min-h-[56px] w-full items-stretch', className)}>
      {items.map((it, i) => {
        const Icon = it.icon;
        const body = (
          <>
            <Icon className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
            <span data-word aria-live="polite" className="text-[16px] font-semibold leading-tight rtl:leading-[1.8]">
              {it.state || it.label}
            </span>
          </>
        );
        const common = {
          'data-testid': `action-strip-${it.key}`,
          'aria-label': it.state ? undefined : it.spoken,
          className: cn(CELL, i > 0 && 'border-s border-[#f0f1f3]', FOCUS),
        };
        return it.to
          ? <Link key={it.key} to={it.to} {...common}>{body}</Link>
          : <button key={it.key} type="button" onClick={it.onPress} {...common}>{body}</button>;
      })}
    </div>
  );
}
