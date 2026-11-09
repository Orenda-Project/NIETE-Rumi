// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Here: niete_gb_lp_renders is a copy of niete_lp612_renders (same FK, same unique key); it merges back first.
// Why, target model, follow-up (bd-42mo0w, audit planned): docs/lesson-plan-data-model-debt.md
'use strict';
/**
 * The GB K-5 subject screen (bd-rj6w0n.14.5, bd-rj6w0n.14.16): the grade's on-request books (English,
 * Urdu, Maths, Science), in menu order. GK, SST and Islamiat are not listed at all.
 *
 * GB plans are written on request, so a book whose lessons are in the catalogue keeps the catalogue's
 * normal row (step lp612_subject); no ready render is needed and no render table is read. An on-request
 * book with no lessons yet is listed as "Coming Soon" with step lp612_gb_soon, which the endpoint refuses.
 * Only reached for a GB teacher while LP_GB_K5_ENABLED is on.
 *
 * bd-rj6w0n.14.17 — her region's book list (bd-97daxo.4), when it has one, says which on-request books she has:
 * one it does not name is left off. Any book the list names comes back as Coming Soon until its lessons land,
 * then as its catalogue row, so a newly segmented book needs no code change here.
 */
const { resolveUx } = require('../config/ux-strings');
const Lp612Catalog = require('./lp612-catalog.service');
const { gbK5BookFor, gbOnRequestSubjects } = require('./lp612-curriculum.service');

const SOON_STEP = 'lp612_gb_soon';

const titleWords = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/** The raw spellings a normalised allow-list name may carry in segments.subject ('Social Studies', 'GK'). */
function spellings(names) {
  const out = new Set();
  for (const n of names) {
    const words = n.split('_');
    out.add(n);
    out.add(words.join(' '));
    out.add(words.map(titleWords).join(' '));
    out.add(words.map(titleWords).join('_'));
    out.add(n.toUpperCase());
  }
  return [...out];
}

function comingSoonRow(book, grade, language) {
  return {
    id: `gb_soon_${book.key}`,
    'main-content': { title: book.title, description: resolveUx('lp612GbComingSoon', { language }) },
    'on-click-action': { name: 'data_exchange', payload: { step: SOON_STEP, grade: String(grade), subject: book.key } },
  };
}

/** GB's key for an on-request book of a grade, as the region book list and the sheet name it (gb_g3_english). */
const gbBookKey = (grade, book) => `gb_g${grade}_${book.key}`;

/**
 * @param {number} grade  1-5
 * @param {{curriculum:'nbf_snc', language?:string, bookKeys?:string[]|null}} opts
 * @param {{buildSubjectItems?:Function}} [deps]
 */
async function gbShelfItems(grade, opts, deps = {}) {
  const build = deps.buildSubjectItems || Lp612Catalog.buildSubjectItems;
  const items = await build(grade, opts);
  const language = opts && opts.language;
  const listed = opts && Array.isArray(opts.bookKeys) ? new Set(opts.bookKeys) : null;
  const books = gbOnRequestSubjects(grade).filter((book) => !listed || listed.has(gbBookKey(grade, book)));
  return books.map((book) => {
    const row = items.find((i) => { const b = gbK5BookFor(grade, i.id); return b && b.key === book.key; });
    return row || comingSoonRow(book, grade, language);
  });
}

/** The answer to a tap on a Coming Soon row: refused, nothing opens. */
const refuseComingSoon = (language) => ({ data: { error: { message: resolveUx('lp612GbComingSoonTap', { language }) } } });

module.exports = { SOON_STEP, gbBookKey, gbShelfItems, refuseComingSoon, spellings };
