/**
 * Teacher Training — quiz SERVING policy (pure decision layer).
 *
 * WHAT IT DECIDES
 * ---------------
 *   1. Which questions an attempt is served (module quizzes: one per Bloom
 *      level; level exams: a random cap).
 *   2. In what order that question's options are displayed.
 *
 * Both were "all of them, in order_index order" before. The change exists
 * because the imported banks are far bigger than a WhatsApp quiz should be —
 * a module check ran to a median of 9 questions and a level exam to 72 — and
 * because a re-sit presented the identical paper with the identical lettering.
 *
 * WHY IT IS A SEPARATE, PURE MODULE
 * ---------------------------------
 * quiz-delivery.service is a high-blast-radius file imported by the webhook
 * router, the Flow handler, the orchestrator, the certificate service and
 * content delivery. The serving RULES are the part most likely to be tuned
 * per vendor, so they live here as pure functions with no DB, no WhatsApp and
 * no config import — trivially testable, and impossible to break delivery by
 * editing. The DB lookup that feeds `config` in stays in quiz-delivery, next
 * to the vendor pass-mark lookups that already walk the same tree.
 *
 * WHY IT IS CONFIG-DRIVEN
 * -----------------------
 * The policy is per content vendor (`training_vendors`), not per country and
 * not hardcoded. One vendor's imported banks are Bloom-tagged and huge;
 * another's are short and already curated. Switching a second vendor onto the
 * same policy must be an UPDATE, not a deploy — so every knob here reads from
 * a vendor row and every default reproduces the behaviour that shipped before
 * this file existed.
 *
 * DETERMINISM IS THE WHOLE DESIGN
 * -------------------------------
 * The served set is stored NOWHERE — no column, no join table, only one
 * answer row per question actually answered. Three paths re-derive it
 * independently (send, button handler, resume). So every choice here is
 * seeded on ids that never change: the attempt id for question selection, and
 * (attempt id, question id) for option order. Same attempt ⇒ same paper, same
 * lettering, for as long as the row exists.
 *
 * CANONICAL INDICES
 * -----------------
 * `buildOptionDisplayOrder` returns CANONICAL 1-based option indices in
 * display order. The caller shows them as A/B/C… but must persist the
 * canonical index — that is what `correct_option` is expressed in, and what
 * 400k+ historical `training_assessment_answers` rows already hold. Shuffling
 * is a presentation concern and must never reach storage.
 */

const { makeRng, seededShuffle } = require('../../utils/seeded-random');
const { hasQuestionStem } = require('./question-stem.rules');

/** Module-quiz strategies. Add here + to the training_vendors CHECK, together. */
const STRATEGY_ALL = 'all';
const STRATEGY_ONE_PER_BLOOM = 'one_per_bloom';
const KNOWN_STRATEGIES = [STRATEGY_ALL, STRATEGY_ONE_PER_BLOOM];

/**
 * Floor for a one-per-Bloom module quiz (operator decision).
 *
 * A module whose questions all carry the same bloom_level would otherwise be
 * a ONE-question gate — and with a 100% pass bar, a single unlucky tap would
 * block the module. Two is the smallest number that stops a coin-flip from
 * deciding a teacher's progress. Not a vendor column: it is a property of the
 * strategy, and a vendor that wants a different shape picks a different
 * strategy.
 */
const MIN_SERVED_QUESTIONS = 2;

/**
 * The serving behaviour that shipped before this module existed. Every
 * resolution failure falls back to exactly this, so a missing vendor row or a
 * typo'd strategy degrades to "serve everything, unshuffled" rather than to a
 * short or empty quiz.
 */
const DEFAULT_SERVING_CONFIG = Object.freeze({
  module_quiz_strategy: STRATEGY_ALL,
  exam_question_cap: null,
  shuffle_options: false,
});

/**
 * Coerce a training_vendors row (or nothing at all) into a usable config.
 *
 * @param {object|null} vendorRow
 * @returns {{module_quiz_strategy: string, exam_question_cap: number|null, shuffle_options: boolean}}
 */
function normalizeServingConfig(vendorRow) {
  if (!vendorRow) return { ...DEFAULT_SERVING_CONFIG };

  const rawStrategy = String(vendorRow.module_quiz_strategy || '').trim().toLowerCase();
  const strategy = KNOWN_STRATEGIES.includes(rawStrategy) ? rawStrategy : STRATEGY_ALL;

  const rawCap = vendorRow.exam_question_cap;
  const cap = Number(rawCap);
  const examQuestionCap = (rawCap !== null && rawCap !== undefined && rawCap !== ''
    && Number.isFinite(cap) && Number.isInteger(cap) && cap > 0) ? cap : null;

  return {
    module_quiz_strategy: strategy,
    exam_question_cap: examQuestionCap,
    shuffle_options: vendorRow.shuffle_options === true,
  };
}

/**
 * Bucket key for a question's Bloom level.
 *
 * The column mixes TWO taxonomies — Bloom's cognitive levels (remember …
 * create) and Krathwohl's affective ones (receiving … characterization).
 * They are deliberately NOT merged: each distinct value is its own level, so
 * a module tagged across both gets coverage of both. Untagged questions form
 * their own bucket rather than being dropped.
 */
function bloomKey(question) {
  return String(question?.bloom_level ?? '').trim().toLowerCase();
}

function byOrderIndex(a, b) {
  const ai = Number(a?.order_index);
  const bi = Number(b?.order_index);
  if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return ai - bi;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''), undefined, { numeric: true });
}

/** Group questions by Bloom bucket, with the bucket keys in a stable order. */
function groupByBloom(questions) {
  const groups = new Map();
  for (const q of questions) {
    const key = bloomKey(q);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  // Sort keys so the iteration order does not depend on DB row order.
  return [...groups.keys()].sort().map(key => ({
    key,
    questions: [...groups.get(key)].sort(byOrderIndex),
  }));
}

/**
 * One question per distinct Bloom level, with a floor of MIN_SERVED_QUESTIONS.
 *
 * @param {object[]} questions the full active bank for the module
 * @param {string} attemptId seeds the pick, so the paper is reproducible
 * @returns {object[]} served questions, in order_index order
 */
function selectOnePerBloom(questions, attemptId) {
  const groups = groupByBloom(questions);
  const rng = makeRng(`${attemptId}:module-select`);

  const chosen = [];
  const remaining = new Map();
  for (const group of groups) {
    const pickAt = Math.floor(rng() * group.questions.length);
    chosen.push(group.questions[pickAt]);
    remaining.set(group.key, group.questions.filter((_, i) => i !== pickAt));
  }

  // Floor: top up from whichever level has the most questions still spare, so
  // the extra question comes from the deepest pool rather than always the
  // first bucket. Ties break on the bucket key, which is stable.
  while (chosen.length < MIN_SERVED_QUESTIONS) {
    const candidates = [...remaining.entries()]
      .filter(([, spare]) => spare.length > 0)
      .sort((a, b) => (b[1].length - a[1].length) || a[0].localeCompare(b[0]));
    if (candidates.length === 0) break;   // the module simply has no more questions
    const [key, spare] = candidates[0];
    const pickAt = Math.floor(rng() * spare.length);
    chosen.push(spare[pickAt]);
    remaining.set(key, spare.filter((_, i) => i !== pickAt));
  }

  return chosen.sort(byOrderIndex);
}

/**
 * A random subset of at most `cap` questions.
 *
 * Deliberately NOT stratified by Bloom: on the live exam banks every question
 * carries the same level, so a "balanced" sample would be identical to a
 * plain one while implying a guarantee the data cannot keep.
 */
function selectRandomCapped(questions, attemptId, cap) {
  if (!Number.isFinite(cap) || cap <= 0 || cap >= questions.length) return [...questions];
  return seededShuffle(questions, `${attemptId}:exam-select`).slice(0, cap).sort(byOrderIndex);
}

/**
 * The served question set for an attempt.
 *
 * A question with a blank stem is never chosen (bd-arghnv.3), whoever loaded the bank: the loaders
 * drop and log them too, this is the line no caller can skip.
 *
 * @param {object[]} questions full active bank, any order
 * @param {{attemptId: string, isModuleQuiz: boolean, config: object}} opts
 * @returns {object[]} the questions to serve, in presentation order
 */
function selectServedQuestions(questions, { attemptId, isModuleQuiz, config } = {}) {
  const all = Array.isArray(questions) ? questions.filter(hasQuestionStem) : [];
  if (all.length === 0) return [];
  const cfg = config || DEFAULT_SERVING_CONFIG;

  if (isModuleQuiz) {
    if (cfg.module_quiz_strategy !== STRATEGY_ONE_PER_BLOOM) return [...all].sort(byOrderIndex);
    return selectOnePerBloom(all, attemptId);
  }
  return selectRandomCapped([...all].sort(byOrderIndex), attemptId, cfg.exam_question_cap);
}

/**
 * Which canonical option indices to display, in display order.
 *
 * Two jobs in one place, because they interact:
 *
 *   TRUNCATION FIRST, then shuffle. WhatsApp list rows are capped, so a
 *   question with more options than the cap has always been cut to the first
 *   N. Doing that BEFORE the permutation keeps the cut deterministic and
 *   independent of the seed — otherwise which options a teacher can even see
 *   would vary by attempt, which is a fairness problem, not a variety one.
 *
 *   ...but the plain "first N" cut can drop the answer. One imported question
 *   has 12 options; if its key pointed past the cap the question was
 *   unanswerable. So any option named by the key is swapped INTO the kept
 *   set, displacing the last kept option that is not itself part of the key.
 *   Multi-answer keys ('1,11,13') keep every member.
 *
 * @param {{optionCount: number, correctOption: string, cap: number,
 *          attemptId: string, questionId: (string|number), shuffle: boolean}} opts
 * @returns {number[]} canonical 1-based option indices, in display order
 */
function buildOptionDisplayOrder({ optionCount, correctOption, cap, attemptId, questionId, shuffle }) {
  const count = Number(optionCount) || 0;
  if (count <= 0) return [];

  const limit = Number.isFinite(Number(cap)) && Number(cap) > 0 ? Number(cap) : count;
  let kept = Array.from({ length: count }, (_, i) => i + 1);

  if (count > limit) {
    kept = kept.slice(0, limit);
    const required = String(correctOption || '')
      .split(',')
      .map(s => Number(String(s).trim()))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= count);
    for (const need of required) {
      if (kept.includes(need)) continue;
      for (let i = kept.length - 1; i >= 0; i--) {
        if (!required.includes(kept[i])) { kept[i] = need; break; }
      }
    }
    kept.sort((a, b) => a - b);
  }

  if (!shuffle) return kept;
  return seededShuffle(kept, `${attemptId}:${questionId}:options`);
}

module.exports = {
  STRATEGY_ALL,
  STRATEGY_ONE_PER_BLOOM,
  MIN_SERVED_QUESTIONS,
  DEFAULT_SERVING_CONFIG,
  normalizeServingConfig,
  selectServedQuestions,
  buildOptionDisplayOrder,
};
