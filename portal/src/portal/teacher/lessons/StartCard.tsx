import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CARD, FOCUS } from '../ui/styles';

/**
 * bd-snkn32.39 — one big start card on the Lesson Plans main page (the "+ New lesson plan" card's look, bd-fgj73x):
 * a round glyph, the title, an optional one-line explanation under it, an optional chip, a chevron. Ready-made lesson
 * plans and Make my own each get one, so the two choices read as equals on the first screen.
 */
export function StartCard({ to, glyph, hue, title, hint, chip }: {
  to: string;
  glyph: ReactNode;
  hue: { bg: string; fg: string };
  title: string;
  hint?: string;
  chip?: string;
}) {
  return (
    <Link to={to} className={cn('flex min-h-[112px] items-center gap-4 p-4', CARD, FOCUS)}>
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full" style={{ background: hue.bg, color: hue.fg }}>
        {glyph}
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <b className="text-[20px] font-semibold leading-tight">{title}</b>
        {hint ? <span className="text-[14px] leading-snug text-[#4b5563]">{hint}</span> : null}
        {chip ? (
          <span className="inline-flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-full bg-[#e5e7eb] px-2.5 text-[12px] font-semibold text-[#374151]">
            {chip}
          </span>
        ) : null}
      </span>
      <ChevronRight className="h-6 w-6 shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}
