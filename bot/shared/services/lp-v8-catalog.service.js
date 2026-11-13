// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Why, target model, follow-up (audit planned): docs/lesson-plan-data-model-debt.md
'use strict';
/**
 * The v8 catalog, and the NavigationList rows built from it.
 *
 * The catalog (data/lp_catalog.json) is STATIC and COMPLETE: all 2,038 K-5
 * lessons, with their row strings already normalised and cap-verified at build
 * time. Availability is a separate, MOVING thing — a lesson is servable iff
 * niete_lp_assets has an is_current row for it. The endpoint intersects the two.
 *
 * That split is what makes the corpus "upload-ready the moment rendering
 * completes": a lesson appears in the Flow as soon as its PDF is uploaded, with
 * no code change, no Flow republish and no deploy.
 *
 * Meta NavigationList caps (see DELIVERY_WIRING_PLAN.md §2): 20 items/screen,
 * title 30, description 20, metadata 80 — all in CODE POINTS.
 */

const path = require('path');

const TITLE_CAP = 30;
const DESC_CAP = 20;
const META_CAP = 80;
const PAGE_SIZE = 20;              // rows per NavigationList screen
const MORE_ROW_ID = '__more__';

const DONE_TICK = '✓';
const TODO_TICK = '○';

const V8_MAX_GRADE = 5;            // 1-5 = the K-5 v8 corpus; 6+ = the Oxbridge catalog

const cps = (s) => [...String(s == null ? '' : s)].length;

function clip(s, n) {
  const chars = [...String(s == null ? '' : s)];
  if (chars.length <= n) return chars.join('');
  return chars.slice(0, n - 1).join('') + '…';
}

// ── catalog access ──────────────────────────────────────────────────────────

let _catalog = null;

function catalog() {
  if (_catalog === null) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    _catalog = require(path.join(__dirname, '..', '..', 'data', 'lp_catalog.json'));
  }
  return _catalog;
}

/** Test seam — pass null to restore the real catalog. */
function __setCatalogForTests(c) { _catalog = c; }

// ── the teacher's books (bd-97daxo.4, book-first) ───────────────────────────
//
// Every read below that answers "which book" takes an optional trailing `bookKeys`: the list of book keys her
// region names (teacher-books.service, region_features.book_keys). Absent or null is TODAY'S ICT LIST: every book
// that is not `opt_in`. GB's NBF books are opt_in, so they reach only a region that lists them, and a subject
// whose book is not on a teacher's list is simply not on her menu — never ICT's book in its place.
// lessonById stays global: delivery is by lesson id, and an id is only ever on the menu of a teacher it is for.

const bookKeyOf = (b) => b.book_key || b.stem;

/** The books a teacher with this list may see, in catalog order. */
function shelf(bookKeys) {
  const books = catalog().books;
  if (!Array.isArray(bookKeys)) return books.filter((b) => !b.opt_in);
  const want = new Set(bookKeys);
  return books.filter((b) => want.has(bookKeyOf(b)));
}

function bookFor(grade, subjectKey, bookKeys) {
  return shelf(bookKeys).find((b) => b.grade === Number(grade) && b.subject_key === subjectKey) || null;
}

/** The book's menu name ("Social Studies (Urdu)"); the key itself when no book matches. */
function subjectTitle(grade, subjectKey, bookKeys) {
  const book = bookFor(grade, subjectKey, bookKeys);
  return book ? book.subject : subjectKey;
}

/**
 * A chapter's number is an integer for every ICT chapter and most GB ones (GB Urdu's review units are 101-105),
 * and 'R1'..'R4' for GB English's review chapters. A Flow payload carries String(number), so a chapter answers
 * to its own string; an integer chapter still answers to anything Number() reads as it, as before.
 */
function sameChapter(number, wanted) {
  if (String(number) === String(wanted).trim()) return true;
  return typeof number === 'number' && number === Number(wanted);
}

function chapterFor(grade, subjectKey, chapterNumber, bookKeys) {
  const book = bookFor(grade, subjectKey, bookKeys);
  if (!book) return null;
  return book.chapters.find((c) => sameChapter(c.number, chapterNumber)) || null;
}

/** Locate a lesson and the chapter/book it belongs to. Null when unknown. */
function lessonById(lessonId) {
  for (const book of catalog().books) {
    for (const chapter of book.chapters) {
      for (const lesson of chapter.lessons) {
        if (lesson.lesson_id === lessonId) return { lesson, chapter, book };
      }
    }
  }
  return null;
}

/** Grades that have at least one AVAILABLE lesson. */
function gradesWithContent(available, bookKeys) {
  const grades = new Set();
  for (const book of shelf(bookKeys)) {
    for (const chapter of book.chapters) {
      if (chapter.lessons.some((l) => available.has(l.lesson_id))) { grades.add(book.grade); break; }
    }
  }
  return [...grades].sort((a, b) => a - b);
}

const availableIn = (chapter, available) => chapter.lessons.filter((l) => available.has(l.lesson_id));

// ── id prefixes ─────────────────────────────────────────────────────────────

/**
 * Three delivery pipelines share one Flow, so the row id says which one owns it:
 *   V8-<lesson_id>  → the K-5 v8 corpus (niete_lp_assets → R2)
 *   PK-<uuid>       → the legacy pre_generated_lps rows
 *   OX-<bigint>     → Oxbridge 6-12 (lesson_plan_catalog)
 * An unprefixed id stays 'pakistan' for back-compat with the v2 Flow.
 */
function parseLessonId(id) {
  const s = String(id || '');
  if (s.startsWith('V8-')) return { source: 'v8', rawId: s.slice(3) };
  if (s.startsWith('OX-')) return { source: 'oxbridge', rawId: s.slice(3) };
  if (s.startsWith('PK-')) return { source: 'pakistan', rawId: s.slice(3) };
  return { source: 'pakistan', rawId: s };
}

// ── row builders ────────────────────────────────────────────────────────────

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function buildGradeItems(grades) {
  // Just the grade name and the tap hint. A corpus subheading used to repeat on
  // every row ("Primary curriculum lesson plans" × 5, "Oxbridge…" × 5) and read
  // as noise on the operator's device test (staging feedback round 1).
  return grades.map((g) => ({
    id: String(g),
    'main-content': {
      title: clip(`Grade ${g}`, TITLE_CAP),
      description: 'Tap to open',
    },
    'on-click-action': { name: 'data_exchange', payload: { step: 'grade', grade: String(g) } },
  }));
}

// Amena, 9 Oct 2026 (bd-6640j.1.8.7): core books first, then the electives, in this order; a book not listed here
// comes after them, alphabetically, so a new subject shows up without reshuffling the rest.
const SUBJECT_ORDER = ['english', 'urdu', 'math', 'general_science',
  'general_knowledge_ur', 'general_knowledge', 'social_studies_en', 'social_studies_ur', 'islamiat'];
const subjectRank = (key) => (SUBJECT_ORDER.includes(key) ? SUBJECT_ORDER.indexOf(key) : SUBJECT_ORDER.length);
const bySubjectOrder = (a, b) => subjectRank(a.subject_key) - subjectRank(b.subject_key)
  || String(a.subject_key).localeCompare(String(b.subject_key));

/** Subjects for a grade that have at least one available chapter, in SUBJECT_ORDER. */
function buildSubjectItems(grade, available, bookKeys) {
  const items = [];
  for (const book of shelf(bookKeys).filter((b) => b.grade === Number(grade)).sort(bySubjectOrder)) {
    let chapters = 0;
    let lessons = 0;
    for (const chapter of book.chapters) {
      const n = availableIn(chapter, available).length;
      if (n > 0) { chapters += 1; lessons += n; }
    }
    if (!chapters) continue;
    items.push({
      id: book.subject_key,
      'main-content': {
        title: clip(book.subject, TITLE_CAP),
        description: clip(plural(chapters, 'chapter'), DESC_CAP),
        metadata: clip(`Grade ${grade} · ${plural(lessons, 'lesson')} ready`, META_CAP),
      },
      'on-click-action': {
        name: 'data_exchange',
        payload: { step: 'subject', grade: String(grade), subject: book.subject_key },
      },
    });
  }
  return items.slice(0, PAGE_SIZE);
}

/**
 * Chapters with at least one available lesson. A chapter with nothing rendered
 * yet is HIDDEN rather than shown and dead-ended — the teacher should not be
 * able to tap into an empty screen.
 */
/** Urdu (Extended Arabic-Indic) digits for RTL row furniture — mirrors the builder. */
const urD = (s) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * How a chapter is named on a row or a header: "Ch 3" / "باب ۳", or — for a review chapter (GB's 'R1' "Review 1",
 * GB Urdu's 101 "جائزہ-۱") — its own title, because "Ch R1" or "باب ۱۰۱" names nothing a teacher has in her book.
 */
function chapterLabel(chapter, rtl) {
  if (chapter && chapter.review) return chapter.title;
  return rtl ? `باب ${urD(chapter.number)}` : `Ch ${chapter.number}`;
}

/**
 * Chapters with servable lessons, one Flow screen at a time (bd-97daxo.5). A book of PAGE_SIZE chapters or fewer —
 * every ICT book — is one screen, exactly as before. GB's Urdu books carry 27-28 (Amena's جائزہ review units sit
 * between the lessons), so page 1 is PAGE_SIZE-1 chapters and a "More chapters" row whose `chapter_page` step opens
 * SELECT_CHAPTER_MORE, the screen the published Flow already has for Grades 6-12. Meta rejects a self-route.
 */
function buildChapterItems(grade, subjectKey, available, bookKeys, page = 1) {
  const book = bookFor(grade, subjectKey, bookKeys);
  if (!book) return [];
  const rtl = !!book.rtl;
  const items = [];
  for (const chapter of book.chapters) {
    const lessons = availableIn(chapter, available);
    if (!lessons.length) continue;

    // §12.3/12.4 layout: the chapter NUMBER leads the title and the name merges
    // in only when the whole thing fits; a clipped name moves IN FULL to the
    // 80-cp metadata line — nothing lost, only reseated. Pages + LP count share
    // the description. Urdu rows get Urdu furniture (باب/ص/اسباق + Urdu digits)
    // so the first strong character is Arabic and the row renders RTL —
    // right-aligned, ellipsis on the correct side (operator, 2026-08-17).
    const numTitle = chapterLabel(chapter, rtl);
    const merged = chapter.review ? numTitle : (rtl ? `${numTitle}: ${chapter.title}` : `${numTitle} — ${chapter.title}`);
    const fits = cps(merged) <= TITLE_CAP;
    const title = fits ? merged : (chapter.review ? clip(numTitle, TITLE_CAP) : numTitle);
    const metadata = fits ? '' : clip(chapter.title, META_CAP);

    const range = chapter.pages_label ? (rtl ? `ص ${urD(chapter.pages_label.slice(2))}` : chapter.pages_label) : '';
    const n = lessons.length;
    const count = rtl ? `${urD(n)} اسباق` : `${n} LP${n === 1 ? '' : 's'}`;
    let description = range ? `${range} · ${count}` : count;
    if (cps(description) > DESC_CAP) description = range || count;

    const mc = rtl ? { title: '\u200F' + title, description: '\u200F' + description } : { title, description };
    if (metadata) mc.metadata = rtl ? '\u200F' + metadata : metadata;
    items.push({
      id: String(chapter.number),
      'main-content': mc,
      'on-click-action': {
        name: 'data_exchange',
        payload: { step: 'chapter', grade: String(grade), subject: subjectKey, chapter: String(chapter.number) },
      },
    });
  }
  if (items.length <= PAGE_SIZE) return Number(page) > 1 ? [] : items;

  const per = PAGE_SIZE - 1;
  const p = Math.max(1, Number(page) || 1);
  const slice = items.slice((p - 1) * per, p * per);
  if (p * per < items.length) {
    slice.push({
      id: MORE_ROW_ID,
      'main-content': rtl
        ? { title: '\u200Fمزید ابواب ←', description: clip(`\u200Fصفحہ ${urD(p + 1)}`, DESC_CAP) }
        : { title: 'More chapters →', description: clip(`Page ${p + 1}`, DESC_CAP) },
      'on-click-action': {
        name: 'data_exchange',
        payload: { step: 'chapter_page', grade: String(grade), subject: String(subjectKey), page: String(p + 1) },
      },
    });
  }
  return slice;
}

/**
 * Lessons for one chapter, page by page.
 *
 * The tick is applied here, not at build time, because it is per-teacher: ✓ once
 * she has received that lesson in ANY version. The catalog's row.title is capped
 * at 28 precisely so "✓ " always fits inside 30.
 *
 * Pagination: a full page is PAGE_SIZE rows. When more remain, the last row of
 * the page becomes a "More lessons →" link, so a page holds PAGE_SIZE-1 real
 * lessons plus the link. Meta rejects a self-route, hence a second screen rather
 * than re-rendering this one.
 *
 * @returns {{items: Array, hasMore: boolean, total: number}}
 */
function buildLessonItems(grade, subjectKey, chapterNumber, available, downloaded, page = 1, bookKeys = undefined, lead = 0) {
  const chapter = chapterFor(grade, subjectKey, chapterNumber, bookKeys);
  if (!chapter) return { items: [], hasMore: false, total: 0 };

  const lessons = availableIn(chapter, available);
  const total = lessons.length;
  const done = downloaded || new Set();

  const pageNum = Math.max(1, Number(page) || 1);
  // Page 1 shows PAGE_SIZE-1 when it needs a More row; every later page shows a
  // full PAGE_SIZE (it is reached via the link, not via another link).
  // `lead` rows on page 1 belong to the caller (Make my own goes first), so page 1 holds that many fewer.
  const room = PAGE_SIZE - (lead ? 1 : 0);
  const firstPageCount = total > room ? room - 1 : room;
  const start = pageNum === 1 ? 0 : firstPageCount + (pageNum - 2) * PAGE_SIZE;
  const slice = lessons.slice(start, start + (pageNum === 1 ? firstPageCount : PAGE_SIZE));
  const remaining = total - (start + slice.length);

  const items = slice.map((l) => ({
    id: `V8-${l.lesson_id}`,
    'main-content': {
      // An rtl title leads with RLM (char 0 drives direction detection) — the
      // tick slots in AFTER it so the mark stays first.
      title: clip(l.row.title.startsWith('\u200F')
        ? `\u200F${done.has(l.lesson_id) ? DONE_TICK : TODO_TICK} ${l.row.title.slice(1)}`
        : `${done.has(l.lesson_id) ? DONE_TICK : TODO_TICK} ${l.row.title}`, TITLE_CAP),
      description: clip(l.row.description, DESC_CAP),
      metadata: clip(l.row.metadata, META_CAP),
    },
    'on-click-action': { name: 'data_exchange', payload: { step: 'lesson', lesson: `V8-${l.lesson_id}` } },
  }));

  const hasMore = remaining > 0;
  if (hasMore) {
    // Urdu books get Urdu furniture so the row renders RTL (§12.4); the arrow
    // points the direction of reading flow.
    const rtl = !!(bookFor(grade, subjectKey, bookKeys) || {}).rtl;
    items.push({
      id: MORE_ROW_ID,
      'main-content': rtl ? {
        title: '\u200Fمزید اسباق ←',
        description: clip(`صفحہ ${urD(pageNum + 1)}`, DESC_CAP),
        metadata: clip(`اس باب میں ${urD(remaining)} مزید اسباق`, META_CAP),
      } : {
        title: 'More lessons →',
        description: clip(`Page ${pageNum + 1}`, DESC_CAP),
        metadata: clip(`${remaining} more in this chapter`, META_CAP),
      },
      // The payload IS the whole request body the endpoint will see — screen data
      // (grade_value/subject_value/chapter_value) does NOT ride along with a tap.
      // Ship the chapter with the row or selectLessonPage has nothing to page. (bd-hd2wy)
      'on-click-action': {
        name: 'data_exchange',
        payload: {
          step: 'lesson_page',
          page: String(pageNum + 1),
          grade: String(grade),
          subject: String(subjectKey),
          chapter: String(chapterNumber),
          ...(lead ? { lead: '1' } : {}),
        },
      },
    });
  }

  return { items, hasMore, total };
}

module.exports = {
  buildGradeItems,
  buildSubjectItems,
  bySubjectOrder,
  buildChapterItems,
  buildLessonItems,
  parseLessonId,
  lessonById,
  gradesWithContent,
  shelf,
  bookFor,
  subjectTitle,
  chapterFor,
  chapterLabel,
  catalog,
  clip,
  cps,
  __setCatalogForTests,
  TITLE_CAP,
  DESC_CAP,
  META_CAP,
  PAGE_SIZE,
  MORE_ROW_ID,
  V8_MAX_GRADE,
  DONE_TICK,
  TODO_TICK,
};
