// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Here: niete_gb_lp_renders is a copy of niete_lp612_renders (same FK, same unique key); it merges back first.
// Why, target model, follow-up (bd-42mo0w, audit planned): docs/lesson-plan-data-model-debt.md
'use strict';
/**
 * The GB K-5 lane for the portal/app (bd-rj6w0n.14): what a GB teacher's lesson-plan browse shows.
 *
 * The portal routes (/api/internal/lp/v8/*) read lp-v8-browse — ICT's catalogue plus the old GB v9 rows.
 * A GB teacher, with LP_GB_K5_ENABLED on, reads this instead: niete_lp612_segments (nbf_snc, current)
 * ∩ niete_gb_lp_renders that are ready at the current GB template version, in the book's language — the
 * same plans the WhatsApp Flow's GB shelf serves. A lesson is listed iff its PDF exists, as in v8, and
 * only the on-request books (English, Urdu, Maths, Science) are offered. Same response shapes as
 * lp-v8-browse; lesson ids are segment ids. There are no answer keys.
 */
const supabase = require('../config/supabase');
const { buildR2PublicUrl, getPresignedUrl } = require('../storage/r2');
const { NBF_SNC, GB_K5_GRADES, gbK5BookFor, gbOnRequestSubjects } = require('./lp612-curriculum.service');
const { authorLanguage } = require('./lp612-gb-delivery.service');
const { templateVersion } = require('./gb-lp-serving.service');

const SEGMENTS = 'niete_lp612_segments';
const RENDERS = 'niete_gb_lp_renders';
const PAGE = 1000;
const SEG_COLUMNS = 'segment_id, grade, subject, chapter_number, chapter_title, subtopic_title, menu_title, '
  + 'order_index, printed_page_start, printed_page_end, language';

const isGbLessonId = (id) => typeof id === 'string' && id.startsWith(`${NBF_SNC}_`);
const bookKey = (grade, book) => `gb_g${grade}_${book.key}`;

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

/** The ready lessons of the teacher's books, optionally for one grade. */
async function readyLessons(grade, bookKeys) {
  const listed = Array.isArray(bookKeys) ? new Set(bookKeys) : null;
  const segs = (await segments(grade)).filter((s) => !listed || listed.has(bookKey(s.grade, s.book)));
  const ready = await readyRenders(segs);
  return segs.filter((s) => ready.has(s.segment_id));
}

function pagesLabel(a, b) {
  if (!a && !b) return null;
  if (!b || a === b) return `p.${a}`;
  return `p.${a}-${b}`;
}

async function listGrades(bookKeys) {
  const lessons = await readyLessons(null, bookKeys);
  return GB_K5_GRADES
    .map((grade) => ({ grade, subject_count: new Set(lessons.filter((l) => l.grade === grade).map((l) => l.book.key)).size }))
    .filter((g) => g.subject_count > 0);
}

async function listSubjects(grade, bookKeys) {
  const lessons = await readyLessons(grade, bookKeys);
  return gbOnRequestSubjects(grade)
    .map((book) => ({
      subject_key: book.key, subject: book.title, rtl: book.key === 'urdu',
      lesson_count: lessons.filter((l) => l.book.key === book.key).length,
    }))
    .filter((s) => s.lesson_count > 0);
}

const byOrder = (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0) || a.segment_id.localeCompare(b.segment_id);

async function listChapters(grade, subjectKey, bookKeys) {
  const lessons = (await readyLessons(grade, bookKeys)).filter((l) => l.book.key === subjectKey);
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

async function listLessons(grade, subjectKey, chapterNumber, _userId = null, bookKeys = undefined) {
  const all = (await segments(grade))
    .filter((s) => s.book.key === subjectKey && Number(s.chapter_number) === Number(chapterNumber))
    .sort(byOrder);
  const ready = new Set((await readyLessons(grade, bookKeys)).map((l) => l.segment_id));
  return all
    .map((s, i) => ({ s, index: i + 1 }))
    .filter(({ s }) => ready.has(s.segment_id))
    .map(({ s, index }) => ({
      lesson_id: s.segment_id, segment_index: index, lp_type: 'content', day_label: null, section: null,
      topic: s.menu_title || s.subtopic_title || null,
      pages_label: pagesLabel(s.printed_page_start, s.printed_page_end), downloaded: false,
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
