/**
 * bd-60128 — the CRQ is the module exam's LAST QUESTION, not a second engine.
 *
 * The I-SAPS CRQs were first modelled as a separate `capstone` quiz per module,
 * copying Beacon House's level-wide capstone. That inherited
 * loadCapstoneQuiz's level-scoped `.maybeSingle()`, which THROWS now that
 * I-SAPS carries nine capstones on one level (bd-60119) — so the CRQ could not
 * be delivered at all.
 *
 * The operator's framing is better and is what this implements: a module with 8
 * scenario MCQs and one written answer has NINE questions. Everything needed
 * already sits on the shared path —
 *
 *   answer_text / answer_score / feedback_text   training_assessment_answers
 *   capstone_points_per_question                 training_vendors (bd-60113)
 *   scoreAnswer()                                capstone-delivery, pure
 *
 * — so folding the CRQ in REMOVES an engine instead of adding one.
 *
 * Operator decision 2026-09-18: serve ONE CRQ per attempt from the module's
 * bank of four, so a re-sit draws a different scenario (doc §5.3 asks for "a
 * new set of CRQs"). The draw is seeded on the attempt id, so it is stable
 * across a resume and varies between attempts.
 *
 * Pure: no I/O, no supabase, no LLM.
 */

const { seededShuffle } = require('../../utils/seeded-random');

/**
 * Is this question answered in free text rather than by picking an option?
 *
 * The marker is the one the capstone import already used (bd-2233): empty
 * options AND an empty correct_option. Both halves matter — an image-option
 * question (bd-60118) has synthesised option text but a REAL key, and must not
 * be mistaken for open-ended.
 *
 * @param {{options?: any, correct_option?: any}|null} q
 * @returns {boolean}
 */
function isOpenEndedQuestion(q) {
  if (!q) return false;
  // bd-60131 — a row that carries NEITHER field is a thin projection, not a
  // CRQ. loadQuestionBank selects only (id, order_index, bloom_level), and
  // treating that silence as "open-ended" classified all 12 of Module 1's bank
  // rows as CRQs: the paper collapsed to one question and the exam resolved
  // the module instantly. The row simply does not say — so do not guess.
  const knowsOptions = Object.prototype.hasOwnProperty.call(q, 'options');
  const knowsKey = Object.prototype.hasOwnProperty.call(q, 'correct_option');
  if (!knowsOptions && !knowsKey) return false;
  const opts = q.options;
  const hasOptions = Array.isArray(opts)
    ? opts.length > 0
    : Boolean(opts && String(opts).trim() && String(opts).trim() !== '[]');
  const hasKey = Boolean(q.correct_option !== null
    && q.correct_option !== undefined
    && String(q.correct_option).trim());
  return !hasOptions && !hasKey;
}

/**
 * Draw ONE CRQ from a module's bank.
 *
 * Seeded on the attempt so the same exam always shows the same scenario — a
 * resumed attempt must not silently swap the question a teacher is part way
 * through — while a new attempt can draw a different one.
 *
 * @param {Array<object>|null} bank
 * @param {string} attemptId
 * @returns {Array<object>} zero or one question
 */
/**
 * How many scenario MCQs a module's summative paper carries.
 *
 * ISAPS process document §5.1: "The Summative Assessment score is itself
 * calculated for two Scenario-Based MCQs (2 marks @ 1 mark for each MCQ) and
 * one CRQ (10 marks)." So the paper is 3 questions / 12 marks, drawn from a
 * per-module bank that is deliberately larger (Module 1 holds 8 MCQs and 4
 * CRQs) — the surplus is what makes a §5.5 re-attempt possible.
 */
const MODULE_EXAM_MCQ_COUNT = 2;

function pickOneCrq(bank, attemptId) {
  const items = Array.isArray(bank) ? bank.filter(Boolean) : [];
  if (items.length === 0) return [];
  if (items.length === 1) return [items[0]];
  return seededShuffle(items, `${attemptId}:crq-select`).slice(0, 1);
}

/**
 * The served paper: the module's MCQs in order, then the one CRQ.
 *
 * The written answer closes the exam deliberately — it is the longest task, and
 * putting it last means a teacher who runs out of time has already banked the
 * MCQs.
 *
 * @param {Array<object>} mcqs
 * @param {Array<object>} crqBank
 * @param {string} attemptId
 * @returns {Array<object>}
 */
function pickMcqs(bank, attemptId, count = MODULE_EXAM_MCQ_COUNT) {
  const items = Array.isArray(bank) ? bank.filter(Boolean) : [];
  if (items.length <= count) return items;
  const drawn = seededShuffle(items, `${attemptId}:mcq-select`).slice(0, count);
  // WHICH two are drawn is random; the ORDER they are asked in is the authored
  // one. The shuffle picks the sample, it does not decide presentation — a
  // teacher should meet the module's scenarios in the sequence ISAPS wrote
  // them. Nothing downstream depends on this (answers are keyed by position in
  // the paper, not order_index), so it is purely about how the exam reads.
  const rank = new Map(items.map((q, i) => [q, i]));
  return drawn.sort((a, b) => rank.get(a) - rank.get(b));
}

function buildMixedPaper(mcqs, crqBank, attemptId) {
  return [...pickMcqs(mcqs, attemptId), ...pickOneCrq(crqBank, attemptId)];
}

/**
 * Score a paper that mixes auto-marked MCQs with one rubric-marked CRQ.
 *
 * An MCQ is worth 1; the CRQ is worth its vendor's
 * capstone_points_per_question (10 for I-SAPS). An unanswered or unmarked CRQ
 * scores 0 rather than undefined, and a mark above the cap is clamped — an
 * LLM returning 99 must not invent a pass.
 *
 * @param {object} input
 * @param {Array<{question_index:number, is_correct?:boolean, answer_score?:number}>} input.answers
 * @param {number} input.mcqCount     how many MCQs the paper served
 * @param {number} input.crqMaxPoints 0 when the paper has no CRQ
 * @returns {{earned:number, possible:number}}
 */
function scoreMixedPaper({ answers, mcqCount, crqMaxPoints }) {
  const rows = Array.isArray(answers) ? answers : [];
  const mcqs = Number(mcqCount) || 0;
  const crqMax = Number(crqMaxPoints) || 0;

  let earned = 0;
  for (const a of rows) {
    const idx = Number(a.question_index);
    if (Number.isFinite(idx) && idx < mcqs) {
      if (a.is_correct === true) earned += 1;
    } else if (crqMax > 0) {
      const raw = Number(a.answer_score);
      if (Number.isFinite(raw) && raw > 0) earned += Math.min(crqMax, raw);
    }
  }
  return { earned, possible: mcqs + crqMax };
}


/**
 * The served paper for a folded module bank: every MCQ, then ONE CRQ.
 *
 * The bank now holds a module's MCQs and all four of its CRQs (bd-60128). Only
 * one CRQ is sat per attempt, drawn on the attempt id so a resume is stable and
 * a re-sit differs (doc §5.3).
 *
 * @param {Array<object>|null} bank ordered questions for the module's quiz
 * @param {string} attemptId
 * @returns {Array<object>}
 */
function selectPaperWithOneCrq(bank, attemptId) {
  const items = Array.isArray(bank) ? bank.filter(Boolean) : [];
  if (items.length === 0) return [];
  const mcqs = items.filter(q => !isOpenEndedQuestion(q));
  const crqs = items.filter(isOpenEndedQuestion);
  return buildMixedPaper(mcqs, crqs, attemptId);
}

/**
 * Should this plain text message be taken as the answer to the question the
 * teacher is currently on?
 *
 * Only when that question is open-ended. Claiming text during an MCQ would
 * store ordinary chat as an answer and mark it; refusing a slash command keeps
 * /training and the rest reachable mid-exam.
 *
 * @param {string|null} text
 * @param {object|null} currentQuestion
 * @returns {boolean}
 */
function isTextAnswerForOpenQuestion(text, currentQuestion) {
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.startsWith('/')) return false;
  return isOpenEndedQuestion(currentQuestion);
}

module.exports = {
  MODULE_EXAM_MCQ_COUNT,
  pickMcqs,
  isOpenEndedQuestion,
  pickOneCrq,
  buildMixedPaper,
  scoreMixedPaper,
  selectPaperWithOneCrq,
  isTextAnswerForOpenQuestion,
};
