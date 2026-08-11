/**
 * bd-2531 — the teacher-facing Supervisor Remark narrative.
 *
 * The product's central bet: ONE evaluation event, TWO audiences. The principal
 * keeps measurement (five 1-4 scores + S_pct); the teacher receives coaching
 * (strengths → growth → action plan) with NO numbers at all. Splitting them is
 * what stops a quarterly evaluation reading as a verdict.
 *
 * ── The no-scores rule is enforced THREE times ─────────────────────────────
 * A prompt is a request, not a guarantee, so:
 *   1. buildRemarkPrompt() instructs it;
 *   2. the INPUT carries rubric ANCHOR TEXT, never digits — the model cannot
 *      leak a number it was never given, which is far stronger than asking it
 *      not to;
 *   3. scrubScores() rejects any number-shaped leak that appears anyway.
 * (3) is the one that holds when the model misbehaves.
 *
 * ── Reuse, not re-derivation ───────────────────────────────────────────────
 * The tone rules come from report-v2/narrative.service.js, which earned them in
 * production:
 *   * PRONOUN_RULE (bd-2220) — gender is not stored, so a third-person pronoun
 *     is the model guessing. It guessed differently in different sentences and
 *     teachers saw themselves called "he" then "she" in one report. The fix is
 *     second person throughout, which is genderless by construction.
 *   * the plain-language jargon ban — teachers do not say "scaffolding".
 *   * "never emit rubric IDs" — already THIS feature's rule, in their words.
 *   * the Urdu code-switch + transliteration normalizer (fixCodeswitch).
 *
 * What is NEW here is only the prompt's INPUT: report-v2 is transcript-driven
 * ("use the TRANSCRIPT as source of truth"); a Supervisor Remark has no
 * transcript — five anchors and a principal's comment.
 */

const { logToFile } = require('../../utils/logger');
const { INDICATORS, getIndicator, getAnchor, isComplete } = require('./remark-rubric');

// report-v2/narrative.service transitively requires gpt5-mini.service →
// config/supabase, which calls process.exit(78) without env vars — importing it
// at module load kills any test process that only wants the pure helpers here.
// Resolved lazily, and only on the Urdu path that actually needs it.
function getFixCodeswitch() {
  return require('../coaching/report-v2/narrative.service').fixCodeswitch;
}

// The teacher-facing shape. Order is the product's: acknowledge, celebrate,
// then grow, then ONE concrete next step.
const NARRATIVE_SHAPE = Object.freeze(['opening', 'strengths', 'growth', 'action_plan']);

const LANG_NAME = { en: 'English', ur: 'Urdu' };

// ─── Guard 3: the scrubber ──────────────────────────────────────────────────

// Digits: ASCII + Arabic-Indic + Eastern-Arabic. A model writing Urdu emits the
// latter two, and an ASCII-only regex waves "اسکور ۴" straight through.
const D = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]';
// Number WORDS. The first version of this scrubber only matched digits, and a
// model told "never write a number" simply spelled it out instead — "four out
// of four" reached a teacher in adversarial testing. Only 1-20 + the round
// figures a 20-point scale can produce; ordinary prose words like "one area"
// stay legal because they are only caught in a SCORING context below.
const NW = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|'
  + 'thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
const NUM = `(?:${D}+|${NW})`;

// Score-shaped leaks. Deliberately CONTEXTUAL: a number alone is fine ("three
// students at the back"), a number in a SCORING frame is not. Over-zealous
// scrubbing is its own failure mode — it rejects good narratives and the
// teacher receives nothing.
const SCORE_PATTERNS = [
  // "3 out of 4", "3/4", "four out of four", "13 of 20", "٣ / ٤"
  new RegExp(`${NUM}\\s*(?:\\/|out of|of|میں سے)\\s*(?:${D}+|${NW})\\b`, 'i'),
  // "scored 4", "rating: 3", "a rating of three", "اسکور ۴".
  // NOTE: no trailing \b — a word boundary does not fire between an Urdu digit
  // and Urdu script, so "اسکور ۴ ہے" would slip past with one.
  // NOTE: "grade" is deliberately ABSENT. "your grade 3 class" is a class, not
  // a score, and blocking it rejects legitimate coaching prose.
  new RegExp(`(?:scor(?:e|ed|es)|rat(?:ing|ed)|mark(?:s|ed)?|`
    + `اسکور|نمبر|درجہ)\\s*(?:of|:|=)?\\s*${NUM}`, 'i'),
  // "65%", "٦٥٪", "65 percent"
  new RegExp(`${NUM}\\s*(?:%|٪|percent|فیصد)`, 'i'),
  // "level 4", "13 points", "13 marks" — the scale's own vocabulary.
  new RegExp(`\\blevel\\s*${NUM}\\b`, 'i'),
  new RegExp(`${NUM}\\s*(?:points?|marks?|پوائنٹس|نمبروں)\\b`, 'i'),
];

// Rubric-shape leaks: the teacher must never see the instrument, only its meaning.
const RUBRIC_PATTERNS = [
  /\bindicator\s*[0-9٠-٩۰-۹]/i,
  /\brubric\b/i,
  /\bs_pct\b/i,
  /\bexemplary\b|\bproficient\b|\bdeveloping\b|\bneeds improvement\b/i,
];

/**
 * Reject a narrative that leaked a score or the rubric's shape.
 * THROWS rather than silently stripping: a message that had to be edited to be
 * safe is a message we should regenerate, not patch and send.
 * @param {object} narrative
 * @returns {object} the same narrative when clean
 */
function scrubScores(narrative) {
  for (const [section, text] of Object.entries(narrative || {})) {
    if (typeof text !== 'string') continue;
    for (const rx of SCORE_PATTERNS) {
      if (rx.test(text)) {
        throw new Error(
          `remark-narrative: refused — a score/number leaked into "${section}" (teachers never see scores)`);
      }
    }
    for (const rx of RUBRIC_PATTERNS) {
      if (rx.test(text)) {
        throw new Error(
          `remark-narrative: refused — a rubric label leaked into "${section}"`);
      }
    }
  }
  return narrative;
}

// ─── Guard 1 + 2: the prompt ────────────────────────────────────────────────

function langRules(language) {
  if (language === 'ur') {
    return `WRITE every string value in URDU (Nastaliq), warm and natural.

GENDER-NEUTRAL (teachers are men AND women — mandatory):
- Describe what she DID in PAST TENSE with نے (gender-neutral): "آپ نے شروع کیا".
- NEVER feminine present-habitual stems ("کرتی ہیں / دیتی ہیں").
- Instructions use the RESPECTFUL آپ-imperative (کریں، دیں) — never the intimate تم.

CODE-SWITCH: keep pedagogical/technical terms in ENGLISH (Latin letters) inline —
never transliterate into Nastaliq (write "feedback" not "فیڈبیک"; "mentoring" not
"مینٹورنگ").`;
  }
  return 'Write every string value in warm, specific English.';
}

/**
 * Build the teacher's narrative prompt.
 *
 * Feeds the model the ANCHOR TEXT the principal selected — never the number.
 * "Actively seeks learning, applies feedback…" carries the same meaning as "4"
 * while being impossible to render as a score.
 *
 * @param {{scores: Array<{ordinal:number,score:number}>, comment?: string,
 *          teacherName?: string, language?: string}} input
 */
function buildRemarkPrompt({ scores, comment = '', teacherName = 'the teacher', language = 'en' }) {
  if (!isComplete(scores)) {
    throw new Error('remark-narrative: incomplete rubric — all 5 indicators required');
  }
  const lang = LANG_NAME[language] ? language : 'en';

  // Strongest / weakest drive the strengths + growth sections. Without naming
  // them the model picks arbitrarily and may celebrate her weakest area.
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];

  // The evidence block: indicator NAME + the selected anchor's WORDS. No digits.
  const evidence = INDICATORS.map((ind) => {
    const row = scores.find((s) => s.ordinal === ind.ordinal);
    return `- ${ind.name.en}: "${getAnchor(ind.ordinal, row.score, 'en')}"`;
  }).join('\n');

  return `You are a warm, perceptive instructional coach writing to a teacher after her principal's quarterly review. Write the message SHE receives.

ABSOLUTE RULE — SHE NEVER SEES A SCORE. This review produced numbers; they are her principal's, not hers. Never write a number, a rating, a percentage, a count out of four, or any word that implies a grade. Never mention the rubric, an indicator, a level, or the words Exemplary/Proficient/Developing/Needs Improvement. Never say "your principal rated you". Write about what she DOES, in plain human words.

ADDRESS HER DIRECTLY — NEVER IN THIRD PERSON (mandatory):
- Write TO her, as "you". Never refer to her as "he", "she", "him", "her", or by name in the third person. We do not know her gender and must never guess it.
- WRONG: "The teacher seeks feedback. She applies it well."
- RIGHT: "You seek out feedback, and you apply it."

PLAIN LANGUAGE — avoid coach-jargon she would not use herself: "scaffolding", "differentiation", "metacognition", "formative assessment", "gradual release", "higher-order thinking". Say the concrete thing instead.

${langRules(lang)}

WHAT HER PRINCIPAL OBSERVED (these are descriptions, not grades — turn them into warm, specific prose; never quote them back verbatim):
${evidence}

HER PRINCIPAL'S OWN WORDS: ${comment || '(no additional comment)'}

LEAD WITH: ${getIndicator(strongest.ordinal).name.en} — this is where she is strongest.
GROWTH EDGE: ${getIndicator(weakest.ordinal).name.en} — name this as an exciting next step, never as a failing.

Return STRICT JSON:
{
 "opening":"one warm sentence acknowledging her term. Max 20 words.",
 "strengths":"2-3 sentences celebrating what she does well, grounded in the observations above. Specific, not generic praise.",
 "growth":"2-3 sentences naming the growth edge as a next horizon. Honest but never deficient-sounding.",
 "action_plan":"ONE concrete, small, doable thing to try this term. Something she could start on Monday."
}`;
}

// ─── Generation ─────────────────────────────────────────────────────────────

/**
 * Generate the teacher's narrative.
 *
 * THROWS on any failure — LLM error, wrong shape, or a leaked score. The caller
 * (design spec §6/§10) must save the remark + scores FIRST, then queue this and
 * retry: a submission is never lost to an LLM error, and a narrative is never
 * delivered half-safe. Returning null here would let a caller mistake failure
 * for "delivered".
 *
 * @param {object} input see buildRemarkPrompt
 * @param {{llm?: object}} deps inject the LLM client in tests
 */
async function generateRemarkNarrative(input, { llm } = {}) {
  const client = llm || require('../gpt5-mini.service');
  const language = LANG_NAME[input.language] ? input.language : 'en';
  const prompt = buildRemarkPrompt({ ...input, language });

  const { result } = await client.completeJson(prompt, {
    maxTokens: 1200,
    label: 'remark-narrative',
  });

  const missing = NARRATIVE_SHAPE.filter((k) => !result || typeof result[k] !== 'string' || !result[k].trim());
  if (missing.length) {
    logToFile('❌ remark-narrative: wrong shape', { missing, language });
    throw new Error(`remark-narrative: missing sections [${missing}] — expected shape ${NARRATIVE_SHAPE}`);
  }

  // Urdu: deterministic code-switch safety net (LLMs are ~90% consistent),
  // reusing report-v2's normalizer rather than a second copy of the map.
  const narrative = {};
  const fix = language === 'ur' ? getFixCodeswitch() : null;
  for (const k of NARRATIVE_SHAPE) {
    narrative[k] = fix ? fix(result[k]) : result[k];
  }

  // Guard 3 runs LAST — after normalisation, so a fix cannot reintroduce a leak.
  scrubScores(narrative);
  narrative._language = language;
  return narrative;
}

module.exports = {
  NARRATIVE_SHAPE,
  buildRemarkPrompt,
  scrubScores,
  generateRemarkNarrative,
};
