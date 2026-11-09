'use strict';
/**
 * A lesson's key → its grade and subject: ONE reader for every lesson-id shape NIETE serves (bd-97daxo.16).
 *
 * Four parsers (lp-engagement, coach-school-card, coaching subject-resolution, lp-quiz-digest) each knew only ICT's
 * `grade_<n>_…` ids, so another region's lessons dropped out of every grade and subject breakdown. Each now reads
 * through here and keeps its own return contract.
 *
 * THE SHAPES (`subject` is the id's own token — `math`, `social_studies_en`, `pak_studies_english`; each caller maps
 * it through its own subject vocabulary)
 *
 *   catalogue  a K-5 catalogue lesson id (bot/data/lp_catalog.json; niete_lp_assets, lesson_plans.content.v8,
 *              niete_lp_opens 'k5'):
 *                ICT           grade_<n>_<subject>_ch<m>_seg<k>[b]             grade_4_social_studies_en_ch5_seg2
 *                a curriculum  <curriculum>_grade_<n>_<subject>_ch<m>_seg<k>[b] nbf_snc_grade_3_maths_ch1_seg1
 *                              (build-lp-catalog: a non-ICT book's stem starts with its curriculum)
 *                a region      <region>_g<n>_<subject>_ch[R]<m>_seg<k>[b]      gb_g1_english_ch1_seg1
 *                              (the book-first lane, sync-sheet-lps; chR<m> is a revision chapter)
 *   segment    a segment-lane id (niete_lp612_segments.segment_id):
 *                ICT 6-12      grade_<n>_<subject>.<rest>                     grade_8_mathematics.c05.p071-073
 *                              (.c05 most, .p1c01 Urdu by part, .s903 / .r990 single pages; a combined grade_9_10_
 *                              book reads as its first grade)
 *                a curriculum  <curriculum>_grade_<n>_<subject>.<rest>         nbf_snc_grade_3_maths.c04.s002
 *                              (GB's NBF Grades 1-5 on the v10 lane — lp612-lifecycle's `(?:nbf_snc_)?` idea)
 *
 * KIND — which shapes are a plan of which kind (niete_lp_opens.plan_kind):
 *   k5    a catalogue id; or a curriculum's segment id, because GB's K-5 lane lists its segments AS lesson ids
 *         (gb-k5-browse) and the app records their opens as 'k5'. An ICT segment id is never a K-5 plan.
 *   g612  a segment id.
 *   any other kind reads nothing.
 *
 * ICT's own ids read exactly as the four parsers this replaces read them (tests/region/lesson-ref.test.js sweeps
 * every ICT id in the committed catalogue through the old regexes and this): the ICT patterns below are theirs,
 * and every new pattern needs a prefix no ICT id carries.
 *
 * Pure, synchronous, no dependencies: the dashboard requires it from bot/ as it does other pure bot modules.
 */

// A curriculum key as it prefixes a non-ICT book's ids: nbf_snc.
const CURRICULUM = '[a-z]+(?:_[a-z]+)*';

/** ICT's K-5 id, behind an optional curriculum prefix. */
const CATALOGUE = new RegExp(`^(?:(${CURRICULUM})_)?grade_(\\d{1,2})_(.+?)_ch\\d+_seg\\d+b?$`, 'i');
/** A region's book-first id: gb_g<n>_… (the same `<region>_g<n>_` prefix teacher-books reads book keys by). */
const REGION_CATALOGUE = /^([a-z]+)_g(\d{1,2})_(.+?)_chR?\d+_seg\d+b?$/i;
/** A segment id, behind an optional curriculum prefix. */
const SEGMENT = new RegExp(`^(?:(${CURRICULUM})_)?grade_(\\d{1,2})_(?:\\d{1,2}_)?([a-z0-9_]+?)\\.`, 'i');

const KINDS = Object.freeze(['k5', 'g612']);

const hit = (m, shape) => ({ grade: Number(m[2]), subject: m[3], shape, prefix: m[1] || null });

function catalogue(ref) {
  const m = CATALOGUE.exec(ref) || REGION_CATALOGUE.exec(ref);
  return m ? hit(m, 'catalogue') : null;
}

function segment(ref) {
  const m = SEGMENT.exec(ref);
  return m ? hit(m, 'segment') : null;
}

/**
 * @param {*} ref a lesson id, plan_ref or segment id
 * @param {{kind?: 'k5'|'g612'}} [opts] kind: read only the shapes a plan of that kind can have (see KIND above)
 * @returns {{grade: number, subject: string, shape: 'catalogue'|'segment', prefix: string|null}|null}
 *   prefix: the curriculum (`nbf_snc`) or region (`gb`) the id is namespaced by; null for ICT. Null when no shape
 *   matches — never a partial.
 */
function parseLessonRef(ref, { kind } = {}) {
  if (typeof ref !== 'string') return null;
  const r = ref.trim();
  if (!r) return null;
  if (kind === undefined) return catalogue(r) || segment(r);
  if (!KINDS.includes(kind)) return null;
  if (kind === 'g612') return segment(r);
  const cat = catalogue(r);
  if (cat) return cat;
  const seg = segment(r);
  return seg && seg.prefix ? seg : null;
}

module.exports = { parseLessonRef };
