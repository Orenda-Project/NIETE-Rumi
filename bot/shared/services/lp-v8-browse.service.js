'use strict';
/**
 * The v8 lesson-plan catalogue, in a surface-neutral shape.
 *
 * WHY THIS EXISTS
 * ---------------
 * The WhatsApp Flow and the teacher portal were answering "which
 * lesson plans exist?" from two different corpora:
 *
 *   | Surface | Source                                              |
 *   |---------|-----------------------------------------------------|
 *   | Bot     | data/lp_catalog.json  ∩  niete_lp_assets is_current |
 *   | Portal  | curriculum_lp_ast  +  pre_generated_lps  (direct)   |
 *
 * They are not a superset and a subset — they are unrelated tables. With
 * PORTAL_INCLUDE_CORE_LPS unset on the prod portal service the 2,485
 * curriculum_lp_ast rows were hidden too, so the portal served only the 317
 * pre-generated rows: grade 5 maths showed 0 chapters where the bot showed 8
 * chapters and 87 lessons. A teacher browsing the app and a teacher browsing
 * WhatsApp saw different products.
 *
 * So this module is the ONE place that answers the question, and the portal
 * reaches it over the internal API (see internal-api.routes.js
 * /lp/v8/*) exactly the way it reaches training rules and certificates.
 * The portal holds no LP query logic and touches no LP table.
 *
 * WHY NOT REUSE lp-v8-catalog's build*Items()
 * -------------------------------------------
 * Those return WhatsApp NavigationList rows: titles clipped to 30 CODE POINTS,
 * descriptions to 20, 20 rows per page, each carrying an `on-click-action`
 * data_exchange payload. That is presentation for one surface. Handing it to a
 * browser would cap chapter names at 30 characters and paginate a page that
 * has room for everything — Meta's limits leaking into the web UI.
 *
 * The split: this module owns WHAT EXISTS (catalogue ∩ availability, full
 * untruncated text), each surface owns HOW IT LOOKS. Both read the same
 * catalogue file and the same niete_lp_assets availability set, so they cannot
 * disagree about content — which was the actual bug.
 *
 * AVAILABILITY IS THE MOVING PART
 * -------------------------------
 * The catalogue is static and complete (2,038 K-5 lessons). A lesson is
 * servable iff niete_lp_assets holds an is_current row for it, so a lesson
 * appears the moment its PDF is uploaded — no code change, no deploy. Every
 * function here intersects the two, exactly as the Flow endpoint does.
 */

const V8Catalog = require('./lp-v8-catalog.service');
const V8Delivery = require('./lp-v8-delivery.service');

/** Grades that have at least one servable lesson. */
async function listGrades() {
  const available = await V8Delivery.availableLessonIds();
  const grades = V8Catalog.gradesWithContent(available);
  return grades.map((grade) => ({
    grade,
    subject_count: subjectsFor(grade, available).length,
  }));
}

/** Books for one grade that have at least one servable lesson. */
function subjectsFor(grade, available) {
  const out = [];
  for (const book of V8Catalog.catalog().books) {
    if (Number(book.grade) !== Number(grade)) continue;
    const lessons = countAvailable(book, available);
    if (!lessons) continue;
    out.push({
      subject_key: book.subject_key,
      subject: book.subject,
      rtl: !!book.rtl,
      lesson_count: lessons,
    });
  }
  return out.sort((a, b) => a.subject.localeCompare(b.subject));
}

async function listSubjects(grade) {
  const available = await V8Delivery.availableLessonIds();
  return subjectsFor(grade, available);
}

/**
 * Chapters for one book, with the count of servable lessons in each.
 *
 * Chapters with nothing servable are omitted rather than shown empty — the
 * same rule buildChapterItems applies, so the two surfaces list the same
 * chapters. Titles are FULL here; the Flow clips its own.
 */
async function listChapters(grade, subjectKey) {
  const available = await V8Delivery.availableLessonIds();
  const book = V8Catalog.bookFor(grade, subjectKey);
  if (!book) return [];

  const chapters = [];
  for (const chapter of book.chapters) {
    const lessons = (chapter.lessons || []).filter((l) => available.has(l.lesson_id));
    if (!lessons.length) continue;
    chapters.push({
      chapter_number: chapter.number,
      chapter_title: chapter.title,
      pages_label: chapter.pages_label || null,
      lesson_count: lessons.length,
    });
  }
  return chapters.sort((a, b) => a.chapter_number - b.chapter_number);
}

/**
 * Lessons in one chapter.
 *
 * `downloaded` is per-teacher and drives the portal's equivalent of the Flow's
 * ✓/○ tick. It comes from niete_lp_downloads (status='sent'), the same table
 * and the same rule the Flow uses — received in ANY version counts.
 *
 * No pagination: the Flow pages at 20 because Meta caps a NavigationList
 * there. A browser has no such limit and a chapter is a handful of lessons.
 */
async function listLessons(grade, subjectKey, chapterNumber, userId = null) {
  const [available, downloaded] = await Promise.all([
    V8Delivery.availableLessonIds(),
    userId ? V8Delivery.downloadedLessonIds(userId) : Promise.resolve(new Set()),
  ]);

  const chapter = V8Catalog.chapterFor(grade, subjectKey, chapterNumber);
  if (!chapter) return [];

  return (chapter.lessons || [])
    .filter((l) => available.has(l.lesson_id))
    .map((l) => ({
      lesson_id: l.lesson_id,
      segment_index: l.segment_index,
      lp_type: l.lp_type,
      day_label: l.day_label || null,
      section: l.section || null,
      topic: l.topic || null,
      pages_label: l.pages_label || null,
      downloaded: downloaded.has(l.lesson_id),
    }))
    .sort((a, b) => (a.segment_index ?? 0) - (b.segment_index ?? 0));
}

/**
 * A signed, time-limited URL for one lesson's PDF (or its answer key).
 *
 * The same two-step the Flow's delivery path uses: the raw R2 endpoint URL
 * 400s for an anonymous fetch, so it MUST be wrapped in getPresignedUrl.
 *
 * Returns null when the lesson has no current asset — a legitimate state
 * ("not rendered yet"), which the caller renders rather than treating as an
 * error. Unknown lesson ids also return null; the portal never invents one.
 */
async function lessonPdfUrl(lessonId, assetKind = 'lesson') {
  if (!V8Catalog.lessonById(lessonId)) return null;

  const asset = await V8Delivery.currentAssetFor(lessonId, assetKind);
  if (!asset || !asset.r2_key) return null;

  const { buildR2PublicUrl, getPresignedUrl } = require('../storage/r2');
  const url = await getPresignedUrl(buildR2PublicUrl(asset.r2_key));
  return {
    url,
    asset_kind: assetKind,
    version_stamp: asset.version_stamp || null,
  };
}

function countAvailable(book, available) {
  let n = 0;
  for (const chapter of book.chapters || []) {
    for (const lesson of chapter.lessons || []) {
      if (available.has(lesson.lesson_id)) n += 1;
    }
  }
  return n;
}

module.exports = { listGrades, listSubjects, listChapters, listLessons, lessonPdfUrl };
