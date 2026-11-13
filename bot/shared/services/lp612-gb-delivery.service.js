// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Here: niete_gb_lp_renders is a copy of niete_lp612_renders (same FK, same unique key); it merges back first.
// Why, target model, follow-up (audit planned): docs/lesson-plan-data-model-debt.md
'use strict';
/**
 * Serving a GB K-5 plan (bd-rj6w0n.14.7).
 *
 * GB has its own lane (bd-rj6w0n.14.16, gb-lp-serving.service): its own cache rows (niete_gb_lp_renders),
 * its own R2 prefix (gb-lp/), its own job (gb_lp_author). This module holds the GB-only decisions that lane
 * and 6-12's document send share: which segments are GB, which are GB K-5 (the v10 coach card with the v9
 * plan embedded), the language a plan is authored in (its BOOK's), and GB's caption.
 * There is no hosted card and no link message.

 * The curriculum guard is #4091's rule (book-curriculum.service): a teacher gets her curriculum's book
 * where it has one for the grade+subject, ICT's otherwise. So an nbf_snc (GB) plan never goes to an
 * ICT teacher, and an ICT plan goes to a GB teacher only where GB has no book of its own. Flag
 * LP_GB_K5_ENABLED off, nobody reads GB: only non-ICT plans are refused and no user is looked up, so
 * ICT serving is exactly today's.
 */
const { resolveUx } = require('../config/ux-strings');
const { isGbK5Enabled } = require('../config/lp612-flags');
const BookCurriculum = require('./book-curriculum.service');
const Lp612Catalog = require('./lp612-catalog.service');

/** A segment of a non-ICT curriculum (GB's nbf_snc); a row that does not say is ICT's. */
const isGbSegment = (segment) => BookCurriculum.curriculumOf(segment) !== BookCurriculum.ICT;
/** A GB grade 1-5 segment: authored as the v10 card with v9 embedded. GB 6-12 is design pending. */
const isGbK5Segment = (segment) => isGbSegment(segment) && Number(segment.grade) >= 1 && Number(segment.grade) <= 5;
/** The language a GB K-5 plan is authored and cached in: the book's own (one plan per lesson, no overlay). */
const authorLanguage = (segment) => (isUrduBook(segment) ? 'ur' : 'en');

/** True when this teacher must not be served this segment. Never throws (both helpers fail open to ICT). */
async function refusesCurriculum({ segment, userId }) {
  const own = BookCurriculum.curriculumOf(segment);
  if (!isGbK5Enabled()) return own !== BookCurriculum.ICT;
  const hers = await BookCurriculum.curriculumForUser(userId);
  if (own !== BookCurriculum.ICT) return own !== hers;
  if (hers === BookCurriculum.ICT) return false;
  // An ICT plan to a GB teacher: refused only where her curriculum has its own book for this grade+subject.
  return (await Lp612Catalog.curriculumOf(segment.grade, segment.subject, hers)) !== BookCurriculum.ICT;
}

// bd-rj6w0n.14.8 / bd-rj6w0n.5.8.9: an Urdu book speaks Urdu, and never shows a Latin title.
const isUrduBook = (segment) => !!segment && segment.language === 'ur';
const isUrduTitle = (t) => /[\u0600-\u06FF]/.test(t) && !/[A-Za-z]/.test(t);

/** The title on her message: an Urdu book's first Urdu title (topic, menu, then chapter), else none. */
function cardTitle(segment) {
  const s = segment || {};
  const titles = [s.subtopic_title, s.menu_title, s.chapter_title].map((t) => String(t || '').trim());
  if (!isUrduBook(s)) return titles[0] || titles[1] || '';
  return titles.find(isUrduTitle) || '';
}

/** The language her message goes in: an Urdu book's is Urdu (RTL) whatever the tap carried. */
const cardLanguage = (segment, lang) => (isUrduBook(segment) ? 'ur' : lang);

/** The caption on a GB card PDF; `subject` is already in the caption's language. No title, no title line. */
function cardCaption({ segment, lang, subject }) {
  return resolveUx('lp612GbCaption', {
    language: lang, params: { topic: cardTitle(segment), grade: segment.grade, subject },
  }).replace(/^\s+/, '');
}

module.exports = {
  isGbSegment, isGbK5Segment, authorLanguage, refusesCurriculum,
  cardTitle, cardLanguage, cardCaption,
};
