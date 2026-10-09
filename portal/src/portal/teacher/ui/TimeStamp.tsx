import { cn } from '@/lib/utils';
import { useLang } from '../i18n';
import { useKitCopy } from './useKitCopy';

/**
 * bd-4404s7.1 — TimeStamp: the ONE way a time of day is shown (a visit, a slot, a booked time). The time in bold with
 * AM/PM beside it on the same line, smaller: "8:30 AM". Plain text: no box, no tile, no fill. The grade-subject tile
 * is reserved for grade and subject (operator, 9 Oct), so a time never borrows its look.
 *
 * `time` is what the server stores ("14:30") or what the screen already formatted ("8:30 AM"); anything else (a legacy
 * word such as "morning") is shown as it came. AM/PM are the kit's words (`am`, `pm`), so Urdu reads "8:30 صبح".
 * Tones: neutral · next (the coming visit, indigo) · done (green) · overdue (amber). Canvas: TimeStamp board.
 */
export type TimeTone = 'neutral' | 'next' | 'done' | 'overdue';
export type Meridiem = 'AM' | 'PM';

/** "14:30" or "8:30 AM" → the 12-hour clock ("2:30") and its meridiem; null when it is not a time. */
export function parseTime(time: string | null | undefined): { hm: string; meridiem: Meridiem } | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*(am|pm)?\s*$/i.exec(String(time ?? ''));
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2];
  if (h > 23 || Number(min) > 59) return null;
  let meridiem: Meridiem;
  if (m[3]) {
    meridiem = m[3].toUpperCase() as Meridiem;
    if (h < 1 || h > 12) return null;
  } else {
    meridiem = h >= 12 ? 'PM' : 'AM';
    h = h % 12 === 0 ? 12 : h % 12;
  }
  return { hm: `${h}:${min}`, meridiem };
}

const INK: Record<TimeTone, string> = {
  neutral: 'text-[#1d2025]',
  next: 'text-[#33374a]',
  done: 'text-[#2f7a52]',
  overdue: 'text-[#b45309]',
};
const MUTE: Record<TimeTone, string> = {
  neutral: 'text-[#6b7280]',
  next: 'text-[#4b5563]',
  done: 'text-[#2f7a52]',
  overdue: 'text-[#b45309]',
};

export interface TimeStampProps {
  time: string | null | undefined;
  tone?: TimeTone;
  /** px of the time; AM/PM is 72% of it. */
  size?: number;
  className?: string;
}

export function TimeStamp({ time, tone = 'neutral', size = 17, className }: TimeStampProps) {
  const kit = useKitCopy();
  const lang = useLang();
  const parsed = parseTime(time);
  const t: TimeTone = INK[tone] ? tone : 'neutral';
  if (!parsed) {
    return (
      <span data-tone={t} className={cn('whitespace-nowrap font-bold tabular-nums', INK[t], className)} style={{ fontSize: size }}>
        {time == null ? '' : String(time)}
      </span>
    );
  }
  const word = parsed.meridiem === 'AM' ? kit.am : kit.pm;
  return (
    <span
      role="img"
      aria-label={`${parsed.hm} ${parsed.meridiem}`}
      data-tone={t}
      className={cn('inline-flex items-baseline whitespace-nowrap tabular-nums', INK[t], className)}
      style={{ gap: Math.max(2, Math.round(size * 0.22)) }}
    >
      <b dir="ltr" aria-hidden="true" className="font-bold leading-tight tracking-[-0.01em]" style={{ fontSize: size }}>{parsed.hm}</b>
      <span aria-hidden="true" className={cn('font-bold leading-tight tracking-[0.03em]', MUTE[t])} style={{ fontSize: Math.max(lang === 'ur' ? 13 : 10, Math.round(size * 0.72)) }}>{word}</span>
    </span>
  );
}
