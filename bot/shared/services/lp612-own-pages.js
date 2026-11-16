'use strict';
/**
 * (unified spec item 14) — her own book pages for a grades 6–12 "Make my own". Pure (no I/O).
 *
 * THE CHECK (the portal's checkPages612): the first page is inside her lesson; the last is inside it too, or — only when
 * she joined the next lesson (answers.extend) — exactly the next lesson's last page. The natural range (her lesson's,
 * or her lesson's first through the next one's last when joined) is "no change" (null). Her range rides in her answers
 * (answers.pages, the JSONB column), as for grades 1–5.
 */

const whole = (v) => {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) ? n : null;
};
const bad = (error) => ({ ok: false, error });

/** { start, end } of a catalogue segment row's printed pages, or null. */
function segPages(seg) {
  const start = seg && whole(seg.printed_page_start);
  const end = seg && whole(seg.printed_page_end);
  return start != null && end != null ? { start, end } : null;
}

/**
 * @param raw   her answers.pages
 * @param lesson { start, end } of her lesson
 * @param next  { start, end } of the next lesson when she joined it, else null
 * @returns {{ok:true, pages:{start,end}|null} | {ok:false, error:string}}
 */
function parse612Pages(raw, lesson, next) {
  if (raw == null) return { ok: true, pages: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return bad('pages must be a first and last page');
  if (!lesson) return bad('pages: this lesson has no book pages');
  const start = whole(raw.start);
  const end = whole(raw.end);
  if (start == null || end == null) return bad('pages must be whole numbers');
  if (start > end) return bad('pages: the first page is after the last');
  if (start < lesson.start || start > lesson.end) return bad('pages: the first page must be in this lesson');
  if (next) {
    if (end !== next.end) return bad('pages: a joined plan runs to the next lesson\'s last page');
    return { ok: true, pages: start === lesson.start ? null : { start, end } };
  }
  if (end > lesson.end) return bad('pages: the last page must be in this lesson (add the next lesson to go further)');
  return { ok: true, pages: start === lesson.start && end === lesson.end ? null : { start, end } };
}

const range = (p) => (p.start === p.end ? `page ${p.start}` : `pages ${p.start}-${p.end}`);

/** The line for the rewrite; '' when she kept the lesson's pages. */
function pagesLine612(pages) {
  if (!pages) return '';
  return `Book pages: she will teach ${range(pages)} of the book. Teach exactly these pages: every part names the page it `
    + 'uses; drop work on pages outside them, and keep the same learning outcomes and the same total minutes.';
}

/** The pages whose text feeds the rewrite: hers when set, else the segment's. */
function bookRange(answers, seg) {
  const p = answers && answers.pages;
  return p ? { from: p.start, to: p.end } : { from: seg.printed_page_start, to: seg.printed_page_end };
}

/** Load the rows the check needs (only when she sent pages) and run it. `d` has loadSegment and chapterSegments. */
async function check612Pages(d, { segmentId, pages, extend }) {
  if (pages == null) return { ok: true, pages: null };
  const seg = await d.loadSegment(segmentId);
  const rows = extend && seg ? await d.chapterSegments(seg) : [];
  const next = extend ? segPages(rows.find((r) => r.segment_id === extend.next)) : null;
  if (extend && !next) return bad('pages: the next lesson has no book pages');
  return parse612Pages(pages, segPages(seg), next);
}

module.exports = { parse612Pages, pagesLine612, bookRange, segPages, check612Pages };
