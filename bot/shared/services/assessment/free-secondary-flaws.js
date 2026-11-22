'use strict';
/**
 * bd-5jmnfj.38.35 — three faults the panel of 2026-11-06 found on G6-8 free papers that the per-item
 * checks let through. Pure: reads entries of free-secondary-checks.items(), no I/O.
 *
 *   keySkewIssues          A7a  the key is the longest (or equal longest) option in many MCQs of one paper:
 *                               a test-wise cue even when no single item is 1.2x longer (G8 Urdu, G7 Science)
 *   unprintedReferenceIssue A5a a stem points at a list, table, word box or figure the paper does not print
 *                               (G8 Urdu Q15 "سبق کی فہرست میں سے")
 *   bandIssue              A7c  marking bands whose marks overlap, repeat, or stop short of the item's marks,
 *                               or two bands with the same descriptor (G7 Science Q17)
 * Each is raised as an ordinary issue, so the targeted rewrite takes it.
 */

const { keyIndex, textOf } = require('./free-secondary-keys');

// A key is "longest" at this share of a paper's MCQs, with at least this many (chance alone gives about a quarter).
const SKEW = { minCount: 3, share: 0.4 };
const LIST_FIELDS = ['options', 'words', 'column_a', 'column_b'];
const NUMERIC = /^[\d\s.,%+\-−/۰-۹]+$/;

/** MCQ entries with a readable key and words (not numbers) for options, with where the key stands. */
function lengthRows(all) {
  return all.filter((e) => e.isMcq).map((e) => {
    const k = keyIndex(e.item);
    const texts = e.item.options.map(textOf);
    if (k < 0 || texts.every((t) => NUMERIC.test(t))) return null;
    const others = texts.filter((_, i) => i !== k).map((t) => t.length);
    return { n: e.n, longest: texts[k].length >= Math.max(...others) };
  }).filter(Boolean);
}

/** One issue for each MCQ whose key is the longest option, when that is true of too many MCQs in the paper. */
function keySkewIssues(all) {
  const rows = lengthRows(all);
  const hits = rows.filter((r) => r.longest);
  if (hits.length < SKEW.minCount || hits.length / rows.length <= SKEW.share) return [];
  return hits.map((r) => ({ n: r.n, check: 'longest-key',
    text: `its key is the longest option, as in ${hits.length} of ${rows.length} MCQs on this paper; make the four options the same length and detail` }));
}

const NOUN = '(?:word\\s+)?(?:list|table|box|bank|diagram|figure|picture|graph|chart|map)';
const EN_REF = new RegExp([
  `\\b(?:from|in|using|use|see|given|above|below|following|shown)\\s+(?:in\\s+)?the\\s+${NOUN}\\b`,
  `\\b(?:given|above|following)\\s+${NOUN}\\b`,
  `\\b${NOUN}\\s+(?:above|below|shown|given|in the (?:lesson|book|chapter|text))\\b`,
  "\\bthe (?:lesson|book|chapter|text)'?s?\\s+(?:word\\s+)?(?:list|table)",
].join('|'), 'i');
const UR_REF = /فہرست\s*(?:میں\s*)?سے|(?:دی گئی|دیے گئے|دیا گیا|مندرجہ بالا|اوپر دی گئی)\s*(?:فہرست|جدول|تصویر|نقشہ|خاکہ)|(?:سبق|کتاب|باب|متن)\s*(?:کی|کے|میں)\s*(?:دی گئی\s*)?(?:فہرست|جدول)/;

/** The stem prints what it points at: a list field, a table, or a colon followed by an enumeration. */
function printedInline(item) {
  if (LIST_FIELDS.some((f) => Array.isArray(item[f]) && item[f].length)) return true;
  const q = String(item.question || '');
  if (q.includes('|')) return true;
  const after = q.split(/[:：]/).slice(1).join(':');
  return (after.match(/[,،;؛\n]/g) || []).length >= 2;
}

/** A line naming the missing list, or null when the item points at nothing or prints what it points at. */
function unprintedReferenceIssue(e) {
  const q = String(e.item.question || '');
  if (!EN_REF.test(q) && !UR_REF.test(q)) return null;
  if (printedInline(e.item)) return null;
  return 'its stem refers to a list, table or figure that is not printed on the paper; print the words in the stem, or ask without the reference';
}

const digits = (s) => String(s).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const plain = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** "1-2" -> [1, 2], "3" -> [3, 3]; null when the marks are not numbers. */
function range(marks) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:[-–—]|to)?\s*(\d+(?:\.\d+)?)?\s*$/.exec(digits(marks));
  return m ? [Number(m[1]), Number(m[2] === undefined ? m[1] : m[2])] : null;
}

// A descriptor that penalises a missing element ("weak/missing reasoning", "no reasoning", "دلیل کمزور").
const LACK = '(?:no|missing|weak|without|lacks?|lacking|poor|absent|نہیں|بغیر|کمزور|غلط|نامکمل|ناقص)';
const THING = '(?:reasoning|explanation|reason|justification|working|دلیل|وجہ|وضاحت|استدلال)';
const W = (re) => `(?<!\\p{L})${re}(?!\\p{L})`; // \\b does not see Urdu letters
const MISSING_ELEMENT = new RegExp(`${W(LACK)}[^.;۔]{0,30}${THING}|${THING}[^.;۔]{0,30}${W(LACK)}`, 'iu');

/** What is wrong with a written item's bands, as one line, or null. */
function bandIssue(e) {
  const total = Number(e.item.marks) || 0;
  const bands = Array.isArray(e.item.mark_bands) ? e.item.mark_bands : [];
  if (e.isMcq || total < 2 || bands.length < 2) return null;
  const spans = bands.map((b) => range(b && b.marks));
  if (spans.some((s) => !s)) return null;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  if (sorted.some((s, i) => i > 0 && s[0] <= sorted[i - 1][1])) {
    return `its mark bands overlap (${bands.map((b) => b.marks).join(' / ')}); give each band its own marks, from ${total} down to 0, so that an answer fits exactly one band`;
  }
  const top = sorted[sorted.length - 1][1];
  if (top !== total) return `its mark bands reach ${top} marks, not the item's ${total} marks; the full band is worth ${total}`;
  const seen = new Set(bands.map((b) => plain(b.descriptor)));
  if (seen.size < bands.length) return 'two of its mark bands have the same descriptor; say what separates one band from the next';
  const lacking = bands.filter((b) => MISSING_ELEMENT.test(String(b.descriptor || '')));
  if (lacking.length > 1) {
    return `its mark bands (${lacking.map((b) => b.marks).join(' and ')}) both penalise the same missing element (${lacking.map((b) => `"${b.descriptor}"`).join(' / ')}), so one answer fits both; let each band lose a different thing, e.g. the middle band keeps the prediction but gives no reason, the lowest band has no correct prediction`;
  }
  return null;
}

module.exports = { keySkewIssues, unprintedReferenceIssue, bandIssue, SKEW };
