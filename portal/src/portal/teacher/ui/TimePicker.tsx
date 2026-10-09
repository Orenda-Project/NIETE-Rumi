import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TeacherUiCopy } from './copy';
import { FOCUS, GRID } from './styles';
import { TimeStamp, parseTime, type TimeTone } from './TimeStamp';
import { useKitCopy } from './useKitCopy';

/**
 * bd-4404s7.1 — TimePicker: a 12-hour time on half hours, with AM/PM (the coach's New visit 3; the teacher side has no time
 * input). A big readout (TimeStamp, 44px) and an optional `caption` under it (the day, "Wednesday 7 October"), then three
 * columns, all 56px or more: Hour (a stepper, Earlier / Later, 30px number), Minutes (:00 or :30) and AM / PM.
 *
 * `value` is the 24-hour "HH:MM" the server stores; `onChange("HH:MM")`. The hours go 7 8 9 10 11 12 1 2 3 4 5 6 and wrap;
 * stepping or tapping an hour also picks its usual AM/PM (7–11 AM, 12–6 PM) so she never books a 3 AM visit by accident, and
 * she can still flip AM/PM herself. A time that is not on the half hour (an old visit) is shown as it is. Canvas: Coach_NewVisit3.
 */
export interface TimePickerProps {
  value: string;
  onChange: (hhmm: string) => void;
  caption?: string;
  /** The readout's tone: `overdue` (amber) for a pick that clashes, `next`, `done`; default `neutral`. */
  tone?: TimeTone;
  copy?: Partial<Pick<TeacherUiCopy, 'hour' | 'minutes' | 'meridiem' | 'earlierHour' | 'laterHour' | 'am' | 'pm'>>;
  className?: string;
}

/** The hour wheel as the coach reads a clock: 7 … 12, 1 … 6. */
export const PICKER_HOURS: readonly number[] = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];

const to24 = (hour12: number, pm: boolean): number => (hour12 % 12) + (pm ? 12 : 0);
const defaultPm = (hour12: number): boolean => !(hour12 >= 7 && hour12 <= 11);
const hhmm = (h24: number, m: number): string => `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

const COL_BTN = 'flex min-h-[56px] w-full items-center justify-center rounded-[14px] bg-[#f3f4f6] text-[#33374a]';
const CHOICE = 'flex min-h-[56px] items-center justify-center rounded-[14px] border text-[20px] font-bold';

export function TimePicker({ value, onChange, caption, tone, copy, className }: TimePickerProps) {
  const words = { ...useKitCopy(), ...copy };
  const t = parseTime(value);
  const h24 = t ? Number(value.split(':')[0]) : 9;
  const minute = t ? Number(value.split(':')[1]) : 0;
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const pm = h24 >= 12;
  const step = (dir: 1 | -1) => {
    const at = PICKER_HOURS.indexOf(hour12);
    const next = PICKER_HOURS[(((at < 0 ? 2 : at) + dir) + PICKER_HOURS.length) % PICKER_HOURS.length];
    onChange(hhmm(to24(next, defaultPm(next)), minute));
  };
  const setMinute = (m: number) => onChange(hhmm(h24, m));
  const setMeridiem = (toPm: boolean) => onChange(hhmm(to24(hour12, toPm), minute));
  const mins = [0, 30];
  return (
    <section className={cn('flex flex-col gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.05)]', className)}>
      <div className="flex justify-center"><TimeStamp time={value} size={44} tone={tone} /></div>
      {caption ? <p className="m-0 text-center text-[15px] font-semibold text-[#4b5563]">{caption}</p> : null}
      <div className={cn(GRID, 'grid-cols-3 gap-2.5')}>
        <div className="flex flex-col items-stretch gap-1.5">
          <small className="text-center text-[12px] font-semibold text-[#6b7280]">{words.hour}</small>
          <button type="button" onClick={() => step(-1)} aria-label={words.earlierHour} className={cn(COL_BTN, FOCUS)}>
            <ChevronUp className="h-[22px] w-[22px]" strokeWidth={2.4} aria-hidden="true" />
          </button>
          <span className="flex min-h-[56px] items-center justify-center text-[30px] font-bold tabular-nums" aria-live="polite">{hour12}</span>
          <button type="button" onClick={() => step(1)} aria-label={words.laterHour} className={cn(COL_BTN, FOCUS)}>
            <ChevronDown className="h-[22px] w-[22px]" strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
        <div role="radiogroup" aria-label={words.minutes} className="flex flex-col items-stretch gap-1.5">
          <small className="text-center text-[12px] font-semibold text-[#6b7280]">{words.minutes}</small>
          {mins.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={minute === m}
              aria-label={`:${String(m).padStart(2, '0')}`}
              onClick={() => setMinute(m)}
              className={cn(CHOICE, 'min-h-[81px]', minute === m ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#e5e7eb] bg-white', FOCUS)}
            >
              <span dir="ltr">{`:${String(m).padStart(2, '0')}`}</span>
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label={words.meridiem} className="flex flex-col items-stretch gap-1.5">
          <small className="text-center text-[12px] font-semibold text-[#6b7280]">{words.meridiem}</small>
          {([false, true] as const).map((isPm) => (
            <button
              key={String(isPm)}
              type="button"
              role="radio"
              aria-checked={pm === isPm}
              onClick={() => setMeridiem(isPm)}
              className={cn(CHOICE, 'min-h-[81px]', pm === isPm ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#e5e7eb] bg-white', FOCUS)}
            >
              {isPm ? words.pm : words.am}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
