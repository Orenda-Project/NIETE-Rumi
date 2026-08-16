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

function bookFor(grade, subjectKey) {
  return catalog().books.find((b) => b.grade === Number(grade) && b.subject_key === subjectKey) || null;
}

function chapterFor(grade, subjectKey, chapterNumber) {
  const book = bookFor(grade, subjectKey);
  if (!book) return null;
  return book.chapters.find((c) => c.number === Number(chapterNumber)) || null;
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
function gradesWithContent(available) {
  const grades = new Set();
  for (const book of catalog().books) {
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

/** Subjects for a grade that have at least one available chapter. */
function buildSubjectItems(grade, available) {
  const items = [];
  for (const book of catalog().books) {
    if (book.grade !== Number(grade)) continue;
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
function buildChapterItems(grade, subjectKey, available) {
  const book = bookFor(grade, subjectKey);
  if (!book) return [];
  // Keeps the Latin "p.4-33" from bidi-scrambling at the end of an Urdu line —
  // same mark the catalog builder plants inside lesson metadata.
  const mark = book.rtl ? '‎' : '';
  const items = [];
  for (const chapter of book.chapters) {
    const lessons = availableIn(chapter, available);
    if (!lessons.length) continue;

    // Metadata carries the chapter's FULL page span — it used to echo the first
    // lesson's topic + pages, which read as "the chapter starts at p.N" on the
    // operator's device test (staging feedback round 1). When the
    // 30-cp cap clips the title, the full chapter title leads the line so
    // nothing is lost, only moved.
    const full = `Ch ${chapter.number}: ${chapter.title}`;
    const range = chapter.pages_label || '';
    let metadata;
    if (cps(full) > TITLE_CAP && range) {
      const suffix = `${mark} · ${range}`;
      metadata = clip(chapter.title, META_CAP - cps(suffix)) + suffix;
    } else if (cps(full) > TITLE_CAP) {
      metadata = clip(chapter.title, META_CAP);
    } else {
      metadata = range || clip(lessons[0].row.metadata, META_CAP);
    }

    items.push({
      id: String(chapter.number),
      'main-content': {
        title: clip(full, TITLE_CAP),
        description: clip(plural(lessons.length, 'lesson'), DESC_CAP),
        metadata,
      },
      'on-click-action': {
        name: 'data_exchange',
        payload: { step: 'chapter', grade: String(grade), subject: subjectKey, chapter: String(chapter.number) },
      },
    });
  }
  return items.slice(0, PAGE_SIZE);
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
function buildLessonItems(grade, subjectKey, chapterNumber, available, downloaded, page = 1) {
  const chapter = chapterFor(grade, subjectKey, chapterNumber);
  if (!chapter) return { items: [], hasMore: false, total: 0 };

  const lessons = availableIn(chapter, available);
  const total = lessons.length;
  const done = downloaded || new Set();

  const pageNum = Math.max(1, Number(page) || 1);
  // Page 1 shows PAGE_SIZE-1 when it needs a More row; every later page shows a
  // full PAGE_SIZE (it is reached via the link, not via another link).
  const firstPageCount = total > PAGE_SIZE ? PAGE_SIZE - 1 : PAGE_SIZE;
  const start = pageNum === 1 ? 0 : firstPageCount + (pageNum - 2) * PAGE_SIZE;
  const slice = lessons.slice(start, start + (pageNum === 1 ? firstPageCount : PAGE_SIZE));
  const remaining = total - (start + slice.length);

  const items = slice.map((l) => ({
    id: `V8-${l.lesson_id}`,
    'main-content': {
      title: clip(`${done.has(l.lesson_id) ? DONE_TICK : TODO_TICK} ${l.row.title}`, TITLE_CAP),
      description: clip(l.row.description, DESC_CAP),
      metadata: clip(l.row.metadata, META_CAP),
    },
    'on-click-action': { name: 'data_exchange', payload: { step: 'lesson', lesson: `V8-${l.lesson_id}` } },
  }));

  const hasMore = remaining > 0;
  if (hasMore) {
    items.push({
      id: MORE_ROW_ID,
      'main-content': {
        title: 'More lessons →',
        description: clip(`Page ${pageNum + 1}`, DESC_CAP),
        metadata: clip(`${remaining} more in this chapter`, META_CAP),
      },
      'on-click-action': { name: 'data_exchange', payload: { step: 'lesson_page', page: String(pageNum + 1) } },
    });
  }

  return { items, hasMore, total };
}

module.exports = {
  buildGradeItems,
  buildSubjectItems,
  buildChapterItems,
  buildLessonItems,
  parseLessonId,
  lessonById,
  gradesWithContent,
  bookFor,
  chapterFor,
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
