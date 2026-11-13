'use strict';
/**
 * the AI reviewer's rules for a teacher's own plan (pure: no I/O, no model call).
 *
 * GATE V2, as the lesson-plan production gate states it: a plan PASSES when
 *   - no check is rated 1 ("missing"),
 *   - the key checks (7B academic content accuracy, 5D exit ticket) are each rated >= 3,
 *   - the judge % (points over 4 per assessed check) is >= 85. Within 1.5 of the bar the plan is scored once more
 *     and the mean of the two decides.
 *
 * THE SCORE DECIDES ONLY SHARED-LIBRARY ELIGIBILITY. She always gets her plan: nothing here is read on her path.
 * The 42 checks are the universal criteria 0–7 of the reviewer rubric v3; the model rates each 1–4 or null
 * (cannot be judged from the plan, which shrinks the denominator and never counts against it).
 *
 * bd-snkn32.46 — the model now reads each check's requirement and 1-4 descriptors, the ICT rules, and the plan
 * subject's own checks (criterion 8 + research 9) from lp612-own-rubric; Science also needs 9B >= 3 (mustFor), as
 * production gate v2's SUBJECT_MUST does. The bar itself is unchanged.
 */
const rubric = require('./lp612-own-rubric');

const BAR = 85;
const BAND = 1.5;
const KEY_CHECKS = ['7B', '5D'];

const CHECKS = [
  ['0A', 'SLO present and non-empty'], ['0B', 'Hook present and non-empty'], ['0C', 'Explanation present and non-empty'],
  ['0D', 'Practice present and non-empty'], ['0E', 'Conclusion present and non-empty'],
  ['0F', 'Single-lesson scope (one class period)'],
  ['1B', 'Measurable SLO'], ['1C', 'Scaffolded activities'], ['1D', 'Aligned with textbook content'],
  ['1E', 'SLO-assessment alignment and phase coherence'],
  ['2A', 'Opening hook relevant to SLO'], ['2B', 'Explicit instructions and evidence-based feedback language'],
  ['2C', 'Modelling / demonstration with think-aloud'], ['2D', 'Smooth transitions across steps'],
  ['2E', 'Practice opportunities for students'], ['2F', 'CFU questions: placed, spaced and open-ended'],
  ['2G', 'Grade-appropriate strategies aligned with SLO'], ['2H', 'Higher-order thinking opportunities'],
  ['2I', 'Visual aid effectiveness'], ['2J', 'Gradual release: I do, we do, you do'], ['2K', 'Prior knowledge activation'],
  ['2L', 'Active retrieval (warm-up recall)'],
  ['3A', 'Appropriately timed sections'], ['3B', 'Adequate time for practice and explanation'],
  ['3C', 'Teacher support materials'], ['3D', 'Resource requirements'], ['3E', 'Teacher flexibility, no over-scripting'],
  ['4A', 'Suggestions for struggling and advanced students'], ['4B', 'Named differentiation strategies with instructions'],
  ['4C', 'Instructional language for students'], ['4D', 'Instructional language for teachers'],
  ['5A', 'Active student participation'], ['5B', 'Peer interaction opportunities'], ['5C', 'Real-world application'],
  ['5D', 'Exit ticket: new context, success criteria and self-prediction'],
  ['6A', 'Contextually relevant content'], ['6B', 'Inclusive and diverse representation'],
  ['6C', 'Student voice and cultural connection'], ['6D', 'Language and cultural sensitivity'],
  ['7A', 'Internal consistency and plausible textbook references'], ['7B', 'Academic content accuracy'],
  ['7C', 'Bias and balance'],
].map(([id, name]) => ({ id, name }));
const IDS = rubric.ALL_IDS;
/** Production gate v2's SUBJECT_MUST: a subject check that must be >= 3 when rated (null = not this lesson's type). */
const SUBJECT_MUST = { SCIENCE: ['9B'] };

/**
 * bd-snkn32.42 — the 6-12 universal criteria fitted to a grades 1-5 own plan (a slide script: hook / iDo / weDo /
 * youDo / wrap). Two checks cannot be shown by that script and are null (left out of the score), never scored low:
 * 2I visual aids (the script carries no picture) and 1D textbook alignment (no book text is given to the reviewer).
 */
const NOT_ASSESSABLE_K5 = ['1D', '2I'];
const K5_GUIDE = '\n\nTHIS IS A GRADES 1-5 PLAN, a slide script. Read its parts as the rubric parts: hook = 0B Hook '
  + '(warmUp is the 2L warm-up recall); iDo = 0C Explanation (the teacher models); weDo and youDo = 0D Practice (guided, '
  + `then independent); wrap = 0E Conclusion (exit options, reteach, homework). Rate ${NOT_ASSESSABLE_K5.join(' and ')} `
  + 'null: this script carries no pictures and no book text is given. Rate 3A from the minutes on each part '
  + '(hook/iDo/weDo/youDo/wrap) and meta.minutes.';

/**
 * Pure: the ratings with the checks the plan cannot show set to null — 1D (no book text is given) and the ICT
 * pair-exchange checks 9E/9F in both bands, plus 2I for a G1-5 script. Only ids the model rated are touched.
 */
function applyBand(items, band) {
  if (!items) return items;
  const out = { ...items };
  const off = [...rubric.NO_BOOK_TEXT, ...rubric.ICT_NOT_ASSESSABLE, ...(band === 'k5' ? NOT_ASSESSABLE_K5 : [])];
  for (const id of off) if (id in out) out[id] = null;
  return out;
}

/** The subject must-checks for this plan (Science: 9B), [] otherwise. */
function mustFor({ plan } = {}) {
  return SUBJECT_MUST[rubric.subjectOf(plan)] || [];
}

/** Points over 4 per rated check, as a %; a null (not assessable) is left out of both. */
function judgePct(items) {
  const rated = Object.values(items || {}).filter((r) => Number.isInteger(r));
  if (!rated.length) return 0;
  return (rated.reduce((a, b) => a + b, 0) / (4 * rated.length)) * 100;
}

/** Gate v2 over one scoring, or over two when the first was near the bar; `must` = the subject's extra must-checks. */
function gateV2(items, second = null, must = []) {
  const reasons = [];
  const ones = Object.keys(items).filter((k) => items[k] === 1).sort();
  if (ones.length) reasons.push(`checks rated 1: ${ones.join(', ')}`);
  const low = KEY_CHECKS.filter((k) => !Number.isInteger(items[k]) || items[k] < 3);
  if (low.length) reasons.push(`key check below 3: ${low.join(', ')}`);
  const lowMust = (must || []).filter((k) => Number.isInteger(items[k]) && items[k] < 3);
  if (lowMust.length) reasons.push(`subject must-check below 3: ${lowMust.join(', ')}`);
  let pct = judgePct(items);
  const near = Math.abs(pct - BAR) < BAND;
  const rescore = second === null && near;
  if (second !== null && near) pct = (pct + judgePct(second)) / 2;
  if (pct < BAR) reasons.push(`judge ${pct.toFixed(1)} < ${BAR}${second !== null && near ? ' (mean of two scorings)' : ''}`);
  return { pass: reasons.length === 0, rescore, pct, reasons };
}

/** The model's reply → { checkId: 1..4 | null } for known checks only, or null when nothing usable came back. */
function parseReview(content) {
  let obj;
  try {
    const text = String(content || '');
    obj = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); // fenced or with prose around it
  } catch {
    return null;
  }
  const out = {};
  for (const c of (obj && Array.isArray(obj.checks) ? obj.checks : [])) {
    if (!c || !IDS.has(c.id)) continue;
    if (c.rating === null) { out[c.id] = null; continue; }
    const r = Number(c.rating);
    if (Number.isInteger(r) && r >= 1 && r <= 4) out[c.id] = r;
  }
  return Object.keys(out).length ? out : null;
}

function reviewMessages({ plan, lang = 'en', band = 'g612' }) {
  const subject = rubric.subjectOf(plan);
  const system = 'You review one classroom lesson plan written for a teacher in Pakistan, against the rubric below. '
    + 'For each check, read its requirement and its four level descriptors, then give the level whose descriptor '
    + 'matches what is written in the plan (1-4). Rate a 4 whenever the plan meets the level-4 descriptor, a 3 when it '
    + 'meets level 3, and so on; do not default to any level. Use null only when the plan itself cannot show the check. '
    + 'Judge only what is written in the plan.\n\n'
    + `${rubric.ICT_RULES}\n\nRUBRIC (subject: ${subject || 'general'}):\n${rubric.rubricText(subject)}\n\n`
    + 'For each check, first write in "why" (under 15 words) what the plan does for it, then the level that matches. '
    + 'Reply with JSON only: {"checks":[{"id":"0A","why":"…","rating":3}, ...]} with every check id above once.'
    + (band === 'k5' ? K5_GUIDE : '');
  const body = typeof plan === 'string' ? plan : JSON.stringify(plan);
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Plan language: ${lang === 'ur' ? 'Urdu' : 'English'}.\n\nPLAN:\n${body}` },
  ];
}

module.exports = {
  gateV2, judgePct, parseReview, reviewMessages, applyBand, mustFor, NOT_ASSESSABLE_K5, CHECKS, KEY_CHECKS, BAR, BAND,
};
