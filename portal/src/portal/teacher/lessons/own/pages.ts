/**
 * bd-snkn32.17 — the book pages of a grades 1–5 "Make my own". Pure (no I/O, no React).
 *
 * The day's own pages come from the list (`pages_label`, "p.3-4"). She may narrow them, type her own or add the next
 * day's. The same check as the bot (bot/shared/services/lp-k5-own-pages.js): whole numbers, first ≤ last, at most
 * MAX_SPAN pages unless the day itself is longer. The bot checks again; this only keeps OK honest.
 */

export type PageRange = { start: number; end: number };

export const MAX_SPAN = 10;
const MAX_PAGE = 999;

const range = (a: number, b: number): PageRange | null =>
  Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b <= MAX_PAGE && a <= b ? { start: a, end: b } : null;

/** "p.3-4", "p.10–13", "p.2" → the range; anything else → null. */
export function parseLabel(label?: string | null): PageRange | null {
  const m = /(\d+)\s*(?:[-–]\s*(\d+))?/.exec(String(label ?? ''));
  if (!m) return null;
  return range(Number(m[1]), Number(m[2] ?? m[1]));
}

/** Her pages in the address ("3-6" or "3"). */
export function parsePg(v: string | null): PageRange | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(v ?? '');
  return m ? range(Number(m[1]), Number(m[2] ?? m[1])) : null;
}

export const fmtPg = (r: PageRange) => (r.start === r.end ? String(r.start) : `${r.start}-${r.end}`);

export const samePages = (a: PageRange | null | undefined, b: PageRange | null | undefined) =>
  !!a && !!b && a.start === b.start && a.end === b.end;

/** What she typed, as a range the bot will take, or null. */
export function checkPages(from: string, to: string, day: PageRange | null): PageRange | null {
  const n = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN);
  const r = range(n(from), n(to));
  if (!r) return null;
  const daySpan = day ? day.end - day.start + 1 : 0;
  return r.end - r.start + 1 <= Math.max(MAX_SPAN, daySpan) ? r : null;
}

/**
 * grades 6–12: what she typed, kept inside the lesson's pages, or running on to exactly the end of the
 * next lesson's (then `both`: she teaches the two lessons, in one period or a double). The bot checks again.
 */
export function checkPages612(
  from: string, to: string, lesson: PageRange | null, next: PageRange | null,
): { range: PageRange; both: boolean } | null {
  const n = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN);
  const r = range(n(from), n(to));
  if (!r || !lesson || r.start < lesson.start || r.start > lesson.end) return null;
  if (r.end <= lesson.end) return { range: r, both: false };
  return next && r.end === next.end ? { range: r, both: true } : null;
}

export type PagesPick = { range: PageRange; both: boolean };

/** One check for every band: 1–5 as the bot's lp-k5-own-pages, 6–12 inside the lesson or through the next. */
export function checkBand(k5: boolean, from: string, to: string, lesson: PageRange | null, next: PageRange | null): PagesPick | null {
  if (!k5) return checkPages612(from, to, lesson, next);
  const r = checkPages(from, to, lesson);
  return r ? { range: r, both: false } : null;
}

/** Her pages ride in the address only when they are not the natural range (the lesson's, or through the next one). */
export function pgToSend(pick: PagesPick | null, lesson: PageRange | null, next: PageRange | null): PageRange | undefined {
  if (!pick || !lesson) return undefined;
  const natural = pick.both && next ? { start: lesson.start, end: next.end } : lesson;
  return samePages(pick.range, natural) ? undefined : pick.range;
}
