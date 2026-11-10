/**
 * bd-snkn32.14 — "Make my own", grades 6–12: "Add the next lesson's pages".
 *
 * A teacher joins her lesson with the NEXT lesson of the SAME chapter, in one of two shapes:
 *   one_period — the class is behind and must cover both in one period: the two plans compressed into one period;
 *   double     — a two-period block: both plans at two periods' length.
 *
 * It rides on her answers (`answers.extend = { next, shape }`, the row's JSONB), so no column and no table. The rewrite
 * is the same edit lane: the FIRST lesson's stored plan is the document, the joined segment (both page ranges, the
 * period length) is what page-truth and the prompt are built from, and the NEXT lesson's stored plan is quoted in the
 * instruction. "Next" is the book's own order (order_index) inside one book and chapter, never a guess.
 *
 * Pure: no I/O.
 */

const PERIOD_MINUTES = 40;

const SHAPES = {
  one_period: (m) => `ONE period of ${m} minutes. The class is behind: cover BOTH lessons' pages in this one period. `
    + 'Keep the core of each lesson and its quick checks; cut repetition and extras, not pages.',
  double: (m) => `TWO periods back to back, ${2 * m} minutes in all. Teach BOTH lessons' pages in order, `
    + 'with a short recap between the two parts.',
};

const ID_MAX = 200;

function bad(error) {
  return { ok: false, error };
}

/** `answers.extend` → { next, shape } or null (none asked for). */
function parseExtend(raw) {
  if (raw == null) return { ok: true, extend: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return bad('extend must be an object');
  const next = typeof raw.next === 'string' ? raw.next.trim() : '';
  if (!next || next.length > ID_MAX) return bad('extend.next is required');
  if (!Object.prototype.hasOwnProperty.call(SHAPES, raw.shape)) return bad('extend.shape is not one of the choices');
  return { ok: true, extend: { next, shape: raw.shape } };
}

const sameChapter = (a, b) => !!a && !!b && a.book_stem === b.book_stem && a.chapter_key === b.chapter_key;

/** The lesson right after `first` in its book and chapter (by the book's order), or null on the chapter's last. */
function nextInChapter(first, rows) {
  if (!first || !Array.isArray(rows)) return null;
  let best = null;
  for (const r of rows) {
    if (!sameChapter(first, r) || r.segment_id === first.segment_id) continue;
    if (!(r.order_index > first.order_index)) continue;
    if (!best || r.order_index < best.order_index) best = r;
  }
  return best;
}

/** Is `nextId` the adjacent next lesson of `first`? */
function isAdjacentNext(first, nextId, rows) {
  const n = nextInChapter(first, rows);
  return !!n && n.segment_id === nextId;
}

function pagesOf(s) {
  if (Array.isArray(s.pages_covered) && s.pages_covered.length) return s.pages_covered;
  const out = [];
  if (!Number.isInteger(s.printed_page_start)) return out;
  const end = Number.isInteger(s.printed_page_end) ? s.printed_page_end : s.printed_page_start;
  for (let p = s.printed_page_start; p <= end; p++) out.push(p);
  return out;
}

const union = (a, b) => [...new Set([...(a || []), ...(b || [])])];

/** The segment the rewrite is built from: her lesson's id, both page ranges, the period by shape. */
function joinSegments(first, next, shape) {
  const minutes = first.period_minutes || PERIOD_MINUTES;
  return {
    ...first,
    printed_page_start: Math.min(first.printed_page_start, next.printed_page_start),
    printed_page_end: Math.max(first.printed_page_end, next.printed_page_end),
    pages_covered: union(pagesOf(first), pagesOf(next)).sort((x, y) => x - y),
    subtopic_title: `${first.subtopic_title} + ${next.subtopic_title}`,
    menu_title: `${first.menu_title} + ${next.menu_title}`,
    slo_codes: union(first.slo_codes, next.slo_codes),
    slo_descriptions: union(first.slo_descriptions, next.slo_descriptions),
    next_segment_id: next.next_segment_id || null,
    period_minutes: shape === 'double' ? 2 * minutes : minutes,
  };
}

const range = (s) => (s.printed_page_start === s.printed_page_end
  ? `page ${s.printed_page_start}` : `pages ${s.printed_page_start}-${s.printed_page_end}`);

/** Added to her instruction. Overrides the "same pages and length" line of the ordinary rewrite. */
function buildExtendInstruction({ first, next, nextDoc, shape }) {
  if (!SHAPES[shape]) throw new Error('buildExtendInstruction needs a shape from parseExtend');
  const minutes = first.period_minutes || PERIOD_MINUTES;
  return [
    'ADD THE NEXT LESSON\'S PAGES (this replaces "same pages, same length" above):',
    `This plan now covers TWO lessons of the same chapter: this lesson (${range(first)}, "${first.subtopic_title}") `
      + `and the next lesson (${range(next)}, "${next.subtopic_title}").`,
    `Timing: ${SHAPES[shape](minutes)}`,
    'Every part still names the book page it uses, from either range. Learning outcomes come from both lessons.',
    `The next lesson's stored plan, to join with this one: ${JSON.stringify(nextDoc || {})}`,
  ].join('\n');
}

module.exports = {
  parseExtend, nextInChapter, isAdjacentNext, joinSegments, buildExtendInstruction, SHAPES, PERIOD_MINUTES,
};
