'use strict';
/**
 * bd-5rz1v.15 — what a lesson plan IS, by its stable key, for both grade bands.
 *
 * The portal's activity lists (her recent lesson plans, the Home's "Lesson plans used") hold only
 * a plan key: `k5` + a catalogue lesson_id, or `g612` + a niete_lp612_segments.segment_id. The
 * portal holds no catalogue of its own, so it asks here, over POST /api/internal/lp/describe, and
 * gets the same names WhatsApp uses:
 *
 *   k5    data/lp_catalog.json via lp-v8-catalog.lessonById — the Flow's own catalogue. Title is
 *         the lesson's topic (else its section), the same label the portal's lesson list shows.
 *   g612  niete_lp612_segments — subtopic_title (else menu_title), as "My lesson plans" names it.
 *         ONE read for all of them (`in`), whatever the count, and NOT limited to the servable
 *         set: a plan she used last month that has since been superseded is still hers to see
 *         named. `current` says whether it can still be opened from the catalogue.
 *
 * Answers in the order asked, one entry per plan; a plan the catalogue does not know is answered
 * `found: false` rather than dropped, so the caller keeps its place in the list.
 */

const KINDS = new Set(['k5', 'g612']);
const LANGS = new Set(['en', 'ur']);
const MAX_PLANS = 200;

class DescribeInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DescribeInputError';
    this.status = 400;
  }
}

/** Validate the request body's plan list. Throws DescribeInputError. */
function parsePlans(plans) {
  if (!Array.isArray(plans)) throw new DescribeInputError('plans must be a list');
  if (plans.length > MAX_PLANS) throw new DescribeInputError(`at most ${MAX_PLANS} plans at once`);
  return plans.map((p) => {
    const kind = p && p.kind;
    const ref = p && typeof p.ref === 'string' ? p.ref.trim() : '';
    if (!KINDS.has(kind)) throw new DescribeInputError('each plan needs kind k5 or g612');
    if (!ref || ref.length > 200) throw new DescribeInputError('each plan needs a ref');
    return { kind, ref, lang: kind === 'g612' && LANGS.has(p.lang) ? p.lang : null };
  });
}

function pagesLabel(start, end) {
  if (start == null) return null;
  return end != null && end !== start ? `p.${start}-${end}` : `p.${start}`;
}

function describeK5(plan, lessonById) {
  const hit = lessonById(plan.ref);
  if (!hit) return { ...plan, found: false };
  const { lesson, chapter, book } = hit;
  return {
    ...plan,
    found: true,
    title: lesson.topic || lesson.section || `Lesson ${lesson.segment_index}`,
    grade: book.grade,
    subject: book.subject,
    subjectKey: book.subject_key,
    chapterNumber: chapter.number,
    chapterTitle: chapter.title || null,
    dayLabel: lesson.day_label || null,
    pagesLabel: lesson.pages_label || null,
  };
}

async function segmentsById(ids, supabase) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('niete_lp612_segments')
    .select('segment_id, grade, subject, chapter_number, chapter_title, subtopic_title, menu_title, '
      + 'printed_page_start, printed_page_end, is_current')
    .in('segment_id', ids);
  if (error) throw new Error(`lp describe: segment lookup failed: ${error.message}`);
  return new Map((data || []).map((r) => [r.segment_id, r]));
}

function describeG612(plan, segments) {
  const s = segments.get(plan.ref);
  if (!s) return { ...plan, found: false };
  return {
    ...plan,
    found: true,
    title: s.subtopic_title || s.menu_title || null,
    grade: s.grade,
    subject: s.subject,
    chapterNumber: s.chapter_number ?? null,
    chapterTitle: s.chapter_title || null,
    dayLabel: null,
    pagesLabel: pagesLabel(s.printed_page_start, s.printed_page_end),
    current: s.is_current !== false,
  };
}

/**
 * @param {Array<{kind, ref, lang?}>} plans  already parsed (parsePlans)
 * @param {{ supabase?, lessonById? }} [deps]
 */
async function describePlans(plans, deps = {}) {
  const supabase = deps.supabase || require('../config/supabase');
  const lessonById = deps.lessonById || require('./lp-v8-catalog.service').lessonById;
  const segIds = [...new Set(plans.filter((p) => p.kind === 'g612').map((p) => p.ref))];
  const segments = await segmentsById(segIds, supabase);
  return plans.map((p) => (p.kind === 'k5' ? describeK5(p, lessonById) : describeG612(p, segments)));
}

module.exports = { describePlans, parsePlans, DescribeInputError, MAX_PLANS };
