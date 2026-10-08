import { LESSONS_V2_COPY } from './copy';

/**
 * bd-fmf24g.3 — Pakistan days for the Lesson Plans lists (Recent, All lesson plans): which day an
 * instant falls on in Pakistan (UTC+5 all year), and how a day is named — Today, Yesterday, "Mon 5 Oct".
 */

const PK_MS = 5 * 3_600_000;

/** Pakistan's today, YYYY-MM-DD. */
export function pkToday(now: number = Date.now()): string {
  return new Date(now + PK_MS).toISOString().slice(0, 10);
}

/** The Pakistan day an ISO instant falls on, or null. */
export function pkDayOf(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? pkToday(t) : null;
}

const parse = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/** Today · Yesterday · "Mon 5 Oct". */
export function dayName(ymd: string, today: string): string {
  const D = LESSONS_V2_COPY.days;
  const gap = Math.round((parse(today).getTime() - parse(ymd).getTime()) / 86_400_000);
  if (gap === 0) return D.today;
  if (gap === 1) return D.yesterday;
  const d = parse(ymd);
  return D.date(d.getUTCDay(), d.getUTCDate(), d.getUTCMonth());
}
