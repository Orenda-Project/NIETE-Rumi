/**
 * The CRQ is the module exam's LAST QUESTION, not a second engine.
 *
 * The I-SAPS CRQs were first modelled as a separate `capstone` quiz per module,
 * copying Beacon House's level-wide capstone. That inherited
 * loadCapstoneQuiz's level-scoped `.maybeSingle()`, which THROWS now that
 * I-SAPS carries nine capstones on one level — so the CRQ could not
 * be delivered at all.
 *
 * The operator's framing is better and is what this implements: a module with 8
 * scenario MCQs and one written answer has NINE questions. Everything needed
 * already sits on the shared path —
 *
 *   answer_text / answer_score / feedback_text   training_assessment_answers
 *   capstone_points_per_question                 training_vendors
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
 * The marker is: nothing to pick from (no options, no option images). The key
 * is NOT part of the rule — a stray key on an option-less row cannot make it a
 * pick question. An image-option question has synthesised option text, so it is
 * still an MCQ.
 *
 * @param {{options?: any, option_images?: any}|null} q
 * @returns {boolean}
 */
function isOpenEndedQuestion(q) {
  if (!q) return false;
  // A row that carries NEITHER field is a thin projection, not a
  // CRQ. loadQuestionBank selects only (id, order_index, bloom_level), and
  // treating that silence as "open-ended" classified all 12 of Module 1's bank
  // rows as CRQs: the paper collapsed to one question and the exam resolved
  // the module instantly. The row simply does not say — so do not guess.
  const knowsOptions = Object.prototype.hasOwnProperty.call(q, 'options');
  if (!knowsOptions) return false;
  const opts = q.options;
  const hasOptions = Array.isArray(opts)
    ? opts.length > 0
    : Boolean(opts && String(opts).trim() && String(opts).trim() !== '[]');
  // Image-option MCQs keep their choices in option_images, not options.
  const hasImages = Array.isArray(q.option_images) && q.option_images.length > 0;
  // NOTHING TO PICK FROM = a written question, whatever the key says. A row with
  // options [] but a stray key ('C') used to count as an MCQ: the server served
  // no choices, the page drew a text box, and the typed words were stored as the
  // picked option (varchar(32)), failing every save and submit of that paper.
  // The key cannot make an unanswerable-by-pick question a pick question.
  return !hasOptions && !hasImages;
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
 * How a module's summative paper is built, marked and passed (bd-vej4h).
 *
 * I-SAPS, "With regard to assessment administration" (Sept 2026), confirmed by
 * the operator 2026-10-01:
 *   - 4 Summative MCQs (was 2) and 1 CRQ, drawn at random from the module bank;
 *   - MCQs worth 5 marks each, the CRQ 10;
 *   - pass = at least 3 of 4 MCQs (75%) AND at least 60% on the CRQ — two
 *     independent bars, never a blended total.
 *
 * A bank thinner than the quota serves what it has (Module 6 holds 2 MCQs on
 * production as of 2026-10-01). The MCQ bar is a share of what was SERVED, so
 * a 2-MCQ paper needs both: operator decision, until I-SAPS add items.
 */
const MODULE_EXAM_MCQ_COUNT = 4;
const MCQ_MARKS = 5;
const MCQ_PASS_PCT = 75;
const CRQ_PASS_PCT = 60;

/**
 * Total marks for a served paper of `servedCount` questions: every question
 * but the last is an MCQ, the last is the one CRQ.
 *
 * @param {number} servedCount questions on the paper, CRQ included
 * @param {number} crqMarks    the CRQ's maximum (vendor capstone_points_per_question)
 * @returns {number}
 */
function isapsPaperMarks(servedCount, crqMarks) {
  const mcqs = Math.max(0, (Number(servedCount) || 0) - 1);
  return mcqs * MCQ_MARKS + (Number(crqMarks) || 0);
}

/**
 * Has this module exam passed? Both bars, independently.
 *
 * An unmarked CRQ (null) is not a pass: the verdict waits for the mark rather
 * than passing on the MCQs alone. A paper with no CRQ (crqMax 0) is judged on
 * its MCQs; a paper with no MCQs on its CRQ.
 *
 * @param {object} p
 * @param {number} p.mcqCorrect
 * @param {number} p.mcqServed
 * @param {number|null} p.crqEarned
 * @param {number} p.crqMax
 * @returns {boolean}
 */
function decideIsapsModuleExamPass({ mcqCorrect, mcqServed, crqEarned, crqMax }) {
  const served = Number(mcqServed) || 0;
  const max = Number(crqMax) || 0;
  if (served === 0 && max === 0) return false;
  const mcqOk = served === 0 || ((Number(mcqCorrect) || 0) / served) * 100 >= MCQ_PASS_PCT;
  if (max === 0) return mcqOk;
  if (crqEarned === null || crqEarned === undefined || !Number.isFinite(Number(crqEarned))) return false;
  const crqOk = (Math.min(max, Number(crqEarned)) / max) * 100 >= CRQ_PASS_PCT;
  return mcqOk && crqOk;
}

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
 * An MCQ is worth MCQ_MARKS (5); the CRQ is worth its vendor's
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
function scoreMixedPaper({ answers, mcqCount, crqMaxPoints, mcqMarks = MCQ_MARKS }) {
  const rows = Array.isArray(answers) ? answers : [];
  const mcqs = Number(mcqCount) || 0;
  const crqMax = Number(crqMaxPoints) || 0;
  const perMcq = Number(mcqMarks) || 0;

  let mcqCorrect = 0;
  let crqEarned = null;
  for (const a of rows) {
    const idx = Number(a.question_index);
    if (Number.isFinite(idx) && idx < mcqs) {
      if (a.is_correct === true) mcqCorrect += 1;
    } else if (crqMax > 0) {
      const raw = Number(a.answer_score);
      if (a.answer_score !== null && a.answer_score !== undefined && Number.isFinite(raw)) {
        crqEarned = Math.max(0, Math.min(crqMax, raw));
      }
    }
  }
  return {
    earned: mcqCorrect * perMcq + (crqEarned || 0),
    possible: mcqs * perMcq + crqMax,
    mcqCorrect,
    mcqServed: mcqs,
    crqEarned,
    crqMax,
  };
}


/**
 * The served paper for a folded module bank: every MCQ, then ONE CRQ.
 *
 * The bank now holds a module's MCQs and all four of its CRQs. Only
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
  MCQ_MARKS,
  MCQ_PASS_PCT,
  CRQ_PASS_PCT,
  isapsPaperMarks,
  decideIsapsModuleExamPass,
  pickMcqs,
  isOpenEndedQuestion,
  pickOneCrq,
  buildMixedPaper,
  scoreMixedPaper,
  selectPaperWithOneCrq,
  isTextAnswerForOpenQuestion,
};
