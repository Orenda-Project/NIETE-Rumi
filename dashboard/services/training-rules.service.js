/**
 * Training rules client — the portal's only source of training decisions.
 *
 * bd-2480 / bd-2481 / bd-2469.
 *
 * WHY THIS FILE HAS NO LOGIC IN IT
 * --------------------------------
 * The portal used to answer "is this locked?", "is this level passed?" and
 * "is this level ready for its exam?" with its own copy of the bot's rules.
 * Every copy drifted, and the comments above them still claimed parity:
 *
 *   | Rule                   | Bot                    | Portal (before)           |
 *   |------------------------|------------------------|---------------------------|
 *   | counts as a level pass | ['grand','capstone']   | 'grand' only              |
 *   | "ready for exam"       | every module (bd-2447) | >=1 module per course     |
 *   | missing vendor row     | not chain-locked       | chain-locked              |
 *   | module order gate      | checkModuleUnlocked    | ABSENT ENTIRELY (bd-2448) |
 *
 * Two of those contradicted fixes already announced as shipped. The capstone
 * one meant the first Beacon House certificate ever issued was invisible here.
 *
 * So this module deliberately contains NO rules. It asks the bot and returns
 * the answer. There is no local fallback, because a fallback is a second
 * implementation and that is precisely the bug being removed — a test asserts
 * this file contains no decision logic.
 *
 * WHY HTTP RATHER THAN REQUIRING THE BOT'S CODE
 * ---------------------------------------------
 * Settled by bd-2461: requiring bot code into the dashboard process throws
 * (the queue driver needs aws-sdk v2, the dashboard carries only v3), the
 * throw was swallowed, and the failure reported success for two days. Same
 * pattern as password-reset.service.js, already in production.
 *
 * FAIL CLOSED
 * -----------
 * This makes the bot an availability floor for portal training — an accepted
 * trade (operator, 2026-08-02). It is safe only because every failure DENIES.
 * Unreachable, timed out, 401, 500, malformed body, missing config: all answer
 * `ok: false`. A gate that opens when it cannot reach the authority is not a
 * gate — that is bd-2452's bug class, and bd-2461's.
 *
 * Reads are the exception: getLevelStates THROWS rather than returning [],
 * because an empty catalogue is a legitimate answer ("no training assigned")
 * and returning it on error would render a plausible lie.
 */

const axios = require('axios');

const TIMEOUT_MS = 10_000;

/** Shown when the decision authority could not be reached. Deliberately vague
 *  about the cause — the teacher can only retry either way — and never
 *  phrased as though the content itself is locked. */
const UNAVAILABLE = 'Training is temporarily unavailable. Please try again in a moment.';

function config() {
  return {
    baseUrl: (process.env.MAIN_BOT_URL || '').replace(/\/$/, ''),
    apiKey: process.env.INTERNAL_API_KEY || '',
  };
}

/**
 * POST to the bot's training API.
 *
 * @returns {Promise<object>} the bot's response body
 * @throws when the bot is unreachable, unhappy, or not configured. Callers
 *         that are GATES must catch and deny; callers that are READS may let
 *         it propagate.
 */
async function ask(path, body) {
  const { baseUrl, apiKey } = config();
  if (!baseUrl || !apiKey) {
    // Never silently degrade to "allowed" because a variable is missing.
    throw new Error('training rules API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  }

  const res = await axios.post(`${baseUrl}/api/internal/training/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: TIMEOUT_MS,
  });

  const data = res && res.data;
  if (!data || data.success !== true) {
    throw new Error(`training rules API returned failure for ${path}`);
  }
  return data;
}

/**
 * Run a GATE. Any failure denies, with a message the caller can render.
 *
 * @param {string} label   for the log line
 * @param {Function} call  the ask() invocation
 */
async function gate(label, call) {
  try {
    const data = await call();
    // Trust the bot's answer, including its message and any reason/status it
    // attached. `ok` is normalised to a strict boolean so a missing field can
    // never read as permission.
    return { ...data, ok: data.ok === true };
  } catch (error) {
    console.error(`❌ Training gate "${label}" could not reach the bot — denying`, {
      error: error?.message,
      status: error?.response?.status,
    });
    return { ok: false, status: 503, message: UNAVAILABLE, unavailable: true };
  }
}

/**
 * Every level this teacher can see, with the bot's state for each:
 * locked / certified / ready_for_quiz / in_progress / not_started.
 *
 * Throws on failure — see the module note on why this does not return [].
 */
async function getLevelStates(userId) {
  const data = await ask('level-states', { userId });
  return data.levels || [];
}

/** May this teacher open this level's contents? Denies on any failure. */
async function checkLevelUnlocked(userId, levelId) {
  return gate('level-unlocked', () => ask('level-unlocked', { userId, levelId }));
}

/** May this teacher open this module right now? (bd-2448 sequencing.) */
async function checkModuleUnlocked(userId, moduleId) {
  return gate('module-unlocked', () => ask('module-unlocked', { userId, moduleId }));
}

/** May this teacher sit this level's exam — grand quiz or capstone? */
async function checkExamGate(userId, levelOrder, vendorKey = null) {
  return gate('exam-gate', () => ask('exam-gate', { userId, levelOrder, vendorKey }));
}

/**
 * May this teacher sit this level's exam, addressed by level ID?
 *
 * bd-2483 — the portal holds ids, the Flow holds orders. Same rule either way.
 * The bot's `reason` maps 1:1 onto the states the portal renders:
 *   no_exam -> no_quiz | already_passed -> passed | cooldown -> cooldown
 *   incomplete -> courses_incomplete | ok -> ready
 */
async function checkExamGateByLevel(userId, levelId) {
  return gate('exam-gate-by-level', () => ask('exam-gate-by-level', { userId, levelId }));
}

/**
 * The module-quiz verdict, decided by the bot's vendor pass bar.
 *
 * bd-2483 — THROWS on failure rather than denying. A gate can safely default to
 * "no"; a grading verdict cannot default to either answer. Recording a pass we
 * are unsure of hands out unearned progress; recording a fail we are unsure of
 * destroys a teacher's real work. The caller must abort the write instead.
 */
async function getModuleQuizVerdict(moduleId, score, totalQuestions) {
  const data = await ask('module-quiz-verdict', { moduleId, score, totalQuestions });
  return { is_passed: data.is_passed === true, status: data.status, pass_pct: data.pass_pct, achieved_pct: data.achieved_pct };
}

/** The exam's presentation state for a level. Denies on any failure. */
async function getGrandQuizState(userId, levelId) {
  return gate('grand-quiz-state', () => ask('grand-quiz-state', { userId, levelId }));
}

/**
 * The LEVEL-EXAM verdict, decided by the bot's vendor pass bar. bd-2673.
 *
 * THROWS on failure, exactly like getModuleQuizVerdict — see the note there on
 * why a grading verdict has no safe default in either direction.
 */
async function getExamVerdict(levelId, score, totalQuestions) {
  const data = await ask('exam-verdict', { levelId, score, totalQuestions });
  return {
    is_passed: data.is_passed === true,
    status: data.status,
    pass_pct: data.pass_pct,
    achieved_pct: data.achieved_pct,
  };
}

/**
 * Mark a submitted paper. bd-2673.
 *
 * The portal used to do this itself, twice — once for module quizzes and once
 * for level exams — with its own copy of the multi-answer set rule. Both copies
 * agreed with the bot by coincidence. Now there is one implementation and the
 * portal is a renderer.
 *
 * THROWS on failure, like getModuleQuizVerdict and for the same reason: a
 * marking result has no safe default in either direction. Handing out an
 * unmarked pass invents progress; recording an unmarked fail destroys real
 * work. The caller must abandon the write and let the teacher retry.
 */
async function markPaper(questions, answers) {
  const data = await ask('mark-paper', { questions, answers });
  return {
    graded: Array.isArray(data.graded) ? data.graded : [],
    score: Number(data.score) || 0,
    total_questions: Number(data.total_questions) || 0,
    has_unknown_question: data.has_unknown_question === true,
    has_duplicate_answer: data.has_duplicate_answer === true,
  };
}

/**
 * Which questions this attempt is served, and in which option order.
 *
 * THROWS on failure. Serving fewer questions than the bot would, or a different
 * option order, means the two surfaces are running different exams — and the
 * caption quotes the served count, so a silent fallback would also misreport
 * the paper's length to the teacher.
 */
async function servePaper(questions, { attemptId, isModuleQuiz, vendor } = {}) {
  const data = await ask('serve-paper', { questions, attemptId, isModuleQuiz, vendor });
  return {
    questions: Array.isArray(data.questions) ? data.questions : [],
    total_served: Number(data.total_served) || 0,
  };
}

module.exports = {
  getLevelStates,
  markPaper,
  servePaper,
  getExamVerdict,
  checkLevelUnlocked,
  checkModuleUnlocked,
  checkExamGate,
  checkExamGateByLevel,
  getModuleQuizVerdict,
  getGrandQuizState,
  UNAVAILABLE,
};
