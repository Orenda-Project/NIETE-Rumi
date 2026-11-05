'use strict';
/**
 * The GB K-5 subject screen (bd-rj6w0n.14.5): every allow-listed book for the grade, in menu order.
 *
 * A book whose plans are ready keeps the catalogue's normal row (step lp612_subject). Any other book,
 * including one whose segments are imported but have no ready render yet, is listed as "Coming Soon"
 * with step lp612_gb_soon, which the endpoint refuses: the row can be seen but never opened.
 * Only reached for a GB teacher while LP_GB_K5_ENABLED is on.
 */
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');
const Lp612Catalog = require('./lp612-catalog.service');
const { NBF_SNC, gbK5BookFor, gbK5Subjects } = require('./lp612-curriculum.service');

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

/** Keys of the grade's allow-listed books holding at least one ready render. One limit-1 read per book. */
async function readyBookKeys(grade) {
  const g = Number(grade);
  const checks = gbK5Subjects(g).map(async (book) => {
    const { data, error } = await supabase.from('niete_lp612_renders')
      .select('segment_id, niete_lp612_segments!inner(subject)')
      .eq('status', 'ready')
      .eq('niete_lp612_segments.curriculum', NBF_SNC)
      .eq('niete_lp612_segments.grade', g)
      .eq('niete_lp612_segments.is_current', true)
      .in('niete_lp612_segments.subject', spellings(book.names))
      .limit(1);
    if (error) {
      logToFile('LP GB: readiness read failed, listing as Coming Soon', { grade: g, book: book.key, error: error.message });
      return [];
    }
    // Keep the key only if a returned subject really is this book (a mocked or loose read cannot widen it).
    return (data || []).map((r) => gbK5BookFor(g, r.subject || (r.niete_lp612_segments || {}).subject))
      .filter((b) => b && b.key === book.key).map((b) => b.key);
  });
  return new Set((await Promise.all(checks)).flat());
}

function comingSoonRow(book, grade, language) {
  return {
    id: `gb_soon_${book.key}`,
    'main-content': { title: book.title, description: resolveUx('lp612GbComingSoon', { language }) },
    'on-click-action': { name: 'data_exchange', payload: { step: SOON_STEP, grade: String(grade), subject: book.key } },
  };
}

/**
 * @param {number} grade  1-5
 * @param {{curriculum:'nbf_snc', language?:string}} opts
 * @param {{buildSubjectItems?:Function, readyBookKeys?:Function}} [deps]
 */
async function gbShelfItems(grade, opts, deps = {}) {
  const build = deps.buildSubjectItems || Lp612Catalog.buildSubjectItems;
  const ready = deps.readyBookKeys || readyBookKeys;
  const [items, readyKeys] = await Promise.all([build(grade, opts), ready(grade)]);
  const language = opts && opts.language;
  return gbK5Subjects(grade).map((book) => {
    const row = readyKeys.has(book.key)
      && items.find((i) => { const b = gbK5BookFor(grade, i.id); return b && b.key === book.key; });
    return row || comingSoonRow(book, grade, language);
  });
}

/** The answer to a tap on a Coming Soon row: refused, nothing opens. */
const refuseComingSoon = (language) => ({ data: { error: { message: resolveUx('lp612GbComingSoonTap', { language }) } } });

module.exports = { SOON_STEP, gbShelfItems, readyBookKeys, refuseComingSoon, spellings };
