'use strict';
/**
 * Two G5 English key mends from the v35 round-5 review (bd-5jmnfj.4.58), called from langFixes in fde-g5-lang-fixes.js.
 *
 * - Q1(b) i-iii (a simile or metaphor the child writes): the key had one model sentence and no accept line, so a
 *   marker had no rule for a different good answer. fde-scheme-checks sees these items, but the re-ask runs once and its
 *   reply is not checked again, so a writer that leaves the line out twice reaches the paper. The mend adds the rule as
 *   a second accept entry, worded by the direction the stem gives.
 * - Q3 (Punctuate): a point that pays the apostrophe of a word the printed passage already shows with its apostrophe
 *   (v35: "friends it's time", key "Apostrophe correctly used in it's") is dropped, its mark joins the first point,
 *   and the apostrophe clause leaves the common error. A point naming "exclamation mark and question mark" fails a child
 *   who ends the statement with a full stop; it becomes one that accepts either.
 *
 * Pure: item in, item out; never throws.
 */

const FIGURE = /\b(?:simile|metaphor)\b/i;
const text = (v) => (v === null || v === undefined ? '' : String(v));

function ruleFor(question) {
  const stem = text(question);
  if (/metaphor/i.test(stem)) return "Any other correct metaphor on the same idea: one thing said to be another, with no 'like' or 'as'";
  if (/as\s*(?:\.\.\.|…)\s*as/i.test(stem)) return "Any other whole sentence that uses 'as … as' for a fitting comparison";
  if (/\blike\b/i.test(stem.replace(/^[^(]*/, ''))) return "Any other whole sentence that uses 'like' for a fitting comparison";
  return "Any other whole sentence that compares with 'as' or 'like' and fits";
}

function acceptRule(q, notes) {
  if (Array.isArray(q.options) && q.options.length) return q;
  if (!FIGURE.test(text(q.question)) || !/\b(?:rewrite|write|use|make|change|complete)\b/i.test(text(q.question))) return q;
  const s = q.scheme && typeof q.scheme === 'object' ? q.scheme : {};
  const points = Array.isArray(s.points) ? s.points.filter((p) => p && text(p.text).trim()) : [];
  const accept = Array.isArray(s.accept) ? s.accept : [];
  const forms = new Set(accept.map((a) => text(a).trim().toLowerCase()).filter(Boolean));
  if (points.length >= 2 || forms.size >= 2) return q;
  notes.push(`${q.slot}: added an accept rule to an open simile/metaphor item that had none`);
  const model = text(q.answer).trim();
  return { ...q, scheme: { ...s, accept: [model, ruleFor(q.question)] } };
}

const APOSTROPHE = /apostrophe/i;
const END_MARKS = /exclamation/i;
const CLAUSE = /^\s*(?:leaving out|omitting|missing|forgetting)[^.]*?apostrophe[^.]*?(?:\s+or\s+|\.\s*$)/i;

function punctuation(q, notes) {
  const s = q.scheme && typeof q.scheme === 'object' ? q.scheme : null;
  const points = s && Array.isArray(s.points) ? s.points : null;
  if (!points) return q;
  let out = points.map((p) => (p && END_MARKS.test(text(p.text)) && /question mark/i.test(text(p.text))
    ? { ...p, text: 'End marks correct: a question mark after the direct question, a full stop or an exclamation mark after the other sentences' } : p));
  let common = s.common_error;
  if (/['’]/.test(text(q.question)) && out.some((p) => p && APOSTROPHE.test(text(p.text)))) {
    const gone = out.filter((p) => p && APOSTROPHE.test(text(p.text)));
    const kept = out.filter((p) => !(p && APOSTROPHE.test(text(p.text))));
    if (kept.length) {
      const moved = gone.reduce((sum, p) => sum + (Number(p.marks) || 0), 0);
      notes.push(`${q.slot}: dropped the apostrophe marking point (${moved} mark moved to the first point); the printed passage already shows the apostrophe`);
      out = [{ ...kept[0], marks: (Number(kept[0].marks) || 0) + moved }, ...kept.slice(1)];
      if (typeof common === 'string' && CLAUSE.test(common)) {
        const rest = common.replace(CLAUSE, '').trim();
        common = rest ? rest[0].toUpperCase() + rest.slice(1) : null;
      }
    }
  }
  return { ...q, scheme: { ...s, points: out, common_error: common } };
}

/** `slot` is the item's layout slot (may be undefined). */
function mendLangKey(q, slot, notes) {
  if (!q || typeof q !== 'object' || !slot) return q;
  if (q.slot === 'english.A.Q1b') return acceptRule(q, notes);
  if (q.slot === 'english.C.Q3') return punctuation(q, notes);
  return q;
}

module.exports = { mendLangKey };
