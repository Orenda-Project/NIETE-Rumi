/**
 * bd-arghnv.3 — a question with no stem is never served.
 *
 * The I-SAPS Level 2 seed read a stem line opening "A teacher…", "After…", "At…" as option A, and 43
 * active questions went in with question_text ''. Teachers met them in module exams and quick checks as
 * four options under no question. The rows are repaired and the seed is fixed; this is the rule every
 * paper is chosen through, so the next bad import cannot reach a teacher either.
 *
 * Applied at the selection layer (selectServedQuestions, selectPaperWithOneCrq) and where banks are
 * loaded and counted (loadQuestionBank, countActiveQuestions, the capstone loader, serve-paper, the
 * portal's question routes and "has a quiz" probes). Pinned by
 * tests/training/bd-arghnv-3-blank-stem-never-served.test.js.
 *
 * ZERO requires on purpose: the portal loads this file directly (the same precedent as
 * paper-marking.service.js), so the caller hands in its own logger.
 */

/** The one log line a skip writes, on either surface. */
const SKIP_MESSAGE = '⚠️ Question(s) with a blank stem skipped — never served (bd-arghnv.3)';

/**
 * Does this row carry a question to ask?
 *
 * A row loaded WITHOUT a question_text column says nothing about its stem, so it is kept: a thin
 * projection read as "blank" would empty every bank (the bd-60131 lesson, where a thin row was read as
 * a written question). Every serving path loads the column.
 *
 * @param {object} q training_questions row (or a projection of one)
 * @returns {boolean}
 */
function hasQuestionStem(q) {
  if (!q || typeof q !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(q, 'question_text')) return true;
  return typeof q.question_text === 'string' && q.question_text.trim() !== '';
}

/**
 * The rows that can be served, in their order. When any is dropped, ONE line names them all.
 *
 * @param {object[]} rows
 * @param {{log?: function(string, object): void, where?: object}} [opts]
 *        log   the caller's logger, called as log(message, data); omitted = silent
 *        where context for the log line (quiz kind, module id, route …)
 * @returns {object[]}
 */
function servableQuestions(rows, { log, where } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const servable = list.filter(hasQuestionStem);
  if (servable.length !== list.length && typeof log === 'function') {
    log(SKIP_MESSAGE, {
      ...(where || {}),
      questionIds: list.filter((q) => !hasQuestionStem(q)).map((q) => (q ? q.id : null)),
    });
  }
  return servable;
}

module.exports = { SKIP_MESSAGE, hasQuestionStem, servableQuestions };
