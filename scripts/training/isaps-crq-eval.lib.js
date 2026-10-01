/**
 * bd-60131 — pure helpers for the I-SAPS CRQ marker eval (see isaps-crq-eval.js).
 *
 * No I/O, no LLM, no supabase. Everything here is either reading structure off
 * the printed I-SAPS rubric or normalising what a model returns, and each is
 * pinned in tests/training/bd-60131-isaps-crq-eval-lib.test.js.
 */

const RE_MARKS = /\((\d+)\s*marks?\)/gi;
// Every I-SAPS rubric opens with the four band labels before its criteria.
const BAND_HEADER = [4, 3, 2, 1];

/**
 * The per-criterion maxima, in rubric order, read off the "(N marks)" labels.
 *
 * The first four labels are the band header (Exemplary 4 / Proficient 3 /
 * Developing 2 / Beginning 1); what follows is one weight per criterion. The
 * weights must add up to the printed total — a rubric where they do not is a
 * source defect and is refused rather than silently rescaled.
 *
 * @param {string} rubric
 * @param {number} totalMarks
 * @returns {number[]}
 */
function criterionMaxima(rubric, totalMarks) {
  const nums = [...String(rubric || '').matchAll(RE_MARKS)].map((m) => Number(m[1]));
  const body = nums.slice(0, 4).join(',') === BAND_HEADER.join(',') ? nums.slice(4) : nums;
  const sum = body.reduce((a, b) => a + b, 0);
  if (!body.length || sum !== Number(totalMarks)) {
    throw new Error(`rubric criterion weights [${body.join(', ')}] sum to ${sum}, not ${totalMarks}`);
  }
  return body;
}

/**
 * Remove the marker-facing placeholders I-SAPS wrote into some model answers:
 * "(or any other subject)", "(or any other actionable strategy that fulfill the
 * marking criteria)". They are instructions to a human marker, not answer
 * text, and a candidate answer never contains them.
 *
 * @param {string} text
 * @returns {string}
 */
function stripMarkerPlaceholders(text) {
  return String(text || '')
    .replace(/\s*\(or any other[^)]*\)/gi, '')
    .replace(/ {2,}/g, ' ');
}

function clampInt(value, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

/**
 * Normalise the marker's JSON reply against the rubric's maxima.
 *
 * Fences are stripped; a reply that is not JSON, or that returns fewer
 * criteria than the rubric has, scores 0 for what is missing and is flagged
 * `ok: false`. Every mark is clamped to [0, max] and the total is recomputed —
 * the model's own total is never trusted.
 *
 * @param {string} raw
 * @param {number[]} maxima
 * @returns {{ok:boolean, criteria:Array<{name:string, marks:number, max:number, evidence:string}>, total:number, feedback:string}}
 */
function parseMarkerReply(raw, maxima) {
  let parsed = null;
  const text = String(raw || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (__) { parsed = null; } }
  }
  const given = Array.isArray(parsed?.criteria) ? parsed.criteria : [];
  const criteria = maxima.map((max, i) => {
    const c = given[i] || {};
    return {
      name: String(c.name || `criterion ${i + 1}`),
      marks: clampInt(c.marks, max),
      max,
      evidence: String(c.evidence || '').slice(0, 400),
    };
  });
  const ok = Boolean(parsed) && given.length === maxima.length;
  return {
    ok,
    criteria,
    total: criteria.reduce((a, c) => a + c.marks, 0),
    feedback: String(parsed?.feedback || '').slice(0, 600),
  };
}

/**
 * The rubric-grounded marker prompt — a proposal for what scoreAnswer should
 * send for an I-SAPS CRQ. Encodes the three rules the live prompt lacks and
 * the golden set exposed: a zero band for non-answers, no marks for vocabulary
 * alone, no penalty for plain English or Urdu.
 *
 * @param {object} p
 * @param {string} p.prompt       scenario + question, as the teacher saw it
 * @param {string} p.rubric       the printed analytic rubric
 * @param {string} p.modelAnswer  I-SAPS "possible answer" (notes on key components)
 * @param {string} p.answer       the teacher's answer
 * @param {number} p.totalMarks
 * @param {number[]} p.maxima
 * @returns {Array<{role:string, content:string}>}
 */
function buildRubricMarkerMessages({ prompt, rubric, modelAnswer, answer, totalMarks, maxima }) {
  const system = [
    'You are marking a constructed-response question (CRQ) from the I-SAPS / NIETE Level 1 teacher training.',
    'Mark strictly against the analytic rubric supplied. For each criterion, in the order the rubric lists them,',
    'choose the band whose descriptor best matches the answer and award that band\'s marks.',
    'Award 0 for a criterion when the answer does not attempt it, is off-topic, or is a non-answer.',
    'Do not award marks for vocabulary alone: a term counts only when the answer uses it correctly and applies it to the scenario.',
    'Do not penalise plain English, grammar, spelling, register, or the use of Urdu words; judge substance.',
    'Do not reward length or confidence.',
    'The notes on a correct answer show ONE way to reach full marks; an answer that reaches the descriptor a different way earns the same marks.',
    `Reply ONLY with JSON: {"criteria":[{"name":"<criterion name as printed>","marks":<integer>,"max":<integer as printed>,"evidence":"<one sentence pointing to the answer>"}],"total":<integer>,"feedback":"<2-3 encouraging, specific sentences for the teacher, naming what to add next time>"}`,
    `The rubric has ${maxima.length} criteria worth ${maxima.join(', ')} marks (total ${totalMarks} marks).`,
  ].join(' ');

  const user = [
    'SCENARIO AND QUESTION:', prompt, '',
    `RUBRIC (total ${totalMarks} marks):`, rubric, '',
    'NOTES ON KEY COMPONENTS OF A CORRECT ANSWER (for reference; not the only acceptable answer):',
    stripMarkerPlaceholders(modelAnswer), '',
    "TEACHER'S ANSWER:", answer,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

module.exports = {
  criterionMaxima,
  stripMarkerPlaceholders,
  parseMarkerReply,
  buildRubricMarkerMessages,
};
