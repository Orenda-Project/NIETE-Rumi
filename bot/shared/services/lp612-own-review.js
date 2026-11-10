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
 * The 42 checks are the universal criteria 0–7 of the reviewer rubric v3, named; the model rates each 1–4 or null
 * (cannot be judged from the plan, which shrinks the denominator and never counts against it).
 */

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
const IDS = new Set(CHECKS.map((c) => c.id));

/** Points over 4 per rated check, as a %; a null (not assessable) is left out of both. */
function judgePct(items) {
  const rated = Object.values(items || {}).filter((r) => Number.isInteger(r));
  if (!rated.length) return 0;
  return (rated.reduce((a, b) => a + b, 0) / (4 * rated.length)) * 100;
}

/** Gate v2 over one scoring, or over two when the first was near the bar. */
function gateV2(items, second = null) {
  const reasons = [];
  const ones = Object.keys(items).filter((k) => items[k] === 1).sort();
  if (ones.length) reasons.push(`checks rated 1: ${ones.join(', ')}`);
  const low = KEY_CHECKS.filter((k) => !Number.isInteger(items[k]) || items[k] < 3);
  if (low.length) reasons.push(`key check below 3: ${low.join(', ')}`);
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
    obj = JSON.parse(String(content || '').replace(/^```(?:json)?\s*|\s*```$/g, ''));
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

function reviewMessages({ plan, lang = 'en' }) {
  const list = CHECKS.map((c) => `${c.id} ${c.name}`).join('\n');
  const system = 'You review one classroom lesson plan written for a teacher in Pakistan. Rate each check below on '
    + '1-4: 1 missing, 2 partly there, 3 meets the standard, 4 exemplary. Use null only when the plan itself '
    + 'cannot show the check. Judge only what is written in the plan. Be strict: a 4 must be earned.\n\n'
    + `CHECKS:\n${list}\n\nReply with JSON only: {"checks":[{"id":"0A","rating":3}, ...]} with every check id once.`;
  const body = typeof plan === 'string' ? plan : JSON.stringify(plan);
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Plan language: ${lang === 'ur' ? 'Urdu' : 'English'}.\n\nPLAN:\n${body}` },
  ];
}

module.exports = { gateV2, judgePct, parseReview, reviewMessages, CHECKS, KEY_CHECKS, BAR, BAND };
