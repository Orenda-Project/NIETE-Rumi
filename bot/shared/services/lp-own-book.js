'use strict';
/**
 * (unified spec item 13) — her book's pages for "Make my own", grades 1–12.
 *
 * The portal shows the TEXT of the pages she is teaching (GET /api/internal/lp612/own/pages), and the rewrite is fed
 * the same text (bookTextFor), so the plan is rooted in her book. Text only: grades 1–5 have no page images, and this
 * never offers one ("design pending" is the portal's to say). A book that is not imported, a subject with no book
 * code, or a segment of another curriculum (GB's NBF books) is "not loaded" — never a stand-in book.
 *
 *   pagesFor({ lessonId | segmentId, from?, to? }) → { outcome: 'ok', loaded, pages: [{ page, text }], missing }
 *                                                   | { outcome: 'bad_request' | 'not_found' }
 *   bookTextFor({ grade, subject, from, to, curriculum? }) → the joined page text, or null. Never throws.
 */
const { MAX_SPAN } = require('./lp-k5-own-pages');

const MAX_PAGE = 999;
const ICT = 'ict';
/** The 6–12 segment subject (free text, folded by lp612-subject-order) → the textbooks code, where they differ. */
const SEGMENT_CODES = { mathematics: 'maths', islamiyat: 'islamiat' };
const NOT_LOADED = Object.freeze({ outcome: 'ok', loaded: false, pages: [], missing: [] });

const whole = (v) => {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) ? n : null;
};

/** Whole pages 1..999, first ≤ last, at most MAX_SPAN pages. */
function parseRange(rawFrom, rawTo) {
  const from = whole(rawFrom);
  const to = whole(rawTo);
  if (from === null || to === null || from < 1 || to > MAX_PAGE || from > to) return { ok: false, error: 'from and to: whole pages, from ≤ to' };
  if (to - from + 1 > MAX_SPAN) return { ok: false, error: `at most ${MAX_SPAN} pages` };
  return { ok: true, from, to };
}

// The grades 1–5 catalog's own subject keys (lp_catalog.json subject_key). Translated here, not in
// book-content's normaliseSubject: there `general_science` is a grade 6–12 code a grade 1–5 call must refuse.
const K5_CATALOG_CODES = {
  general_science: 'science', general_knowledge_ur: 'general_knowledge', social_studies_ur: 'social_studies',
};

/** The textbooks subject code for a grade's subject, or null. */
function bookCode(grade, subject) {
  const { normaliseSubject } = require('./assessment/book-content.service');
  if (Number(grade) < 6) {
    const k = String(subject || '').trim().toLowerCase();
    return normaliseSubject(K5_CATALOG_CODES[k] || k, grade);
  }
  const { normalizeSubject } = require('../config/lp612-subject-order');
  const folded = normalizeSubject(subject);
  const key = SEGMENT_CODES[folded] || folded.replace(/\s+/g, '_');
  return normaliseSubject(key, grade);
}

/** "=== Page N ===\ntext" blocks back into [{ page, text }]. */
function splitPages(content) {
  const out = [];
  const re = /=== Page (\d+) ===\n([\s\S]*?)(?=\n\n=== Page \d+ ===\n|$)/g;
  let m;
  while ((m = re.exec(String(content || '')))) out.push({ page: Number(m[1]), text: m[2].trim() });
  return out;
}

const span = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function createOwnBook(deps) {
  const d = deps;

  /** Her pages from her book: { loaded, pages, missing }. A lookup failure that is not "no book" throws. */
  async function readPages({ grade, subject, from, to, curriculum }) {
    const code = bookCode(grade, subject);
    if (!code || (curriculum && curriculum !== ICT)) return NOT_LOADED;
    const wanted = span(from, to);
    const load = (lo, hi) => d.loadPageRangeContent({ grade: Number(grade), subject: code, pageRanges: `${lo}-${hi}`, curriculum: ICT });
    let content = '';
    try {
      content = (await load(from, to)).content;
    } catch (err) {
      if (err && err.code === 'BOOK_NOT_FOUND') return NOT_LOADED;
      if (err && err.code === 'NO_CONTENT') content = '';
      else if (err && err.code === 'PAGE_OUT_OF_RANGE' && Number.isInteger(err.totalPages) && err.totalPages >= from) {
        try { content = (await load(from, err.totalPages)).content; } catch (e) {
          if (!e || e.code !== 'NO_CONTENT') throw e;
        }
      } else if (!(err && err.code === 'PAGE_OUT_OF_RANGE')) throw err;
    }
    const pages = splitPages(content).filter((p) => p.page >= from && p.page <= to);
    const found = new Set(pages.map((p) => p.page));
    return { outcome: 'ok', loaded: true, pages, missing: wanted.filter((p) => !found.has(p)) };
  }

  /** The day (1–5) or segment (6–12) and its book; null when there is none to show. */
  async function sourceOf({ lessonId, segmentId }) {
    if (lessonId) {
      const day = await d.k5Lesson(lessonId);
      return day ? { grade: day.grade, subject: day.subject, curriculum: ICT, pages: day.pages || null } : null;
    }
    const seg = await d.loadSegment(segmentId);
    if (!seg) return null;
    const own = whole(seg.printed_page_start) && whole(seg.printed_page_end)
      ? { start: whole(seg.printed_page_start), end: whole(seg.printed_page_end) } : null;
    return { grade: seg.grade, subject: seg.subject, curriculum: seg.curriculum || ICT, pages: own };
  }

  async function pagesFor({ lessonId, segmentId, from, to } = {}) {
    if (!lessonId === !segmentId) return { outcome: 'bad_request', error: 'lesson_id or segment_id' };
    const given = from !== undefined && from !== null && from !== '';
    const givenTo = to !== undefined && to !== null && to !== '';
    if (given !== givenTo) return { outcome: 'bad_request', error: 'from and to together' };
    const asked = given ? parseRange(from, to) : null;
    if (asked && !asked.ok) return { outcome: 'bad_request', error: asked.error };
    const src = await sourceOf({ lessonId, segmentId });
    if (!src) return { outcome: 'not_found' };
    const range = asked || (src.pages ? parseRange(src.pages.start, Math.min(src.pages.end, src.pages.start + MAX_SPAN - 1)) : null);
    if (!range || !range.ok) return { outcome: 'bad_request', error: 'from and to are required for this lesson' };
    return readPages({ grade: src.grade, subject: src.subject, from: range.from, to: range.to, curriculum: src.curriculum });
  }

  async function bookTextFor({ grade, subject, from, to, curriculum } = {}) {
    try {
      const lo = whole(from);
      const hi = whole(to);
      if (!lo || !hi || hi < lo) return null;
      const range = parseRange(lo, Math.min(hi, lo + MAX_SPAN - 1));
      if (!range.ok) return null;
      const out = await readPages({ grade, subject, from: range.from, to: range.to, curriculum });
      if (!out.loaded || !out.pages.length) return null;
      return out.pages.map((p) => `=== Page ${p.page} ===\n${p.text}`).join('\n\n');
    } catch (_) {
      return null;
    }
  }

  return { pagesFor, bookTextFor };
}

/** The segment's book fields, or null (a plain function: the schema guards read `.from()` calls written this way). */
async function loadSegment(supabase, segmentId) {
  const { data, error } = await supabase
    .from('niete_lp612_segments')
    .select('segment_id, grade, subject, curriculum, printed_page_start, printed_page_end')
    .eq('segment_id', segmentId)
    .maybeSingle();
  return error ? null : (data || null);
}

let live = null;
const book = () => {
  live = live || createOwnBook({
    k5Lesson: (id) => require('./lp-k5-own-source').k5Lesson(id),
    loadSegment: (id) => loadSegment(require('../config/supabase'), id),
    loadPageRangeContent: (q) => require('./assessment/book-content.service').loadPageRangeContent(q),
  });
  return live;
};

module.exports = {
  createOwnBook, bookCode, splitPages, parseRange, MAX_PAGE,
  pagesFor: (q) => book().pagesFor(q),
  bookTextFor: (q) => book().bookTextFor(q),
};
