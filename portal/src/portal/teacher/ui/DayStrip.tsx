import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBidi } from './bidi';
import type { TeacherUiCopy } from './copy';
import { addDays, dayNumber, monthIndex, weekdayOf, weekOf, yearOf } from './dates';
import { FOCUS, GRID } from './styles';
import { useKitCopy } from './useKitCopy';

/**
 * bd-4404s7.1 — DayStrip: one week of days to pick from (the coach's New visit 3, My schedule, Team schedule). The MONTH is
 * shown above ("October 2026"; a week across two months says "Sep – Oct 2026") between two 56px week arrows (Earlier week,
 * Later week; they swap sides in Urdu). Seven day buttons, Sunday first, each at least 72px tall: the weekday word over the
 * number; the picked day is indigo; Saturday and Sunday are dimmed (still pickable).
 *
 * `value` is the picked day ("YYYY-MM-DD"), `onChange(day)` a tap. The arrows move the SHOWN week without changing the pick
 * (`onWeekChange(firstDayOfWeek)` tells the screen, so it can fetch that week); `week` sets the shown week from outside. Under
 * each day: `counts` a number (the Team week: 38, 0) and/or `dots` up to three dots (open grey, done green). Canvas:
 * Coach_NewVisit3, Coach_MySchedule, Coach_Team.
 */
export interface DayStripProps {
  value: string;
  onChange: (day: string) => void;
  /** Any day inside the week to show; leave out to follow `value`. */
  week?: string;
  onWeekChange?: (firstDay: string) => void;
  counts?: Record<string, number>;
  dots?: Record<string, readonly ('open' | 'done')[]>;
  /** The group's name for a screen reader (default "Day"). */
  label?: string;
  copy?: Partial<Pick<TeacherUiCopy, 'weekdaysShort' | 'monthsLong' | 'earlierWeek' | 'laterWeek'>>;
  className?: string;
}

const ARROW = cn('flex h-14 w-14 shrink-0 items-center justify-center text-[#33374a]', FOCUS);

export function DayStrip({ value, onChange, week, onWeekChange, counts, dots, label, copy, className }: DayStripProps) {
  const words = { ...useKitCopy(), ...copy };
  const bidi = useBidi();
  const [shown, setShown] = useState<string>(week ?? value);
  // a pick from outside (or a new `week`) brings its week into view
  useEffect(() => { setShown(week ?? value); }, [week, value]);
  const days = weekOf(shown);
  const move = (dir: 1 | -1) => {
    const next = addDays(days[0], 7 * dir);
    setShown(next);
    onWeekChange?.(next);
  };
  const first = days[0];
  const last = days[6];
  const month = monthIndex(first) === monthIndex(last)
    ? `${words.monthsLong[monthIndex(first)]} ${yearOf(first)}`
    : yearOf(first) === yearOf(last)
      ? `${words.monthsLong[monthIndex(first)].slice(0, 3)} – ${words.monthsLong[monthIndex(last)].slice(0, 3)} ${yearOf(last)}`
      : `${words.monthsLong[monthIndex(first)].slice(0, 3)} ${yearOf(first)} – ${words.monthsLong[monthIndex(last)].slice(0, 3)} ${yearOf(last)}`;
  return (
    <div role="group" aria-label={label ?? 'Day'} className={cn('overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]', className)}>
      <div className="flex items-center gap-1 px-1 pt-1">
        <button type="button" onClick={() => move(-1)} aria-label={words.earlierWeek} className={ARROW}>
          <ChevronLeft className="h-[22px] w-[22px] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
        </button>
        <b className="flex-1 text-center text-[18px] font-semibold">{bidi(month)}</b>
        <button type="button" onClick={() => move(1)} aria-label={words.laterWeek} className={ARROW}>
          <ChevronRight className="h-[22px] w-[22px] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
      <div className={cn(GRID, 'grid-cols-7 gap-1 px-2 pb-2')}>
        {days.map((day) => {
          const on = day === value;
          const wd = weekdayOf(day);
          const weekend = wd === 0 || wd === 6;
          const word = words.weekdaysShort[wd];
          const count = counts?.[day];
          const marks = dots?.[day]?.slice(0, 3);
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              aria-pressed={on}
              aria-label={`${word} ${dayNumber(day)}${count !== undefined ? `, ${count}` : ''}`}
              onClick={() => onChange(day)}
              className={cn(
                'flex min-h-[72px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl',
                on ? 'bg-[#33374a] text-white' : weekend ? 'text-[#9ca3af]' : 'text-[#1d2025]',
                FOCUS,
              )}
            >
              <small className={cn('max-w-full truncate text-[11px] font-semibold uppercase', on ? 'text-[#c7cad6]' : 'text-[#6b7280]')}>{word}</small>
              <b className="text-[18px] font-bold tabular-nums">{dayNumber(day)}</b>
              {count !== undefined ? <em className={cn('text-[11px] font-bold not-italic tabular-nums', on ? 'text-[#c7cad6]' : 'text-[#6b7280]')}>{count}</em> : null}
              {marks && marks.length ? (
                <i aria-hidden="true" className="flex h-1.5 gap-0.5 not-italic">
                  {marks.map((m, i) => (
                    <u key={i} data-dot={m} className={cn('h-1.5 w-1.5 rounded-full no-underline', m === 'done' ? 'bg-[#48b078]' : 'bg-[#9ca3af]')} />
                  ))}
                </i>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
