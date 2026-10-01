/**
 * I-SAPS written answers (CRQs) are graded but HELD until released (bd-hxm7a).
 *
 * Operator, 2026-10-01: "We are not sure about our Grading Prompts right now.
 * So we will grade the CRQs but not show the results to the teacher yet, or
 * issue them a certificate. Instead ... we will show them that we are grading
 * your CRQs and this will take some time. Once passed, we will issue you a
 * certificate."
 *
 * While HELD:
 *   - the CRQ is still graded against its own I-SAPS rubric and stored;
 *   - the teacher sees her MCQ result. Under 3 of 4 (75% of those served) the
 *     exam FAILS and she may retake now; otherwise it is PENDING REVIEW —
 *     neither passed nor failed — and cannot be retaken;
 *   - no score or feedback for the written answer reaches her;
 *   - no I-SAPS certificate is issued.
 *
 * ONE switch releases it: app_settings 'isaps_crq_results_released' = true.
 * Absent, false, or unreadable means HELD — fail closed, so a lookup error can
 * never leak a mark or mint a certificate.
 */

const { MCQ_PASS_PCT } = require('./isaps-crq-paper.rules');

const CRQ_RELEASE_SETTING_KEY = 'isaps_crq_results_released';
const PENDING_REVIEW = 'pending_review';

/** Only an explicit true (or {released: true}) releases. */
function isReleasedValue(value) {
  if (value === true) return true;
  return Boolean(value && typeof value === 'object' && value.released === true);
}

/**
 * Are I-SAPS CRQ results held right now? Reads app_settings; any failure → held.
 * @param {object} supabase
 * @returns {Promise<boolean>}
 */
async function crqResultsHeld(supabase) {
  try {
    const { data, error } = await supabase
      .from('app_settings').select('key, value')
      .eq('key', CRQ_RELEASE_SETTING_KEY).maybeSingle();
    if (error) return true;
    return !isReleasedValue(data ? data.value : undefined);
  } catch (_) {
    return true;
  }
}

/**
 * The verdict of an I-SAPS module exam while results are held. The CRQ does not
 * enter it: only the MCQ bar can be judged in front of the teacher.
 *
 * @param {{mcqCorrect:number, mcqServed:number}} p
 * @returns {{status:'pending_review'|'failed', is_passed:null|false}}
 */
function heldModuleExamOutcome({ mcqCorrect, mcqServed }) {
  const served = Number(mcqServed) || 0;
  const mcqOk = served === 0 || ((Number(mcqCorrect) || 0) / served) * 100 >= MCQ_PASS_PCT;
  return mcqOk
    ? { status: PENDING_REVIEW, is_passed: null }
    : { status: 'failed', is_passed: false };
}

/** What WhatsApp says when a written answer is recorded. */
function crqAnswerAck({ held, score, max, feedback }) {
  if (held) {
    return '📝 *Answer recorded.*\n\nYour written answer is being graded — this takes some time. '
      + "Once it passes, we'll issue your certificate.";
  }
  return `📝 Answer recorded — *${score}/${max}*.\n\n${feedback || ''}`.trim();
}

/** The message after a held module exam is graded. */
function heldModuleExamMessage({ moduleTitle, mcqCorrect, mcqServed, outcome }) {
  const name = moduleTitle ? `*${moduleTitle}*` : 'this module';
  if (outcome.status === PENDING_REVIEW) {
    return `✅ Module exam for ${name} — multiple choice: *${mcqCorrect}/${mcqServed}*, cleared.\n\n`
      + '📝 Your written answer is being graded. This takes some time. '
      + "Once it passes, we'll issue your certificate.";
  }
  const need = Math.ceil((Number(mcqServed) || 0) * (MCQ_PASS_PCT / 100));
  return `Module exam for ${name} — multiple choice: *${mcqCorrect}/${mcqServed}*. `
    + `You need ${need} of ${mcqServed} to clear it.\n\nYou can take the module exam again now — `
    + "you'll get a new set of questions.";
}

module.exports = {
  CRQ_RELEASE_SETTING_KEY,
  PENDING_REVIEW,
  isReleasedValue,
  crqResultsHeld,
  heldModuleExamOutcome,
  crqAnswerAck,
  heldModuleExamMessage,
};
