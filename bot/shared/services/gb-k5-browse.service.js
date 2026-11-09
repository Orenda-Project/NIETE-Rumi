'use strict';
/**
 * The GB K-5 lane for the portal/app (bd-rj6w0n.14): what a GB teacher's lesson-plan browse shows.
 *
 * The portal routes (/api/internal/lp/v8/*) read lp-v8-browse — ICT's catalogue plus the old GB v9 rows.
 * A GB teacher, with LP_GB_K5_ENABLED on, reads this instead.
 *
 * GB follows ICT 6-12 (operator, 9 Nov: "pre-gen if available if not then gen it JIT"). Her GB books
 * (English, Urdu, Maths, Science: niete_lp612_segments nbf_snc, current) list EVERY lesson, each with
 * `ready`: true when niete_gb_lp_renders holds a ready plan at the current GB template version in the
 * book's language (it opens at once), false when it is not written yet (the app asks for it through
 * /lp612/request and gb_lp_author writes it, as an ICT 6-12 lesson is written). An unwritten lesson is listed
 * only when it CAN be written: LP_GB_AUTHOR_ENABLED on and its book's page text loaded in R2. Where GB has no book of its own (GK,
 * SST, Islamiat) her region's list names ICT's books, and those come from ICT's K-5 catalogue
 * (lp-v8-browse) asked with ICT's books only. Same response shapes as lp-v8-browse; GB lesson ids are
 * segment ids. GB plans have no answer keys.
 */
const supabase = require('../config/supabase');
const { buildR2PublicUrl, getPresignedUrl } = require('../storage/r2');
const { NBF_SNC, GB_K5_GRADES, gbK5BookFor, gbOnRequestSubjects } = require('./lp612-curriculum.service');
const { authorLanguage } = require('./lp612-gb-delivery.service');
const { templateVersion, isAuthorEnabled } = require('./gb-lp-serving.service');
const V8 = require('./lp-v8-browse.service');
const PageTruth = require('./lp612-pagetruth.service');

const SEGMENTS = 'niete_lp612_segments';
const RENDERS = 'niete_gb_lp_renders';
const PAGE = 1000;
const SEG_COLUMNS = 'segment_id, grade, subject, chapter_number, chapter_title, subtopic_title, menu_title, '
  + 'order_index, printed_page_start, printed_page_end, language, book_stem';

const isGbLessonId = (id) => typeof id === 'string' && id.startsWith(`${NBF_SNC}_`);
const bookKey = (grade, book) => `gb_g${grade}_${book.key}`;
const isOwnKey = (k) => /^gb_g\d+_/.test(String(k));
/** The ICT books on her list (GK, SST, Islamiat), for ICT's K-5 catalogue. Never GB's own (their old v9 PDFs). */
const ictKeys = (bookKeys) => (Array.isArray(bookKeys) ? bookKeys.filter((k) => !isOwnKey(k)) : []);
const isGbBook = (grade, subjectKey) => gbOnRequestSubjects(grade).some((b) => b.key === subjectKey);

async function readAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

/** The grade's (or all K-5) current GB segments of an on-request book, each with its book. */
async function segments(grade) {
  const rows = await readAll(() => {
    let q = supabase.from(SEGMENTS).select(SEG_COLUMNS).eq('curriculum', NBF_SNC).eq('is_current', true);
    q = grade ? q.eq('grade', grade) : q.in('grade', GB_K5_GRADES);
    return q.order('segment_id', { ascending: true });
  });
  return rows
    .map((r) => ({ ...r, book: gbK5BookFor(r.grade, r.subject) }))
    .filter((r) => r.book && gbOnRequestSubjects(r.grade).some((b) => b.key === r.book.key));
}

/** segment_id → its ready render at today's template version, in the book's language. */
async function readyRenders(segs) {
  const tv = templateVersion();
  const rows = await readAll(() => supabase.from(RENDERS).select('segment_id, lang, r2_key, template_version')
    .eq('template_version', tv).eq('status', 'ready').order('segment_id', { ascending: true }));
  const want = new Map(segs.map((s) => [s.segment_id, authorLanguage(s)]));
  return new Map(rows.filter((r) => r.r2_key && want.get(r.segment_id) === r.lang).map((r) => [r.segment_id, r]));
}

/**
 * The books whose lessons can be written now: writing is on (LP_GB_AUTHOR_ENABLED) and the book's page text is
 * loaded (lp612-pagetruth.hasBook — without it gb_lp_author fails PAGE_TRUTH_MISSING on every lesson).
 */
async function writableBooks(segs) {
  if (!isAuthorEnabled()) return new Set();
  const stems = [...new Set(segs.map((s) => s.book_stem).filter(Boolean))];
  const has = await Promise.all(stems.map((b) => PageTruth.hasBook(b)));
  return new Set(stems.filter((_, i) => has[i]));
}

/**
 * The lessons of the teacher's GB books, optionally for one grade, each with `ready`: every written lesson, and
 * every unwritten one whose book can be written now (it is written on her tap).
 */
async function listedLessons(grade, bookKeys) {
  const listed = Array.isArray(bookKeys) ? new Set(bookKeys) : null;
  const segs = (await segments(grade)).filter((s) => !listed || listed.has(bookKey(s.grade, s.book)));
  const [ready, writable] = await Promise.all([readyRenders(segs), writableBooks(segs)]);
  return segs.map((s) => ({ ...s, ready: ready.has(s.segment_id) })).filter((s) => s.ready || writable.has(s.book_stem));
}

/** ICT's K-5 catalogue for the ICT books on her list; nothing when she has none. */
async function ictFallback(call, bookKeys) {
  const keys = ictKeys(bookKeys);
  return keys.length ? call(keys) : [];
}

function pagesLabel(a, b) {
  if (!a && !b) return null;
  if (!b || a === b) return `p.${a}`;
  return `p.${a}-${b}`;
}

async function listGrades(bookKeys) {
  const [lessons, ict] = await Promise.all([listedLessons(null, bookKeys), ictFallback((k) => V8.listGrades(k), bookKeys)]);
  const ictCount = new Map((ict || []).map((g) => [Number(g.grade), Number(g.subject_count) || 0]));
  return GB_K5_GRADES
    .map((grade) => ({
      grade,
      subject_count: new Set(lessons.filter((l) => l.grade === grade).map((l) => l.book.key)).size + (ictCount.get(grade) || 0),
    }))
    .filter((g) => g.subject_count > 0);
}

async function listSubjects(grade, bookKeys) {
  const [lessons, ict] = await Promise.all([listedLessons(grade, bookKeys), ictFallback((k) => V8.listSubjects(grade, k), bookKeys)]);
  const own = gbOnRequestSubjects(grade)
    .map((book) => ({
      subject_key: book.key, subject: book.title, rtl: book.key === 'urdu',
      lesson_count: lessons.filter((l) => l.book.key === book.key).length,
    }))
    .filter((s) => s.lesson_count > 0);
  return [...own, ...(ict || [])];
}

const byOrder = (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.segment_id.localeCompare(b.segment_id);

async function listChapters(grade, subjectKey, bookKeys) {
  if (!isGbBook(grade, subjectKey)) return ictFallback((k) => V8.listChapters(grade, subjectKey, k), bookKeys);
  const lessons = (await listedLessons(grade, bookKeys)).filter((l) => l.book.key === subjectKey);
  const chapters = new Map();
  for (const l of lessons) {
    const c = chapters.get(l.chapter_number) || { chapter_number: l.chapter_number, chapter_title: l.chapter_title, rows: [] };
    c.rows.push(l);
    chapters.set(l.chapter_number, c);
  }
  return [...chapters.values()]
    .sort((a, b) => a.chapter_number - b.chapter_number)
    .map(({ rows, ...c }) => {
      const starts = rows.map((r) => r.printed_page_start).filter(Boolean);
      const ends = rows.map((r) => r.printed_page_end || r.printed_page_start).filter(Boolean);
      return {
        ...c,
        pages_label: pagesLabel(starts.length ? Math.min(...starts) : null, ends.length ? Math.max(...ends) : null),
        lesson_count: rows.length,
      };
    });
}

async function listLessons(grade, subjectKey, chapterNumber, userId = null, bookKeys = undefined) {
  if (!isGbBook(grade, subjectKey)) {
    return ictFallback((k) => V8.listLessons(grade, subjectKey, chapterNumber, userId, k), bookKeys);
  }
  const all = (await segments(grade))
    .filter((s) => s.book.key === subjectKey && Number(s.chapter_number) === Number(chapterNumber))
    .sort(byOrder);
  const listed = new Map((await listedLessons(grade, bookKeys)).map((l) => [l.segment_id, l]));
  return all
    .map((s, i) => ({ s, index: i + 1 }))
    .filter(({ s }) => listed.has(s.segment_id))
    .map(({ s, index }) => ({
      lesson_id: s.segment_id, segment_index: index, lp_type: 'content', day_label: null, section: null,
      topic: s.menu_title || s.subtopic_title || null,
      pages_label: pagesLabel(s.printed_page_start, s.printed_page_end), downloaded: false,
      // Served like an ICT 6-12 lesson: the app asks for it (/lp612/request) — a written one answers ready, an
      // unwritten one is written by gb_lp_author — and a coaching pick of it is { segmentId, lang }.
      on_request: true,
      ready: listed.get(s.segment_id).ready,
    }));
}

/** { url, asset_kind, version_stamp } for a ready GB plan, else null. No answer keys in this lane. */
async function lessonPdfUrl(lessonId, assetKind = 'lesson') {
  if (assetKind !== 'lesson' || !isGbLessonId(lessonId)) return null;
  const { data: seg, error } = await supabase.from(SEGMENTS).select(SEG_COLUMNS)
    .eq('segment_id', lessonId).eq('curriculum', NBF_SNC).maybeSingle();
  if (error) throw new Error(error.message);
  if (!seg) return null;
  const tv = templateVersion();
  const { data: row, error: rErr } = await supabase.from(RENDERS).select('r2_key, status')
    .eq('segment_id', lessonId).eq('lang', authorLanguage(seg)).eq('template_version', tv).maybeSingle();
  if (rErr) throw new Error(rErr.message);
  if (!row || row.status !== 'ready' || !row.r2_key) return null;
  return { url: await getPresignedUrl(buildR2PublicUrl(row.r2_key)), asset_kind: 'lesson', version_stamp: tv };
}

module.exports = { isGbLessonId, listGrades, listSubjects, listChapters, listLessons, lessonPdfUrl };
