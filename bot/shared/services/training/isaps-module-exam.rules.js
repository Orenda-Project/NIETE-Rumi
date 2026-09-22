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
 * (the other vendors occupy 1-11), so the range cannot collide, and the
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
  // bd-60167 — her best graded mark, carried through so a surface can SHOW it.
  // Optional: every caller that does not know a mark simply omits them, and
  // the slot reads exactly as before.
  bestScore = null, bestTotal = null, bestPct = null, lastAttemptAt = null,
}) {
  const mark = (Number.isFinite(Number(bestScore)) && Number(bestTotal) > 0)
    ? { score: Number(bestScore), total: Number(bestTotal), pct: Number(bestPct), at: lastAttemptAt || null }
    : null;
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
      // The mark belongs in the sentence: "you passed" without a number makes
      // a teacher go looking for one.
      body: mark
        ? `🏆 Module exam — you passed this module with ${mark.score}/${mark.total}.`
        : '🏆 Module exam — you passed this module.',
      caption: 'Your score counts towards the level certificate.',
      cta: mark ? `✓ Passed · ${mark.score}/${mark.total}` : '✓ Passed',
      mark,
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

  // bd-60164 — the exam does NOT wait for the sessions.
  //
  // Operator, Sept 2026, after the partner's revised guide: "Anything can be
  // given in any order. The only important thing is that the certificate
  // issues only if the requirements are complete."
  //
  // So sequencing is gone at every level — units no longer chain, and the
  // exam no longer waits for them. The gate that used to live here has moved
  // to where it belongs: the LEVEL certificate, which is refused until all
  // three weighted components clear their bars (bd-60163). Blocking the exam
  // as well was gating the same work twice, and it stranded a teacher who
  // wanted to sit an assessment she was ready for.
  //
  // `unitsTotal`/`unitsDone` stay in the signature: the caller still uses them
  // for the progress line, and a future vendor may want the lock back.
  const parts = [];
  if (mcq > 0) parts.push(`${mcq} scenario question${mcq === 1 ? '' : 's'}`);
  if (crq > 0) parts.push('1 written answer');
  // An earlier FAILED sitting still has a mark worth showing — she is about to
  // retake it, and "you scored 5/12 last time" is the reason to.
  return {
    ok: true,
    body: `🎓 Module exam — ${parts.join(' and ')}.`,
    caption: mark
      ? `Last attempt: ${mark.score}/${mark.total}. Your written answer is marked against the I-SAPS rubric.`
      : 'Your written answer is marked against the I-SAPS rubric.',
    cta: '📝 Take the module exam',
    mark,
  };
}


/**
 * bd-60124 — should finishing this module OFFER its exam instead of advancing?
 *
 * Reported from sandbox: completing the last unit of Module 1 delivered Unit
 * 201's video instead of Module 1's exam. `onModuleCompleted` offers a
 * capstone and then advances, and both assumptions are LEVEL-scoped —
 * loadCapstoneQuiz looks for a level capstone and levelFullyComplete demands
 * all 54 units — so an I-SAPS module exam is invisible to it.
 *
 * Gated on the vendor: NIETE, Beacon House and Oxbridge must reach `false`
 * here and keep advancing exactly as they did.
 *
 * @param {object} input
 * @param {string|null} input.vendorKey
 * @param {number} input.unitsTotal
 * @param {number} input.unitsDone
 * @param {number} input.mcqCount
 * @param {number} input.crqCount
 * @param {boolean} [input.alreadyPassed]
 * @returns {boolean}
 */
function shouldOfferModuleExam(input) {
  if (!input) return false;
  const {
    vendorKey, unitsTotal, unitsDone, mcqCount, crqCount, alreadyPassed,
  } = input;
  if (String(vendorKey || '').trim().toUpperCase() !== 'ISAPS') return false;
  if (alreadyPassed) return false;
  // A module with no units at all has no content yet; offering its exam would
  // be offering an assessment for nothing. But a module whose units are only
  // PARTLY done is fair game — bd-60164 removed that wait, since the
  // certificate is now the only thing that checks completeness.
  const total = Number(unitsTotal) || 0;
  if (total <= 0) return false;
  return (Number(mcqCount) || 0) + (Number(crqCount) || 0) > 0;
}

/**
 * The message that offers a finished module's exam.
 *
 * It says the next module waits, because the bug this fixes was the teacher
 * being swept onward: if the offer and the next unit's video arrive together,
 * the video is what gets tapped.
 *
 * @param {object} input
 * @param {string} input.moduleTitle
 * @param {number} input.mcqCount
 * @param {number} input.crqCount
 * @returns {string}
 */
function moduleExamOfferMessage({ moduleTitle, mcqCount, crqCount }) {
  const mcq = Number(mcqCount) || 0;
  const crq = Number(crqCount) || 0;
  const parts = [];
  if (mcq > 0) parts.push(`${mcq} scenario question${mcq === 1 ? '' : 's'}`);
  if (crq > 0) parts.push('1 written answer');
  const what = parts.length ? parts.join(' and ') : 'the assessment';
  return `🎓 *${moduleTitle}* — every session is done.\n\n`
    + `The module exam is ${what}. The next module waits until you are ready.`;
}


/**
 * bd-60126 — may THIS attempt's pass issue a LEVEL certificate?
 *
 * Reported from sandbox: passing Module 1's eight MCQs announced "you passed
 * the Level 1 grand quiz" and issued a level certificate — one module of nine.
 *
 * The cause was a one-word collision: startModuleExam stores its attempt with
 * `quiz_kind: 'grand'`, the same kind the LEVEL exam uses, because the CHECK
 * constraint on training_assessment_attempts admits only 'grand',
 * 'training_module' and 'capstone'. gradeAttempt branched on quiz_kind alone
 * and so could not tell them apart.
 *
 * The separating signal needs no schema change: a per-module quiz carries
 * source_quiz_id >= PER_MODULE_SOURCE_BASE (bd-60119); a level exam's is NULL
 * or a legacy 1-11.
 *
 * DEFAULTS TO TRUE on a missing or unloadable quiz row. Failing to certify a
 * genuine level pass is the worse error — every existing vendor certifies
 * through this path, and the module case is the narrow, provable one.
 *
 * @param {{source_quiz_id?: number|null}|null} quiz the attempt's quiz row
 * @returns {boolean}
 */
function isLevelCertifyingAttempt(quiz) {
  if (!quiz) return true;
  return !isPerModuleQuiz(quiz.source_quiz_id);
}

/**
 * What a teacher is told when a MODULE exam is passed.
 *
 * Deliberately claims no level and no certificate: the level certificate is
 * the composite across all nine modules (bd-60113), and saying otherwise is
 * exactly the bug this fixes.
 *
 * @param {object} input
 * @param {string} [input.moduleTitle]
 * @param {number} [input.score]
 * @param {number} [input.total]
 * @param {boolean} [input.hasCrq]
 * @returns {string}
 */
function moduleExamPassMessage({ moduleTitle, score, total, hasCrq } = {}) {
  const title = moduleTitle || 'this module';
  const s = Number(score) || 0;
  const t = Number(total) || 0;
  let msg = `✅ *${title}* — scenario questions done: *${s}/${t}*.`;
  if (hasCrq) {
    msg += '\n\nOne written answer left for this module. It is marked against '
        + 'the I-SAPS rubric, so take your time.';
  }
  return msg;
}


/**
 * bd-60130 — the level-exam slot, rendered as nothing.
 *
 * A vendor that assesses per MODULE has no level exam, and saying so out loud
 * ("No level exam — finish all sessions to complete this level") is internal
 * plumbing a teacher reads as breakage.
 *
 * The keys are kept and filled with a single space rather than removed or
 * emptied: the published Flow declares them, and a screen missing a declared
 * data key does not render. A single space is the convention this screen
 * already uses for an absent caption.
 *
 * @returns {{body: string, caption: string, cta: string}}
 */
function levelExamSlotHidden() {
  return { body: ' ', caption: ' ', cta: ' ' };
}

/**
 * bd-60139 — has every per-module exam of this level been PASSED?
 *
 * The certificate guard it feeds (maybeIssueQuizScoreCertificate) was written
 * for Oxbridge, where a level is finished when its units are finished: all
 * modules complete + each unit quick-check >= 70%. A per-module-assessed
 * vendor breaks that assumption, because the real assessment is a SUMMATIVE
 * exam sitting after each module, and the quick-checks say nothing about it.
 *
 * Operator hit this on sandbox: answering the last unit's 2-question quick
 * check minted the Level 1 certificate while EIGHT of the nine module exams
 * had never been taken and the ninth was still in progress.
 *
 * Only ACTIVE exams count, and only per-module ones (source_quiz_id >= 900).
 * A level with no per-module exams at all returns true — it is not gated by
 * this rule, so the caller's existing logic decides, and no other vendor's
 * behaviour changes.
 *
 * @param {Array<object>} quizzes  rows of training_grand_quizzes for the level
 *                                 ({ id, source_quiz_id, quiz_type, is_active })
 * @param {Array<object>} attempts rows of training_assessment_attempts
 *                                 ({ grand_quiz_id, is_passed })
 * @returns {boolean}
 */
function allModuleExamsPassed(quizzes, attempts) {
  const exams = (Array.isArray(quizzes) ? quizzes : []).filter(
    q => q && q.is_active === true && isPerModuleQuiz(q.source_quiz_id),
  );
  // No per-module exams on this level: this rule does not gate it.
  if (exams.length === 0) return true;

  const passed = new Set(
    (Array.isArray(attempts) ? attempts : [])
      .filter(a => a && a.is_passed === true && a.grand_quiz_id !== null
        && a.grand_quiz_id !== undefined)
      .map(a => a.grand_quiz_id),
  );
  return exams.every(q => passed.has(q.id));
}

module.exports = {
  PER_MODULE_SOURCE_BASE,
  moduleSourceQuizId,
  moduleFromSourceQuizId,
  isPerModuleQuiz,
  buildModuleExamSlot,
  shouldOfferModuleExam,
  moduleExamOfferMessage,
  isLevelCertifyingAttempt,
  allModuleExamsPassed,
  moduleExamPassMessage,
  levelExamSlotHidden,
};
