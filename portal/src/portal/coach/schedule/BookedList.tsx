import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusChip, TimeStamp } from '../../teacher/ui';
import { useCopy } from '../../teacher/i18n';
import { SCHEDULE } from './copy';
import type { CoachVisit } from '../types';

/**
 * bd-4404s7.3 — "Already booked" on New visit 3: the visits she already has on the picked day, each with WHEN (the kit's
 * TimeStamp), WHO (the teacher) and WHERE (the school). A visit at the time she has picked is the clash: an amber row
 * with a "Clash" chip (Coach_NewVisit3Clash). The list is information, never tappable. The warning that goes with it
 * is `ClashAlert`; it warns and never blocks (operator, 9 Oct).
 */
export function BookedList({ visits, clashIds }: { visits: readonly CoachVisit[]; clashIds: ReadonlySet<string> }) {
  const c = useCopy(SCHEDULE);
  if (visits.length === 0) return null;
  const anyClash = clashIds.size > 0;
  return (
    <>
      <h2 className="mx-1 mt-3 flex items-center gap-2 text-xl font-light">
        {c.alreadyBooked}
        <span data-testid="section-count" className={cn('inline-flex h-6 items-center rounded-full px-[9px] text-xs font-bold', anyClash ? 'bg-[#fef3c7] text-[#b45309]' : 'bg-[#f3f4f6] text-[#374151]')}>{visits.length}</span>
      </h2>
      <section aria-label={c.alreadyBooked} className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        {visits.map((v, i) => {
          const clash = clashIds.has(v.id);
          return (
            <div
              key={v.id}
              data-clash={clash ? '' : undefined}
              className={cn(
                'flex min-h-[60px] items-center gap-3 px-3.5 py-2',
                i > 0 && 'border-t border-[#f0f1f3]',
                clash && 'border-t-2 border-t-[#f59e0b] bg-[#fffbeb]',
              )}
            >
              <span className="min-w-[84px] shrink-0"><TimeStamp time={v.scheduledSlot} tone={clash ? 'overdue' : 'neutral'} size={16} /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{v.teacherName || c.dash}</span>
                {v.schoolName ? <span className="text-[13px] text-[#6b7280] [overflow-wrap:anywhere]">{v.schoolName}</span> : null}
              </span>
              {clash ? <StatusChip text={c.clash} tone="waiting" /> : null}
            </div>
          );
        })}
      </section>
    </>
  );
}

/**
 * "You already have a visit at 8:30 AM" over who, where, and "You can still book it." Amber, role=alert. Schedule stays
 * enabled beside it: a clash warns, it never blocks. `time` is already worded (model.timeWords).
 */
export function ClashAlert({ time, visits }: { time: string; visits: readonly CoachVisit[] }) {
  const c = useCopy(SCHEDULE);
  const who = visits.map((v) => [v.teacherName, v.schoolName].filter(Boolean).join(', ')).filter(Boolean).join(' · ');
  return (
    <div role="alert" data-testid="clash-alert" className="flex items-start gap-3 rounded-2xl border-[1.5px] border-[#f59e0b] bg-[#fef3c7] p-3.5 text-[#b45309]">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
      <span className="min-w-0 text-[15px] font-medium">
        <b className="block text-base font-bold">{c.clashTitle(time)}</b>
        {who ? `${who}. ` : ''}{c.clashStill}
      </span>
    </div>
  );
}
