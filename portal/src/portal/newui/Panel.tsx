import { useId, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS, PRESS } from './styles';

/**
 * bd-5rz1v.26 — a section of CONTENT: a report's feedback, a transcript, a coach's note. The words
 * inside are the Digital Coach's or a coach's, not UI copy, so they stay readable as text. The
 * section itself gets ONE short heading (an icon and 1–3 words) and, when it is long, folds.
 *
 *   Panel  the List card (16px corners, 1.5px line) with a heading row: a 42px neutral tile and
 *          a 15.5px/800 title (a Row's), then the content. Information: nothing looks tappable.
 *   Fold   the same card whose heading row is a 60px button ending in ⌄, which turns when open
 *          (only under motion-safe). Closed, the body is not rendered; aria-expanded and
 *          aria-controls tie the button to it.
 */

const CARD = 'overflow-hidden rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card';
const TILE = 'flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-nu-neutral-tile text-nu-neutral-icon';
const TITLE = 'min-w-0 flex-1 truncate text-start text-[15.5px] font-extrabold text-nu-surface-text rtl:font-bold rtl:leading-[2]';
const BODY = 'px-4 pb-4 text-base leading-relaxed text-nu-surface-text rtl:leading-[2]';

export interface PanelProps {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  testId?: string;
}

export function Panel({ icon: Icon, title, children, testId }: PanelProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid={testId} className={CARD}>
      <div className="flex min-h-[60px] items-center gap-3 px-3 py-2.5">
        <span data-testid="newui-panel-tile" aria-hidden="true" className={TILE}><Icon className="h-[22px] w-[22px]" /></span>
        <h2 id={headingId} className={TITLE}>{title}</h2>
      </div>
      <div className={BODY}>{children}</div>
    </section>
  );
}

export interface FoldProps extends PanelProps {
  /** Open on arrival (a short section that may still be closed). */
  defaultOpen?: boolean;
}

export function Fold({ icon: Icon, title, children, testId, defaultOpen = false }: FoldProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section data-testid={testId} className={CARD}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className={cn('flex min-h-[60px] w-full items-center gap-3 px-3 py-2.5', FOCUS, PRESS)}
      >
        <span aria-hidden="true" className={TILE}><Icon className="h-[22px] w-[22px]" /></span>
        <span className={TITLE}>{title}</span>
        <ChevronDown
          data-fold-chevron
          aria-hidden="true"
          className={cn('h-[22px] w-[22px] shrink-0 text-nu-surface-chevron motion-safe:transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? <div id={bodyId} className={BODY}>{children}</div> : null}
    </section>
  );
}
