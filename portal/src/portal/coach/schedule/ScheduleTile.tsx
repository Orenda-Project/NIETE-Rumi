import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { FEATURE_HUE } from '../../teacher/icons';
import { FOCUS } from '../../teacher/ui/styles';

/**
 * bd-4404s7.3 — one big door on the Schedule hub (Coach_Schedule): a 76px round glyph in the Schedule feature's own
 * colour (rose, `FEATURE_HUE.schedule`: a feature colour is only ever its icon), the label, and the screen's status
 * chips under it. A kit gap, listed in the report: COACH.md §1 "glyph tile (inline today)". The three doors (New visit,
 * My schedule, Team schedule) differ by glyph, so they are not the kit's FeatureTile (one D2 art per feature).
 * Put the tiles in a two-column `[display:grid]` (not `grid`: see teacher/ui/styles.ts); `wide` spans both.
 */
export function ScheduleTile({ to, label, icon, chips, wide = false }: { to: string; label: string; icon: ReactNode; chips?: ReactNode; wide?: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-[20px] border border-[#e5e7eb] bg-white px-2.5 py-4 text-center shadow-[0_1px_3px_rgba(16,24,40,0.08)]',
        'transition-colors hover:bg-[#f9fafb] motion-reduce:transition-none',
        FOCUS,
        wide ? 'col-span-2 min-h-[132px]' : 'min-h-[176px]',
      )}
    >
      <span data-testid="hub-icon" aria-hidden="true" className="flex h-[76px] w-[76px] items-center justify-center rounded-full"
        style={{ background: FEATURE_HUE.schedule.bg, color: FEATURE_HUE.schedule.fg }}>{icon}</span>
      <b className="text-[18px] font-semibold leading-tight">{label}</b>
      {chips ? <span className="flex flex-wrap justify-center gap-1.5">{chips}</span> : null}
    </Link>
  );
}
