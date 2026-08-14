/**
 * Internal service-to-service API.
 *
 * Mounted at /api/internal. Callers are other services in the same deployment
 * (today: the portal/dashboard), authenticated with a shared secret in
 * `x-api-key`. Never exposed to teachers, never called from a browser.
 *
 * bd-2461 — why the LP enqueue lives here rather than in the portal.
 *
 * The portal used to enqueue by requiring the bot's queue service directly:
 *
 *     require('../../bot/shared/services/lesson-plan-queue.service')
 *
 * That throws inside the dashboard process. The queue driver does
 * `require('aws-sdk')` (the v2 SDK, a dependency of bot/) and the dashboard
 * only carries the v3 `@aws-sdk/*` packages — different package names, so the
 * module simply isn't there. The require sat in a bare `catch (_) {}`, so it
 * degraded silently to writing a `pending` row that nothing consumes, while
 * still answering the browser `queued: true`. Twenty-one orphan rows built up
 * over two days before anyone noticed.
 *
 * The fix isn't to give the dashboard queue powers — that means either
 * shipping a deprecated monolithic SDK into it, or writing a second producer
 * that has to keep its job envelope in step with the bot's forever. It's to
 * stop it needing them. The enqueue stays here, in the process where aws-sdk
 * and SQS_QUEUE_URL already exist, and the portal asks over HTTP.
 *
 * This is an existing pattern: password-reset already calls
 * POST /api/internal/send-password-reset the same way, and MAIN_BOT_URL +
 * INTERNAL_API_KEY are already provisioned on the portal service.
 */
const express = require('express');
const { logToFile } = require('../utils/logger');
const { clampLanguage } = require('../config/ux-strings');

const router = express.Router();

/**
 * Shared-secret auth for every route in this router.
 *
 * Rejects when INTERNAL_API_KEY is unset. Without that check a bot missing the
 * variable would compare `undefined === undefined` for a caller that sent no
 * header, and the endpoint would be open to anyone who found the URL.
 */
function requireInternalKey(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    logToFile('❌ Internal API called but INTERNAL_API_KEY is not set — refusing', {
      path: req.path,
    });
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  if (req.headers['x-api-key'] !== expected) {
    logToFile('❌ Unauthorized internal API call', { path: req.path, ip: req.ip });
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  return next();
}

/**
 * POST /api/internal/queue-lesson-plan
 *
 * Queue a grounded lesson-plan render (a curriculum_lp_ast row laid out via
 * Gamma). Delegates to the SAME createAndQueueGrounded the bot's own handlers
 * use, so there is exactly one definition of the job envelope.
 *
 * Body   { userId, phoneNumber, sourceLpUuid, topic, chapterTitle?, language? }
 * Auth   x-api-key: INTERNAL_API_KEY
 * Errors 400 (missing userId/sourceLpUuid), 401 (bad key), 502 (queue failed)
 * Ok     202 { success: true, requestId }
 */
router.post('/queue-lesson-plan', requireInternalKey, async (req, res) => {
  const { userId, phoneNumber, sourceLpUuid, topic, chapterTitle } = req.body || {};
  const language = clampLanguage(String((req.body && req.body.language) || 'en').toLowerCase());

  if (!userId || !sourceLpUuid) {
    return res.status(400).json({ success: false, error: 'userId and sourceLpUuid are required' });
  }

  try {
    const LessonPlanQueueService = require('../services/lesson-plan-queue.service');
    const requestId = await LessonPlanQueueService.createAndQueueGrounded({
      userId,
      phoneNumber,
      sourceLpUuid,
      topic,
      chapterTitle: chapterTitle || null,
      language,
    });
    logToFile('🧾 Grounded LP queued via internal API', { requestId, sourceLpUuid, userId, language });
    return res.status(202).json({ success: true, requestId, language });
  } catch (error) {
    // Loudly. The bug this endpoint replaces was invisible precisely because a
    // failed enqueue still read as success to the caller.
    logToFile('❌ Internal API failed to queue grounded LP', {
      userId, sourceLpUuid, error: error?.message,
    });
    return res.status(502).json({ success: false, error: 'Failed to queue lesson plan' });
  }
});

/* ------------------------------------------------------------------------- *
 * bd-2479 — the training DECISION layer.
 *
 * The portal reimplemented the bot's training rules in its own process and the
 * copies rotted. Found live 2026-08-02, while the portal's own comments still
 * claimed parity ("mirror the WhatsApp endpoint's rule exactly"):
 *
 *   - a capstone pass did not count as a level pass, so the first Beacon House
 *     certificate ever issued was invisible to the portal;
 *   - "ready for exam" still used the pre-bd-2447 ">=1 module per course"
 *     proxy, a fix we had already announced as shipped;
 *   - a missing vendor row defaulted to chain-locked on one surface and
 *     unlocked on the other;
 *   - the module-order gate (bd-2448) did not exist on the portal at all.
 *
 * These routes add NO logic. Each one delegates to the function the bot's own
 * Flow already calls, and passes the answer back untouched. That is the whole
 * point: a rule that exists in one place cannot drift from itself.
 *
 * Every handler requires the domain module lazily, matching the enqueue route
 * above and keeping this router cheap to load.
 * ------------------------------------------------------------------------- */

/** Coerce a body value to a finite number, or null. Rejects '' and undefined. */
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Wrap a training handler with the two things every one of them needs:
 * lazy module resolution, and fail-CLOSED error handling.
 *
 * Failing closed matters more here than in most places. These endpoints answer
 * "is this locked?", and an error that reads as `ok: true` turns a gate into a
 * doorway — the exact bug class bd-2452 fixed on the bot, where a level
 * rendered "🔒 Locked" and started anyway when tapped. On a throw we send 5xx
 * with no `ok` field at all, so a caller cannot mistake failure for permission.
 */
function trainingRoute(name, handler) {
  return async (req, res) => {
    try {
      const Training = require('./teacher-training-endpoint');
      return await handler(Training, req, res);
    } catch (error) {
      logToFile('❌ Internal training API failed', { route: name, error: error?.message });
      return res.status(500).json({ success: false, error: 'Training lookup failed' });
    }
  };
}

/**
 * POST /api/internal/training/level-states
 * Body { userId } → { success, levels: [...] }
 *
 * The whole level catalogue with per-level state, exactly as the WhatsApp Flow
 * renders it: locked / certified / ready_for_quiz / in_progress / not_started.
 */
router.post('/training/level-states', requireInternalKey, trainingRoute('level-states', async (Training, req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

  const levels = await Training.loadVisibleLevelsWithProgress(userId);
  return res.json({ success: true, levels: levels || [] });
}));

/**
 * POST /api/internal/training/level-unlocked
 * Body { userId, levelId } → { success, ok, status?, message?, previous_level_order? }
 */
router.post('/training/level-unlocked', requireInternalKey, trainingRoute('level-unlocked', async (Training, req, res) => {
  const { userId } = req.body || {};
  const levelId = num((req.body || {}).levelId);
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (levelId === null) return res.status(400).json({ success: false, error: 'levelId is required' });

  const gate = await Training.checkLevelUnlocked(userId, levelId);
  return res.json({ success: true, ...gate });
}));

/**
 * POST /api/internal/training/module-unlocked
 * Body { userId, moduleId } → { success, ok, message? }
 *
 * bd-2448's sequencing rule — exactly one unpassed module is open at a time.
 * The portal has never had this gate.
 */
router.post('/training/module-unlocked', requireInternalKey, trainingRoute('module-unlocked', async (Training, req, res) => {
  const { userId } = req.body || {};
  const moduleId = num((req.body || {}).moduleId);
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (moduleId === null) return res.status(400).json({ success: false, error: 'moduleId is required' });

  const gate = await Training.checkModuleUnlocked(userId, moduleId);
  return res.json({ success: true, ...gate });
}));

/**
 * POST /api/internal/training/exam-gate
 * Body { userId, levelOrder, vendorKey? } → { success, ok, reason?, message?, level? }
 *
 * The single precondition check for sitting a level exam — grand quiz or
 * capstone. `vendorKey` is passed through as null when absent rather than
 * defaulted here; what a missing scope means is the domain's call, not the
 * wire's.
 */
router.post('/training/exam-gate', requireInternalKey, trainingRoute('exam-gate', async (Training, req, res) => {
  const { userId, vendorKey } = req.body || {};
  const levelOrder = num((req.body || {}).levelOrder);
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (levelOrder === null) return res.status(400).json({ success: false, error: 'levelOrder is required' });

  const gate = await Training.assertCanStartGrandQuiz(userId, levelOrder, vendorKey || null);
  return res.json({ success: true, ...gate });
}));

/**
 * POST /api/internal/training/exam-gate-by-level
 * Body { userId, levelId } -> { success, ok, reason?, message?, level? }
 *
 * bd-2483 — the same gate, keyed the way the portal addresses levels. The Flow
 * holds a level order; the portal holds an id. One rule, two ways in.
 */
router.post('/training/exam-gate-by-level', requireInternalKey, trainingRoute('exam-gate-by-level', async (Training, req, res) => {
  const { userId } = req.body || {};
  const levelId = num((req.body || {}).levelId);
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (levelId === null) return res.status(400).json({ success: false, error: 'levelId is required' });

  const gate = await Training.assertCanStartExamForLevel(userId, levelId);
  // bd-2393 — the portal hardcoded pass_mark_pct: 100 in what it showed
  // teachers. The real bar is per vendor (NIETE 80, Beacon House 70), and that
  // fix shipped on WhatsApp only. Send the real number so the portal cannot
  // invent one.
  const QuizDelivery = require('../services/training/quiz-delivery.service');
  const passPct = await QuizDelivery.getVendorPassingPctByLevel(levelId, 'exam');
  return res.json({ success: true, pass_pct: passPct, ...gate });
}));

/**
 * POST /api/internal/training/grand-quiz-state
 * Body { userId, levelId } → { success, ...state }
 *
 * The exam's presentation state (badge, body, caption, CTA) alongside its
 * availability, resolved by LEVEL so Beacon House capstones resolve too.
 */
router.post('/training/grand-quiz-state', requireInternalKey, trainingRoute('grand-quiz-state', async (Training, req, res) => {
  const { userId } = req.body || {};
  const levelId = num((req.body || {}).levelId);
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (levelId === null) return res.status(400).json({ success: false, error: 'levelId is required' });

  const state = await Training.loadGrandQuizState(userId, levelId);
  return res.json({ success: true, ...(state || {}) });
}));

/**
 * POST /api/internal/training/module-quiz-verdict
 * Body { moduleId, score, totalQuestions } -> { success, is_passed, status, pass_pct, achieved_pct }
 *
 * bd-2483 — the portal graded module quizzes with `score === total` and wrote
 * status 'passed' whatever happened. The bar is per vendor
 * (module_passing_pct), and a failure must record as one.
 */
router.post('/training/module-quiz-verdict', requireInternalKey, async (req, res) => {
  const moduleId = num((req.body || {}).moduleId);
  const score = num((req.body || {}).score);
  const totalQuestions = num((req.body || {}).totalQuestions);
  if (moduleId === null) return res.status(400).json({ success: false, error: 'moduleId is required' });
  if (score === null) return res.status(400).json({ success: false, error: 'score is required' });
  if (totalQuestions === null) return res.status(400).json({ success: false, error: 'totalQuestions is required' });

  try {
    const QuizDelivery = require('../services/training/quiz-delivery.service');
    const verdict = await QuizDelivery.decideModuleQuizPass(moduleId, score, totalQuestions);
    return res.json({ success: true, ...verdict });
  } catch (error) {
    // Fail CLOSED: never let a lookup failure read as a pass.
    logToFile('❌ Internal training API failed', { route: 'module-quiz-verdict', error: error?.message });
    return res.status(500).json({ success: false, error: 'Grading lookup failed' });
  }
});

/**
 * POST /api/internal/training/exam-verdict
 * Body { levelId, score, totalQuestions } -> { success, is_passed, status, pass_pct, achieved_pct }
 *
 * bd-2673 — the level-exam twin of module-quiz-verdict. The portal used to read
 * training_vendors.passing_pct itself and do the percentage comparison inline,
 * defaulting to a hardcoded 100. bd-2393 had already fixed that same line once.
 */
router.post('/training/exam-verdict', requireInternalKey, async (req, res) => {
  const levelId = num((req.body || {}).levelId);
  const score = num((req.body || {}).score);
  const totalQuestions = num((req.body || {}).totalQuestions);
  if (levelId === null) return res.status(400).json({ success: false, error: 'levelId is required' });
  if (score === null) return res.status(400).json({ success: false, error: 'score is required' });
  if (totalQuestions === null) return res.status(400).json({ success: false, error: 'totalQuestions is required' });

  try {
    const QuizDelivery = require('../services/training/quiz-delivery.service');
    const verdict = await QuizDelivery.decideExamPass(levelId, score, totalQuestions);
    return res.json({ success: true, ...verdict });
  } catch (error) {
    // Fail CLOSED: never let a lookup failure read as a pass.
    logToFile('❌ Internal training API failed', { route: 'exam-verdict', error: error?.message });
    return res.status(500).json({ success: false, error: 'Grading lookup failed' });
  }
});

/**
 * POST /api/internal/training/mark-paper
 * Body { questions:[{id, correct_option, order_index}], answers:[{question_id, chosen_option}] }
 *   → { success, graded, score, total_questions, has_unknown_question, has_duplicate_answer }
 *
 * bd-2673 — "which answer is correct" used to exist three times: inline in
 * quiz-delivery.service.js and twice in the portal's route file (once for the
 * module quiz, once for the level exam). All three agreed by coincidence, and
 * the portal's comment claimed "identical comparator to the WhatsApp writer" —
 * the same claim the four rules listed at the top of this section were making
 * while they drifted.
 *
 * Pure arithmetic over the body: no DB read, no session, no identity. The PASS
 * decision is deliberately NOT here — that needs the vendor's bar and lives in
 * module-quiz-verdict / the exam gate. Marking is arithmetic, passing is policy.
 */
router.post('/training/mark-paper', requireInternalKey, async (req, res) => {
  const { questions, answers } = req.body || {};
  if (!Array.isArray(questions)) return res.status(400).json({ success: false, error: 'questions[] is required' });
  if (!Array.isArray(answers)) return res.status(400).json({ success: false, error: 'answers[] is required' });

  try {
    const { markPaper } = require('../services/training/paper-marking.service');
    return res.json({ success: true, ...markPaper({ questions, answers }) });
  } catch (error) {
    // Fail CLOSED: an unmarked paper must never read as a scored one.
    logToFile('❌ Internal training API failed', { route: 'mark-paper', error: error?.message });
    return res.status(500).json({ success: false, error: 'Marking failed' });
  }
});

/**
 * POST /api/internal/training/serve-paper
 * Body { questions:[...], attemptId, isModuleQuiz, vendor:{module_quiz_strategy,
 *        exam_question_cap, shuffle_options} }
 *   → { success, questions: [{ id, display_order }], total_served }
 *
 * Which questions this attempt gets, and in which option order. Both surfaces
 * must serve the SAME paper: the caption has to quote the served count rather
 * than the bank size, and a shuffled option order has to be stable for the
 * attempt or a teacher's stored canonical index stops meaning what they tapped.
 *
 * Deterministic — seeded on attemptId — so asking twice for the same attempt
 * returns the same paper. That is what makes it safe to call from a stateless
 * portal request.
 */
router.post('/training/serve-paper', requireInternalKey, async (req, res) => {
  const { questions, attemptId, isModuleQuiz, vendor } = req.body || {};
  if (!Array.isArray(questions)) return res.status(400).json({ success: false, error: 'questions[] is required' });
  if (!attemptId) return res.status(400).json({ success: false, error: 'attemptId is required' });

  try {
    const Serving = require('../services/training/quiz-serving.service');
    const config = Serving.normalizeServingConfig(vendor || null);
    const served = Serving.selectServedQuestions(questions, {
      attemptId,
      isModuleQuiz: isModuleQuiz === true,
      config,
    });
    const out = served.map((q) => ({
      id: q.id,
      display_order: Serving.buildOptionDisplayOrder({
        optionCount: Array.isArray(q.options) ? q.options.length : 0,
        correctOption: q.correct_option,
        attemptId,
        questionId: q.id,
        shuffle: config.shuffle_options,
      }),
    }));
    return res.json({ success: true, questions: out, total_served: out.length });
  } catch (error) {
    logToFile('❌ Internal training API failed', { route: 'serve-paper', error: error?.message });
    return res.status(500).json({ success: false, error: 'Serving failed' });
  }
});

/* ------------------------------------------------------------------------- *
 * Certificates — the bot owns them, the portal asks.
 *
 * WHY THIS IS FORCED RATHER THAN PREFERRED
 * ----------------------------------------
 * certificate-pdf.service.js lives under bot/shared/, so its
 * `require('pdfkit')` resolves from bot/node_modules and then the repo root —
 * it never reaches dashboard/node_modules. The dashboard listing pdfkit in its
 * own package.json changes nothing, because Node resolves from the requiring
 * FILE's directory upward. A portal-side render therefore succeeds in a dev
 * tree where both installs happen to exist and fails in production: the worst
 * failure shape there is. Exactly the conclusion the LP enqueue reached above.
 *
 * TWO ROUTES, DELIBERATELY SPLIT
 *   /training/certificates     list only — never mints, never presigns
 *   /training/certificate-pdf  fetch-or-mint ONE, on a real request
 *
 * All 12,954 certificates in production have pdf_r2_key null (12,952 of them
 * from the migration import). They are minted the first time someone actually
 * asks for one, never in bulk and never while drawing a list — a teacher with
 * 40 certificates must not trigger 40 renders to see their names.
 *
 * IDENTITY stays with the caller: the portal knows who the session belongs to,
 * passes that userId, and every lookup filters on it. The bot never accepts a
 * bare certificate code, so a leaked code is not a download link.
 * ------------------------------------------------------------------------- */

/** Lazy-require the certificate service, matching every other route here. */
function certificateService() {
  return require('../services/training/certificate-pdf.service');
}

/**
 * POST /api/internal/training/certificates
 * Body { userId } → { success, certificates: [{ id, certificate_code, level_name,
 *                     teacher_name, issued_at, has_pdf }] }
 *
 * A pure read. On failure it 500s rather than answering `certificates: []` —
 * an empty list is a legitimate answer ("none yet"), so returning it on error
 * would tell a teacher their certificates do not exist.
 */
router.post('/training/certificates', requireInternalKey, async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

  try {
    const supabase = require('../config/supabase');
    const certificates = await certificateService().listCertificates(supabase, userId);
    return res.json({ success: true, certificates });
  } catch (error) {
    logToFile('❌ Internal certificates list failed', { userId, error: error?.message });
    return res.status(500).json({ success: false, error: 'Certificate lookup failed' });
  }
});

/**
 * POST /api/internal/training/certificate-pdf
 * Body { userId, certificateCode, disposition? }
 *   → 200 { success, certificate_code, level_name, teacher_name, issued_at,
 *           pdf_r2_key, download_url, minted }
 *   → 400 missing userId/certificateCode, or an unknown disposition
 *   → 401 bad key
 *   → 404 no such certificate FOR THIS USER
 *   → 502 render/upload/presign failed
 *
 * `disposition` (bd-2676) is 'attachment' (default, saves the file) or 'inline'
 * (renders it). The portal asks for inline behind its View button and attachment
 * behind Download; omitting it preserves the original save-the-file behaviour.
 *
 * Fetch-or-mint. `minted` tells the caller whether this request paid for a
 * render, which is worth having in the logs while the legacy backlog drains.
 *
 * A failure is reported as a failure. There is deliberately no 200-with-a-null
 * download_url: the caller cannot then tell "no such certificate" from "we
 * could not render it", and a silent success is how a comparable bug hid for
 * two days elsewhere in this codebase. Degrading is the CALLER's decision —
 * the portal turns a failure here into a certificate that still lists.
 */
router.post('/training/certificate-pdf', requireInternalKey, async (req, res) => {
  const { userId, certificateCode, disposition } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (!certificateCode) return res.status(400).json({ success: false, error: 'certificateCode is required' });

  try {
    const supabase = require('../config/supabase');
    const result = await certificateService().fetchOrMintCertificatePdf(supabase, {
      userId,
      certificateCode,
      // Omitted → the service's 'attachment' default. Passing undefined through
      // rather than defaulting here keeps ONE definition of the default.
      ...(disposition ? { disposition } : {}),
    });
    if (result.minted) {
      logToFile('🏆 Certificate PDF minted via internal API', { userId, certificateCode });
    }
    return res.json({ success: true, ...result });
  } catch (error) {
    const code = error && error.code;
    if (code === 'bad_request') {
      return res.status(400).json({ success: false, error: 'userId and certificateCode are required' });
    }
    if (code === 'not_found') {
      return res.status(404).json({ success: false, error: 'Certificate not found' });
    }
    if (code === 'mint_failed') {
      logToFile('❌ Certificate PDF mint failed via internal API', { userId, certificateCode, error: error.message });
      return res.status(502).json({ success: false, error: 'Certificate PDF could not be generated' });
    }
    logToFile('❌ Internal certificate-pdf failed', { userId, certificateCode, error: error?.message });
    return res.status(500).json({ success: false, error: 'Certificate lookup failed' });
  }
});

/* ------------------------------------------------------------------------- *
 * Classes — the portal's read and write path for the classes model.
 *
 * Both go through the bot rather than being reimplemented in the portal process,
 * for two reasons that have each already cost this deployment:
 *
 *   1. ONE WRITER. The portal once reimplemented the bot's training rules in its
 *      own process and the copies rotted silently while its comments still
 *      claimed parity. createClass() also writes the legacy student_lists mirror
 *      and adopts a colliding roster; a second implementation of that would
 *      diverge on the day someone changed one of them.
 *   2. ONE COPY CATALOG. Grade and subject labels live in ux-strings, in this
 *      process. Resolving them here means the portal renders the same words as
 *      WhatsApp instead of growing a third vocabulary.
 *
 * Requiring the bot's ClassService from the dashboard process was the other
 * option and is the trap: that require throws when a bot module reaches a
 * bot-only dependency, and the throw gets swallowed.
 * ------------------------------------------------------------------------- */

/**
 * Shape one class for the portal: codes for logic, labels for display.
 *
 * `display` comes from the class-manager endpoint's classDisplay, NOT a second
 * copy here. The first version of this function built its own string and was
 * therefore never taught about shifts — so a morning and an evening class of the
 * same grade and section rendered identically in the portal, indistinguishable.
 * Two display builders is the same mistake as two writers.
 */
function presentClass(row, who) {
  const { gradeLabelFor, subjectLabelFor } = require('../config/ux-strings');
  const { classDisplay } = require('./class-manager-endpoint');

  return {
    classId: row.classId,
    gradeCode: row.gradeCode,
    gradeLabel: gradeLabelFor(row.gradeCode, who) || row.gradeCode,
    section: row.section,
    shiftCode: row.shiftCode || 'morning',
    sessionCode: row.sessionCode,
    isClassTeacher: row.isClassTeacher,
    display: classDisplay(row.gradeCode, row.section, who, row.shiftCode),
    subjects: (row.subjectCodes || []).map((code) => ({
      code,
      label: subjectLabelFor(code, who) || code,
    })),
  };
}

/** The teacher row the labels and the school check both need. */
async function loadPortalTeacher(userId) {
  const supabase = require('../config/supabase');
  const { data, error } = await supabase
    .from('users')
    .select('id, school_id, preferred_language')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    logToFile('⚠️ internal/classes: user load failed', { userId, error: error.message });
    return null;
  }
  return data || null;
}

/**
 * POST /api/internal/classes/list
 *
 * The classes a teacher is assigned to, with display labels already resolved for
 * that teacher's language.
 *
 * Body   { userId }
 * Auth   x-api-key: INTERNAL_API_KEY
 * Errors 400 (missing userId), 401 (bad key)
 * Ok     200 { success: true, classes: [...], canAdd, currentSession }
 */
router.post('/classes/list', requireInternalKey, async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

  try {
    const ClassService = require('../services/classes/class.service');
    const { currentSessionCode } = require('./class-manager-endpoint');

    const teacher = await loadPortalTeacher(userId);
    const rows = await ClassService.listClassesForTeacher(userId);
    const currentSession = await currentSessionCode();

    return res.json({
      success: true,
      classes: rows.map((r) => presentClass(r, teacher || {})),
      // The portal must know NOT to offer the add form when we cannot satisfy it —
      // classes.school_id is NOT NULL and roughly one teacher in eight has none.
      canAdd: Boolean(teacher && teacher.school_id && currentSession),
      currentSession: currentSession || null,
    });
  } catch (error) {
    logToFile('❌ Internal classes/list failed', { userId, error: error?.message }, 'error');
    return res.status(500).json({ success: false, error: 'Failed to load classes' });
  }
});

/**
 * POST /api/internal/classes/options
 *
 * The grade and subject pickers, ordered and labelled for this teacher. Served
 * from the reference tables so the portal cannot drift from the seeded vocabulary.
 *
 * Body   { userId }
 * Ok     200 { success: true, grades: [{code,label}], subjects: [{code,label}] }
 */
router.post('/classes/options', requireInternalKey, async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

  try {
    const supabase = require('../config/supabase');
    const {
      gradeLabelFor, subjectLabelFor, shiftLabelFor, SUBJECT_LABELS,
    } = require('../config/ux-strings');
    const teacher = await loadPortalTeacher(userId);
    const who = teacher || {};

    const { data: gradeRows, error } = await supabase
      .from('grade_levels')
      .select('code, ordinal')
      .eq('is_active', true);

    if (error || !gradeRows) {
      logToFile('❌ Internal classes/options: grade_levels load failed', { error: error && error.message }, 'error');
      return res.status(500).json({ success: false, error: 'Failed to load options' });
    }

    const grades = [...gradeRows]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((r) => ({ code: r.code, label: gradeLabelFor(r.code, who) }))
      .filter((g) => Boolean(g.label));

    const subjects = Object.keys(SUBJECT_LABELS)
      .map((code) => ({ code, label: subjectLabelFor(code, who) }))
      .filter((s) => Boolean(s.label));

    // Closed vocabularies, read from their tables so a section support adds shows
    // up in the portal without a deploy.
    const readCodes = async (table) => {
      const { data } = await supabase.from(table).select('code, sort_order').eq('is_active', true);
      return [...(data || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((r) => r.code);
    };
    const sections = (await readCodes('sections')).map((code) => ({ code, label: code }));
    const shifts = (await readCodes('shifts')).map((code) => ({ code, label: shiftLabelFor(code, who) || code }));

    return res.json({ success: true, grades, subjects, sections, shifts });
  } catch (err) {
    logToFile('❌ Internal classes/options failed', { userId, error: err?.message }, 'error');
    return res.status(500).json({ success: false, error: 'Failed to load options' });
  }
});

/**
 * POST /api/internal/classes/create
 *
 * Create a class and assign the requesting teacher to it. Delegates to the SAME
 * ClassService the WhatsApp Flow uses, so the legacy mirror and the
 * at-most-one-class-teacher rule behave identically on both surfaces.
 *
 * Body   { userId, gradeCode, section?, subjectCodes?, isClassTeacher? }
 * Errors 400 (missing/unknown input), 401 (bad key), 409 (class teacher taken),
 *        422 (no school on file), 503 (no current session)
 * Ok     201 { success: true, class, created, mirrored }
 */
router.post('/classes/create', requireInternalKey, async (req, res) => {
  const {
    userId, gradeCode, section, shiftCode, subjectCodes, isClassTeacher,
  } = req.body || {};

  if (!userId || !gradeCode) {
    return res.status(400).json({ success: false, error: 'userId and gradeCode are required' });
  }

  try {
    const ClassService = require('../services/classes/class.service');
    const { currentSessionCode } = require('./class-manager-endpoint');

    const teacher = await loadPortalTeacher(userId);
    if (!teacher || !teacher.school_id) {
      // 422, not 400: the request is well formed, the account is not ready. The
      // portal turns this into the same sentence WhatsApp sends.
      return res.status(422).json({ success: false, error: 'no_school' });
    }

    const sessionCode = await currentSessionCode();
    if (!sessionCode) {
      logToFile('❌ Internal classes/create: no current academic session', { userId }, 'error');
      return res.status(503).json({ success: false, error: 'no_current_session' });
    }

    const result = await ClassService.createClass({
      schoolId: teacher.school_id,
      gradeCode,
      section,
      shiftCode: shiftCode || 'morning',
      sessionCode,
      teacherUserId: userId,
    });

    if (result.error || !result.class) {
      const BAD_INPUT = ['unknown_grade', 'unknown_session', 'unknown_section', 'unknown_shift'];
      const status = BAD_INPUT.includes(result.error) ? 400 : 500;
      return res.status(status).json({ success: false, error: result.error || 'create_failed' });
    }

    const assigned = await ClassService.assignTeacher({
      classId: result.class.id,
      teacherUserId: userId,
      isClassTeacher: Boolean(isClassTeacher),
      subjectCodes: Array.isArray(subjectCodes) ? subjectCodes : [],
    });

    if (assigned.error) {
      logToFile('⚠️ Internal classes/create: assignTeacher failed after createClass', {
        userId, classId: result.class.id, error: assigned.error,
      });
    }

    logToFile('🏫 Class created via internal API', {
      userId, classId: result.class.id, created: result.created, mirrored: result.mirrored,
    });

    // A declined claim is NOT a failure: the class exists and she is on it. It used
    // to 409, which lost the work and read as "nothing happened". Reported additively
    // so the caller can confirm the save AND name what was declined.
    return res.status(201).json({
      success: true,
      class: {
        classId: result.class.id,
        gradeCode: result.class.grade_code,
        section: result.class.section,
        shiftCode: result.class.shift_code,
        sessionCode: result.class.session_code,
      },
      created: result.created,
      mirrored: result.mirrored,
      classTeacherTaken: Boolean(assigned.classTeacherTaken),
      subjectsTaken: (assigned.subjectsTaken || []).map((t) => t.code),
      assignmentError: assigned.error || null,
    });
  } catch (error) {
    logToFile('❌ Internal classes/create failed', { userId, error: error?.message }, 'error');
    return res.status(500).json({ success: false, error: 'Failed to create class' });
  }
});

/**
 * POST /api/internal/classes/students/list
 *
 * The children on a class roster. Gated on the caller being assigned to the class —
 * a roster is not public. Answers an empty list rather than 403 for anyone else,
 * because the portal renders a list either way.
 *
 * Body   { userId, classId }
 * Ok     200 { success: true, students: [...] }
 */
router.post('/classes/students/list', requireInternalKey, async (req, res) => {
  const { userId, classId } = req.body || {};
  if (!userId || !classId) {
    return res.status(400).json({ success: false, error: 'userId and classId are required' });
  }
  try {
    const ClassService = require('../services/classes/class.service');
    const students = await ClassService.listStudents({ classId, teacherUserId: userId });
    return res.json({ success: true, students });
  } catch (error) {
    logToFile('❌ Internal classes/students/list failed', { userId, classId, error: error?.message }, 'error');
    return res.status(500).json({ success: false, error: 'Failed to load the roster' });
  }
});

/**
 * POST /api/internal/classes/students/add
 *
 * Add a whole register from one pasted block. Reports duplicates and anything the
 * paste cap dropped, so the caller can tell the teacher rather than leave her
 * wondering where her students went.
 *
 * Body   { userId, classId, rawText }
 * Errors 400 (missing input / no_names), 403 (not_assigned)
 * Ok     201 { success: true, added, duplicates, dropped }
 */
router.post('/classes/students/add', requireInternalKey, async (req, res) => {
  const { userId, classId, rawText } = req.body || {};
  if (!userId || !classId) {
    return res.status(400).json({ success: false, error: 'userId and classId are required' });
  }
  try {
    const ClassService = require('../services/classes/class.service');
    const result = await ClassService.addStudents({ classId, teacherUserId: userId, rawText });

    if (result.error === 'not_assigned') {
      return res.status(403).json({ success: false, error: 'not_assigned' });
    }
    if (result.error === 'no_names') {
      return res.status(400).json({ success: false, error: 'no_names' });
    }
    if (result.error) {
      // Part-way failures carry what DID land; saying "failed" would make her
      // re-paste children who are already on the roster.
      logToFile('❌ Internal classes/students/add partially failed', {
        userId, classId, added: result.added, error: result.error,
      }, 'error');
      return res.status(502).json({
        success: false, error: result.error, added: result.added || 0,
      });
    }

    logToFile('🏫 Roster updated via internal API', {
      userId, classId, added: result.added, duplicates: result.duplicates, dropped: result.dropped,
    });
    return res.status(201).json({
      success: true,
      added: result.added,
      duplicates: result.duplicates,
      dropped: result.dropped,
    });
  } catch (error) {
    logToFile('❌ Internal classes/students/add failed', { userId, classId, error: error?.message }, 'error');
    return res.status(500).json({ success: false, error: 'Failed to add students' });
  }
});

/**
 * POST /api/internal/classes/students/remove
 *
 * Take a child off the roster. SOFT — the enrollment is closed, the child and the
 * attendance history that references her both survive. Any teacher on the class may
 * do it, because the roster is the class's rather than hers.
 *
 * Body   { userId, classId, studentId }
 * Errors 400, 403 (not_assigned)
 * Ok     200 { success: true, removed }
 */
router.post('/classes/students/remove', requireInternalKey, async (req, res) => {
  const { userId, classId, studentId } = req.body || {};
  if (!userId || !classId || !studentId) {
    return res.status(400).json({ success: false, error: 'userId, classId and studentId are required' });
  }
  try {
    const ClassService = require('../services/classes/class.service');
    const result = await ClassService.removeStudent({ classId, teacherUserId: userId, studentId });

    if (result.error === 'not_assigned') {
      return res.status(403).json({ success: false, error: 'not_assigned' });
    }
    if (result.error) {
      logToFile('❌ Internal classes/students/remove failed', { userId, classId, error: result.error }, 'error');
      return res.status(502).json({ success: false, error: result.error });
    }
    return res.json({ success: true, removed: Boolean(result.removed) });
  } catch (error) {
    logToFile('❌ Internal classes/students/remove failed', { userId, classId, error: error?.message }, 'error');
    return res.status(500).json({ success: false, error: 'Failed to remove the student' });
  }
});

module.exports = router;
