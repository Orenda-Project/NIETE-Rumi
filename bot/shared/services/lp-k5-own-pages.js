'use strict';
/**
 * bd-snkn32.17 — the book pages of a grades 1–5 "Make my own". Pure (no I/O).
 *
 * Every day in the K-5 catalogue (data/lp_catalog.json) lists its own book pages (`pages: [3, 4]`). The portal shows
 * them, and she may narrow them, type her own, or extend to the next day's pages. Her range rides in her answers
 * (answers.pages, the JSONB column — no new column) and the rewrite is told to teach those pages.
 *
 * THE CHECK. Whole numbers from 1 to MAX_PAGE, first ≤ last, and no longer than MAX_SPAN pages — or than the day itself
 * when the day is already longer (a few review days cover a whole unit). The day's own pages are "no change" (null).
 */

const MAX_PAGE = 999;
/** Two or three days' pages: enough to extend a day, not enough to make one plan teach a chapter. */
const MAX_SPAN = 10;

/** { start, end } of a catalogue lesson's pages, or null. */
function dayPages(lesson) {
  const list = lesson && Array.isArray(lesson.pages) ? lesson.pages.filter((p) => Number.isInteger(p) && p > 0) : [];
  if (!list.length) return null;
  return { start: Math.min(...list), end: Math.max(...list) };
}

const whole = (v) => {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) ? n : null;
};

/** @returns {{ok:true, pages:{start,end}|null} | {ok:false, error:string}} */
function parseK5Pages(raw, day) {
  if (raw == null) return { ok: true, pages: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'pages must be a first and last page' };
  const start = whole(raw.start);
  const end = whole(raw.end);
  if (start == null || end == null) return { ok: false, error: 'pages must be whole numbers' };
  if (start < 1 || end > MAX_PAGE) return { ok: false, error: `pages must be from 1 to ${MAX_PAGE}` };
  if (start > end) return { ok: false, error: 'pages: the first page is after the last' };
  const daySpan = day ? day.end - day.start + 1 : 0;
  if (end - start + 1 > Math.max(MAX_SPAN, daySpan)) return { ok: false, error: `pages: at most ${MAX_SPAN} pages` };
  if (day && day.start === start && day.end === end) return { ok: true, pages: null };
  return { ok: true, pages: { start, end } };
}

const range = (p) => (p.start === p.end ? `page ${p.start}` : `pages ${p.start}-${p.end}`);

/** The line for the rewrite; '' when she kept the day's pages. */
function pagesLine(pages, day) {
  if (!pages) return '';
  const was = day ? ` (the day's plan was for ${range(day)})` : '';
  return `Book pages: she will teach ${range(pages)} of the book${was}. Teach exactly these pages: `
    + 'every part names the page it uses; drop work on pages outside them, and add work from her new pages where the plan has none, '
    + 'keeping the same learning outcome and the same total minutes. Leave `meta` as it is.';
}

module.exports = { dayPages, parseK5Pages, pagesLine, MAX_SPAN, MAX_PAGE };
