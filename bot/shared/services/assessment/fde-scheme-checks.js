'use strict';
/**
 * Two key checks the Grade 3-5 re-ask path asks again (bd-5jmnfj.4.58).
 *
 * v34 G5 English Q1(b) i, ii, v: a simile or metaphor is the child's own sentence, yet the key had one model
 * sentence and no accept line, so a teacher had nothing to mark a different good answer against. An open item
 * (the stem asks for the child's own sentence, example or meaning) needs at least two accept entries; a missing
 * or null scheme counts as none. A rubric of two or more points IS the marking rule, so a rubric-scored answer
 * (a flow chart, a four-mark explanation) is not flagged, and a bare Urdu «مثال» (example) does not open a stem:
 * most Social Studies long answers carry it (bd-5jmnfj.4.58.7.5).
 *
 * v34 G5 Maths Q2 ii: a common_error "such as 523,... instead of 486,418." is cut off mid-number. A common_error,
 * points[].text or accept[] entry that ends in an ellipsis, a comma, a dash, an opening bracket or an operator, or
 * ends mid-number, or has "digit, comma, ellipsis" inside it, is cut off. A numeric common_error that is the
 * item's own answer is not an error.
 *
 * Shortfall rows: { slot, reason: 'answer', items: ['<question> → <answer> (<what is wrong>)'] }, one a slot.
 * Pure: no I/O, never throws.
 */

const OPEN_STEM = new RegExp([
  String.raw`\byour own\b`, String.raw`\ba sentence\b`, String.raw`\bin your own words\b`,
  String.raw`\bwhat does\b[^?]*\bmean\b`, String.raw`\ban example\b`,
  'اپنے الفاظ', 'جملہ بنائیں',
].join('|'), 'i');
// A figurative term is open only when the child is asked to produce it.
const FIGURE = /\b(?:simile|metaphor|personification|idiom)\b/i;
const PRODUCE = /\b(?:rewrite|write|use|make|change|complete)\b/i;

const OPEN_MSG = '(an open answer needs an accept line: at least two acceptable forms or the marking rule)';
const END_CUT = /(?:…|\.\.\.|,|[-–—]|[([{]|[+−×÷=]|\d,\d{1,2})\s*$/;
const MID_CUT = /\d,\s*(?:\.\.\.|…)/;
const NUMBER = /^\s*(?:Rs\.?|₹|\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:[A-Za-z%]{1,8}\.?)?\s*\.?\s*$/;

const text = (v) => (v === null || v === undefined ? '' : String(v));

function items(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => items(n, out));
  else if (node && typeof node === 'object') {
    if (typeof node.slot === 'string' && (node.question || node.main_question)) out.push(node);
    Object.values(node).forEach((v) => { if (v && typeof v === 'object') items(v, out); });
  }
  return out;
}

const rows = (found) => {
  const by = new Map();
  for (const { slot, line } of found) {
    if (!by.has(slot)) by.set(slot, { slot, reason: 'answer', items: [] });
    by.get(slot).items.push(line);
  }
  return [...by.values()];
};

function isOpen(item) {
  if (Array.isArray(item.options) && item.options.length) return false;
  const stem = `${text(item.main_question)} ${text(item.question)}`;
  return OPEN_STEM.test(stem) || (FIGURE.test(stem) && PRODUCE.test(stem));
}

const label = (q) => `${text(q.question) || text(q.main_question)} → ${text(q.answer)}`;

function openItemsWithoutAccept(examJson, P) { // eslint-disable-line no-unused-vars
  const found = [];
  for (const q of items(examJson)) {
    if (!isOpen(q)) continue;
    const points = q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [];
    if (points.filter((p) => p && text(p.text).trim()).length >= 2) continue; // a rubric is the marking rule
    const accept = q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept : [];
    const forms = new Set(accept.map((a) => text(a).trim().toLowerCase()).filter(Boolean));
    if (forms.size < 2) found.push({ slot: q.slot, line: `${label(q)} ${OPEN_MSG}` });
  }
  return rows(found);
}

const bare = (s) => {
  const m = NUMBER.exec(text(s));
  return m ? m[1].replace(/,/g, '') : null;
};

function cutOffScheme(examJson, P) { // eslint-disable-line no-unused-vars
  const found = [];
  for (const q of items(examJson)) {
    const s = q.scheme;
    if (!s || typeof s !== 'object') continue;
    const fields = [['common_error', s.common_error]]
      .concat((Array.isArray(s.points) ? s.points : []).map((p, i) => [`points[${i}].text`, p && p.text]))
      .concat((Array.isArray(s.accept) ? s.accept : []).map((a, i) => [`accept[${i}]`, a]));
    for (const [field, v] of fields) {
      const t = text(v).trim();
      if (t && (END_CUT.test(t) || MID_CUT.test(t))) found.push({ slot: q.slot, line: `${label(q)} (${field} is cut off: "${text(v)}")` });
    }
    const ce = bare(s.common_error);
    if (ce !== null && ce === bare(q.answer)) found.push({ slot: q.slot, line: `${label(q)} (common_error equals the answer: "${text(s.common_error)}")` });
  }
  return rows(found);
}

const schemeShortfall = (examJson, P) => [...openItemsWithoutAccept(examJson, P), ...cutOffScheme(examJson, P)];

/** The re-ask paragraph for the 'answer' rows, or null when there are none. */
function schemeNote(shortfall) {
  const lines = (Array.isArray(shortfall) ? shortfall : []).filter((r) => r && r.reason === 'answer').flatMap((r) => r.items || []);
  if (!lines.length) return null;
  return `These marking-scheme lines need fixing: ${lines.join('; ')}. `
    + 'An open answer (the child writes their own sentence, example or meaning) gets an accept line of at least two different acceptable forms, or the rule the teacher marks by. '
    + 'Write every common_error, point and accept entry out in full: no "...", no trailing comma or operator, no half-written number, and a common_error is never the right answer.';
}

module.exports = { openItemsWithoutAccept, cutOffScheme, schemeShortfall, schemeNote };
