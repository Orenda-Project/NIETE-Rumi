/**
 * Teacher Training — Module Progress
 *
 * The single writer for `teacher_training_progress`. Extracted from
 * content-delivery.service so quiz-delivery can record a completion without
 * requiring content-delivery (which requires quiz-delivery back — the cycle
 * the circular-deps guard flags).
 *
 * bd-2390 made passing the module quiz the gate for completion, so exactly
 * two callers may write a progress row:
 *
 *   1. content-delivery.handleModuleDone — a module with NO quiz, where the
 *      "▶ Next video" tap is the only completion signal available.
 *   2. quiz-delivery.gradeAttempt — the module quiz was passed.
 *
 * Keeping the write in one place is what stops "completed" drifting back to
 * meaning "tapped a button".
 *
 * bd-2446 also parks `moduleHasActiveQuiz` here. Content-delivery needs it to
 * LABEL the button (does this tap open a quiz or fetch the next video?) and
 * handleModuleDone needs it to ROUTE the tap — one predicate, so the label can
 * never disagree with the branch it describes. It lives in this module for the
 * same reason markModuleComplete does: quiz-delivery may need it too, and this
 * file is off the content-delivery ↔ quiz-delivery cycle.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { hasQuestionStem } = require('./question-stem.rules');

/**
 * Record a module as completed for a teacher. Idempotent — a repeat call
 * refreshes completed_at rather than creating a duplicate.
 *
 * @param {string} userId   users.id (uuid)
 * @param {number} moduleId training_modules.id
 * @returns {Promise<boolean>} true if the row is present after the call
 */
async function markModuleComplete(userId, moduleId) {
  const { error } = await supabase
    .from('teacher_training_progress')
    .upsert(
      { user_id: userId, module_id: moduleId, completed_at: new Date().toISOString() },
      { onConflict: 'user_id,module_id' }
    );
  if (error) {
    logToFile('❌ Progress upsert failed', { userId, moduleId, error: error.message });
    return false;
  }
  return true;
}

/**
 * How many active questions gate this module.
 *
 * On a lookup error we answer 0, which reads as "no quiz". The caller then
 * labels the button "▶ Next video" — and that IS what the tap will do, because
 * handleModuleDone's own call fails the same way and takes the no-quiz path.
 * Wrong-but-consistent beats a button that contradicts its handler.
 *
 * Only questions with a stem count (bd-arghnv.3), the same rule the bank
 * loader applies: a quick check made only of blank-stem rows serves nothing,
 * so it must read as no quick check, or the teacher is sent to a quiz that
 * cannot start and the module never completes. A unit's quick check is a
 * handful of rows, so they are read rather than counted by the database.
 *
 * @param {number} moduleId training_modules.id
 * @returns {Promise<number>}
 */
async function countActiveQuestions(moduleId) {
  const moduleIdNum = (typeof moduleId === 'number' ? moduleId : parseInt(moduleId, 10));
  if (!Number.isFinite(moduleIdNum) || moduleIdNum <= 0) return 0;
  const { data, error } = await supabase
    .from('training_questions')
    .select('id, question_text')
    .eq('training_module_id', moduleIdNum)
    .eq('is_active', true);
  if (error) {
    logToFile('⚠️ Question-count lookup failed — treating the module as quiz-free', {
      moduleId: moduleIdNum, error: error.message,
    });
    return 0;
  }
  return (data || []).filter(hasQuestionStem).length;
}

/**
 * Does this module gate on a quick check? The exact condition
 * handleModuleDone branches on — and therefore the one that decides whether
 * the button reads "📝 Take quiz" or "▶ Next video".
 *
 * @param {number} moduleId training_modules.id
 * @returns {Promise<boolean>}
 */
async function moduleHasActiveQuiz(moduleId) {
  return (await countActiveQuestions(moduleId)) > 0;
}

module.exports = { markModuleComplete, countActiveQuestions, moduleHasActiveQuiz };
