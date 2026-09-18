/**
 * bd-60120 — the end-of-module exam for I-SAPS.
 *
 * I-SAPS assesses at the end of each MODULE: scenario MCQs plus one CRQ
 * (assessment doc §4). bd-60119 re-keyed those onto per-module quizzes
 * (source_quiz_id = PER_MODULE_SOURCE_BASE + module) and retired the
 * level-wide pair — so the questions exist, but the level screen has exactly
 * one exam slot and it is bound to the LEVEL.
 *
 * That slot is free for I-SAPS precisely BECAUSE I-SAPS has no level exam: it
 * renders "No level exam — finish all sessions". When the teacher is drilled
 * into a module (the `c:` scope from bd-60119), it shows that module's exam
 * instead. No Flow re-publish, and no other vendor's level view changes.
 *
 * Pure rules only: which quiz belongs to a module, whether it is open, and
 * what the slot reads. The `ok` flag is the important output — a CTA in this
 * Flow is a tappable link whatever its label, so the SERVER has to be the
 * thing that refuses it. bd-2452 learned that on the level exam, where
 * "🔒 Locked" was still tappable and started the exam anyway.
 */

/**
 * I-SAPS per-module quizzes are keyed 900 + module. Legacy ids are 1-11
 * (Taleemabad 1-4, Beacon House 8-11), so the range cannot collide, and the
 * level-exam lookup excludes it.
 */
const PER_MODULE_SOURCE_BASE = 900;

/** @param {number} moduleNo 1..9 @returns {number} */
function moduleSourceQuizId(moduleNo) {
  return PER_MODULE_SOURCE_BASE + Number(moduleNo);
}

/**
 * Is this source_quiz_id one of the I-SAPS per-module quizzes?
 *
 * A NULL is a LEVEL exam, never a module one — that distinction is what keeps
 * every other vendor's exam resolving to exactly one row.
 *
 * @param {number|null} sourceQuizId
 * @returns {boolean}
 */
function isPerModuleQuiz(sourceQuizId) {
  if (sourceQuizId === null || sourceQuizId === undefined) return false;
  const n = Number(sourceQuizId);
  return Number.isFinite(n) && n > PER_MODULE_SOURCE_BASE;
}

/**
 * The module number behind a per-module quiz id, or null for anything else.
 *
 * @param {number|null} sourceQuizId
 * @returns {number|null}
 */
function moduleFromSourceQuizId(sourceQuizId) {
  if (!isPerModuleQuiz(sourceQuizId)) return null;
  return Number(sourceQuizId) - PER_MODULE_SOURCE_BASE;
}

/**
 * What the exam slot says for one module, and whether it may be started.
 *
 * Order of the branches is deliberate: "no questions" and "already passed"
 * come before "units unfinished", because a module with nothing to sit should
 * never tell a teacher to go finish units in order to reach an exam that does
 * not exist.
 *
 * @param {object} input
 * @param {string} input.moduleTitle
 * @param {number} input.unitsTotal
 * @param {number} input.unitsDone
 * @param {number} input.mcqCount           active scenario MCQs for the module
 * @param {number} input.crqCount           active CRQ items for the module
 * @param {boolean} [input.passed]          the module exam is already passed
 * @param {number} [input.cooldownHoursLeft] hours until a retake is allowed
 * @returns {{ok: boolean, body: string, caption: string, cta: string}}
 */
function buildModuleExamSlot({
  moduleTitle, unitsTotal, unitsDone, mcqCount, crqCount, passed, cooldownHoursLeft,
}) {
  const mcq = Number(mcqCount) || 0;
  const crq = Number(crqCount) || 0;
  const total = Number(unitsTotal) || 0;
  const done = Number(unitsDone) || 0;

  if (mcq === 0 && crq === 0) {
    return {
      ok: false,
      body: '🎓 No exam for this module yet.',
      caption: ' ',
      cta: '— ',
    };
  }

  if (passed) {
    return {
      ok: false,
      body: '🏆 Module exam — you passed this module.',
      caption: 'Your score counts towards the level certificate.',
      cta: '✓ Passed',
    };
  }

  const hours = Number(cooldownHoursLeft) || 0;
  if (hours > 0) {
    return {
      ok: false,
      body: `⏳ Module exam — locked after a recent attempt. Try again in about ${hours} hours.`,
      caption: 'Review the sessions while you wait.',
      cta: `⏳ Cooldown (${hours}h)`,
    };
  }

  const left = Math.max(0, total - done);
  if (left > 0) {
    return {
      ok: false,
      body: `🔒 Module exam — finish the remaining ${left} of ${total} sessions first.`,
      caption: 'The exam opens once every session in this module is done.',
      cta: '🔒 Locked',
    };
  }

  const parts = [];
  if (mcq > 0) parts.push(`${mcq} scenario question${mcq === 1 ? '' : 's'}`);
  if (crq > 0) parts.push('1 written answer');
  return {
    ok: true,
    body: `🎓 Module exam — ${parts.join(' and ')}.`,
    caption: 'Your written answer is marked against the I-SAPS rubric.',
    cta: '📝 Take the module exam',
  };
}

module.exports = {
  PER_MODULE_SOURCE_BASE,
  moduleSourceQuizId,
  moduleFromSourceQuizId,
  isPerModuleQuiz,
  buildModuleExamSlot,
};
