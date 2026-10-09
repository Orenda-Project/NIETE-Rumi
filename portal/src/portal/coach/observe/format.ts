import type { ObserveCopy } from './copy';

/**
 * bd-4404s7.4 — small helpers for what the Observe screens say about a visit and a recording. They take the words
 * (`useCopy(OBSERVE)`) so they follow her language; the DATA (a day, a length) is passed in as it came.
 */

/** "Tue 6 Oct" from "2026-10-06"; empty when the day is missing or not a day. Western digits, as the bot. */
export function dayShort(day: string | null | undefined, words: Pick<ObserveCopy, 'weekdays' | 'months'>): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${words.weekdays[weekday]} ${d} ${words.months[mo - 1]}`;
}

/** "38 min", or "Under 1 min" for a short one; empty when the length is not known (never a made-up length). */
export function lengthShort(ms: number | null | undefined, words: Pick<ObserveCopy, 'minShort' | 'underMinute'>): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '';
  if (ms < 60_000) return words.underMinute;
  return words.minShort(Math.round(ms / 60_000));
}

/** "Tue 6 Oct · 38 min" — the day of the visit and the length of the recording, whichever of them is known. */
export function observationLine(
  day: string | null | undefined, ms: number | null | undefined, words: Pick<ObserveCopy, 'weekdays' | 'months' | 'minShort' | 'underMinute'>,
): string {
  return [dayShort(day, words), lengthShort(ms, words)].filter(Boolean).join(' · ');
}

/** Which of the failure reasons a send error is, from `errorCode` (SendError's kind, or its reason for a refusal). */
export function failureWords(code: string | null | undefined, words: Pick<ObserveCopy, 'failure'>): string {
  if (code === 'network') return words.failure.network;
  if (code === 'plan_not_ready' || code === 'plan_not_found') return words.failure.plan;
  if (code === 'not_your_teacher') return words.failure.notYourTeacher;
  return words.failure.refused;
}

/** "63%" for a score the API gave; "—" when there is none (never a made-up number). Western digits, as the bot. */
export function pct(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : `${Math.round(n * 10) / 10}%`;
}

/** "5d" days since — a short count the API gave; "—" when it has none. */
export function daysShort(d: number | null | undefined): string {
  return d == null ? '—' : `${d}d`;
}

/** "30 Sep" — a day and month, for "Last visit · 30 Sep". */
export function dayMonth(day: string | null | undefined, words: Pick<ObserveCopy, 'months'>): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  return m ? `${Number(m[3])} ${words.months[Number(m[2]) - 1]}` : '';
}
