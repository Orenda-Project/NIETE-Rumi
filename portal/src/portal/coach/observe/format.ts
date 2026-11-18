import type { ObserveCopy } from './copy';
import type { PlanKind } from '../../lib/coachingUpload';

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

/**
 * bd-tymy1n — the part of an observation this phone could not read at Send, from `errorCode`: `unreadable_photo_<n>`
 * (photo n, 1-based), `unreadable_lesson_plan`, `unreadable_audio`. Anything else: null.
 */
export type UnreadablePart = { kind: 'photo'; photo: number } | { kind: 'lesson_plan' } | { kind: 'audio' };
export function unreadablePart(code: string | null | undefined): UnreadablePart | null {
  const m = /^unreadable_(photo_(\d{1,2})|lesson_plan|audio)$/.exec(String(code || ''));
  if (!m) return null;
  if (m[2]) return { kind: 'photo', photo: Number(m[2]) };
  return m[1] === 'audio' ? { kind: 'audio' } : { kind: 'lesson_plan' };
}

/** Which of the failure reasons a send error is, from `errorCode` (SendError's kind, or its reason for a refusal). */
export function failureWords(code: string | null | undefined, words: Pick<ObserveCopy, 'failure'>): string {
  const unread = unreadablePart(code);
  if (unread) {
    if (unread.kind === 'photo') return words.failure.photoUnreadable(unread.photo);
    return unread.kind === 'audio' ? words.failure.recordingUnreadable : words.failure.planUnreadable;
  }
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

const PK_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
});
const pkParts = (d: Date) => {
  const parts = PK_PARTS.formatToParts(d);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: n('year'), mo: n('month'), d: n('day'), h: n('hour'), min: n('minute') };
};

/**
 * bd-brv7rs — when one of her own plans was made, so two plans for the same lesson can be told apart: "Today 8:05 AM",
 * "Yesterday 9:00 PM", else "12 Nov 2:40 PM". The day is Pakistan's calendar day (not a rolling 24 hours) and the
 * clock is Pakistan's, whatever the phone's zone (WhatsApp's twin: bd-4alcjx ownWhen). Empty when there is no time.
 */
export function madeWhen(
  iso: string | null | undefined, words: Pick<ObserveCopy, 'today' | 'yesterday' | 'months'> & { am: string; pm: string }, now: Date = new Date(),
): string {
  const at = new Date(String(iso || ''));
  if (!iso || Number.isNaN(at.getTime())) return '';
  const t = pkParts(at);
  const today = pkParts(now);
  const dayN = (p: { y: number; mo: number; d: number }) => Date.UTC(p.y, p.mo - 1, p.d) / 86_400_000;
  const ago = dayN(today) - dayN(t);
  const day = ago === 0 ? words.today : ago === 1 ? words.yesterday : `${t.d} ${words.months[t.mo - 1]}`;
  const clock = `${t.h % 12 === 0 ? 12 : t.h % 12}:${String(t.min).padStart(2, '0')} ${t.h >= 12 ? words.pm : words.am}`;
  return `${day} ${clock}`;
}

/** "PDF", "Word" or "Photo" for a plan kind; empty when there is none. */
export function planKindLabel(kind: PlanKind | null | undefined, words: Pick<ObserveCopy, 'kindPdf' | 'kindWord' | 'kindPhoto'>): string {
  if (kind === 'pdf') return words.kindPdf;
  if (kind === 'word') return words.kindWord;
  if (kind === 'photo') return words.kindPhoto;
  return '';
}

/** The kind of a plan from the row's `lesson_plan_format` (pdf, docx, doc, jpg, jpeg, png); null for anything else. */
export function planKindOfFormat(format: string | null | undefined): PlanKind | null {
  const f = String(format || '').toLowerCase();
  if (f === 'pdf') return 'pdf';
  if (f === 'docx' || f === 'doc') return 'word';
  if (f === 'jpg' || f === 'jpeg' || f === 'png') return 'photo';
  return null;
}
