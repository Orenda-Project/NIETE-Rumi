'use strict';
/**
 * Marking points that pay for the wrong thing on a Grade 3-4 paper (bd-5jmnfj.33.4, the v32 review).
 * Only `.short` and `.grammar` items are read; the marks of a dropped point move to the last point that stays,
 * so an item's total never changes, and an item is never left with no point.
 *  S1 a point «X کا ذکر» where X is already in the question (G3 Urdu Q2 i, G4 Urdu Q2 i, ii, vi); a question
 *     with two asks joined by «اور» is skipped (G3 GK Q4 vi: «کب ... اور کس کوشش سے»);
 *  S2 a point that pays for form: a clear or full sentence, the word written in full, the rest of the sentence
 *     copied, the whole sentence or question written correctly (G3 Urdu Q2 iv, Q4; G3 GK Q4; G3 English Q2;
 *     G4 Urdu Q4; G4 English Q2);
 *  S5 a Science point for content the question never asks: an example, the ice, the ships, the metals, the
 *     first bend (G4 Science Q3 ii-vi); «Name», «two», «why», «how» and «explain» questions ask for more.
 * Islamiat, Social Studies, oral and picture items and every slot outside Grades 3-4 are left alone.
 * Pure: exam JSON in, `{examJson, notes}` out; an untouched item is the same object.
 */

const { restates, tools } = require('./fde-key-truth');

const MID = /^g[34]\./;
const SHAPES = /\.(short|grammar)$/;
const FORM = [
  /^(?:واضح|مکمل)(?:\s+اور\s+(?:واضح|مکمل))?\s+جملہ$/,
  /^مکمل\s+جملے\s+میں\s+جواب\s+دینا$/,
  /^(?:لفظ|فعل)\s+کو\s+(?:مکمل\s+اور\s+درست|مکمل)\s+لکھنا$/,
  /^مکمل\s+(?:درست\s+)?جواب$/,
  /^(?:the )?rest of the sentence (?:is )?(?:copied|written) correctly$/i,
  /^writes? the (?:whole|complete|full) (?:sentence|question) correctly$/i,
  /^(?:a )?(?:clear|complete)(?: and (?:clear|complete))? sentence$/i,
];
const TWO_ASKS = /\sاور\s/; // «کب ... اور کس کوشش سے»: a second ask, so a point naming it is not a restatement
const SCIENCE = /^g[34]\.science\./;
const ASKS_MORE = /\b(name|two|three|why|how|explain|example|list|give)\b/i;
const UNASKED = [
  /^gives an? (?:correct )?example\b/i,
  /^links this to\b/i,
  /^states that it keeps .*\bafloat\b/i,
  /^states that metals conduct\b/i,
  /\bwas (?:bent|stretched)\b.*\bfirst\b/i,
];

const eligible = (q) => tools.eligible(q) && SHAPES.test(q.slot) && Array.isArray(q.scheme && q.scheme.points) && q.scheme.points.length > 1;
const isForm = (p) => FORM.some((re) => re.test(String(p.text || '').trim()));
const isUnasked = (q, p) => SCIENCE.test(q.slot) && !ASKS_MORE.test(String(q.question || '')) && UNASKED.some((re) => re.test(String(p.text || '').trim()));

/** The item with the dropped points removed and their marks moved to the last point that stays. */
function fold(q, drop) {
  const keep = q.scheme.points.filter((p) => !drop(p));
  if (!keep.length || keep.length === q.scheme.points.length) return null;
  const moved = q.scheme.points.filter(drop).reduce((n, p) => n + (Number(p.marks) || 0), 0);
  const last = keep.length - 1;
  const points = keep.map((p, i) => (i === last ? { ...p, marks: (Number(p.marks) || 0) + moved } : p));
  return { ...q, scheme: { ...q.scheme, points } };
}

function shapeItem(q, notes) {
  if (!eligible(q)) return q;
  const rules = [
    ['form_point_folded', isForm],
    ['restating_point_folded', (p) => !TWO_ASKS.test(String(q.question || '')) && restates(q, p.text)],
    ['unasked_point_folded', (p) => isUnasked(q, p)],
  ];
  return rules.reduce((cur, [reason, drop]) => {
    const next = fold(cur, drop);
    if (!next) return cur;
    notes.push({ slot: q.slot, reason, dropped: cur.scheme.points.filter(drop).map((p) => p.text) });
    return next;
  }, q);
}

/** `{examJson, notes}`: the paper with the three point rules above applied. */
function schemeShape(examJson) {
  const notes = [];
  const unseen = Object.fromEntries(Object.entries((examJson && examJson.unseen) || {}).map(([cat, byType]) => [cat,
    Object.fromEntries(Object.entries(byType || {}).map(([type, list]) => [type,
      Array.isArray(list) ? list.map((q) => shapeItem(q, notes)) : list]))]));
  return { examJson: { ...examJson, unseen }, notes };
}

module.exports = { schemeShape };
