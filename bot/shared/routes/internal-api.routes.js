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
 * Body { userId, certificateCode }
 *   → 200 { success, certificate_code, level_name, teacher_name, issued_at,
 *           pdf_r2_key, download_url, minted }
 *   → 400 missing userId/certificateCode
 *   → 401 bad key
 *   → 404 no such certificate FOR THIS USER
 *   → 502 render/upload/presign failed
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
  const { userId, certificateCode } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (!certificateCode) return res.status(400).json({ success: false, error: 'certificateCode is required' });

  try {
    const supabase = require('../config/supabase');
    const result = await certificateService().fetchOrMintCertificatePdf(supabase, { userId, certificateCode });
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

/** Shape one class for the portal: codes for logic, labels for display. */
function presentClass(row, who) {
  const {
    gradeLabelFor, subjectLabelFor,
  } = require('../config/ux-strings');

  const gradeLabel = gradeLabelFor(row.gradeCode, who);
  return {
    classId: row.classId,
    gradeCode: row.gradeCode,
    gradeLabel: gradeLabel || row.gradeCode,
    section: row.section,
    sessionCode: row.sessionCode,
    isClassTeacher: row.isClassTeacher,
    display: row.section && gradeLabel ? `${gradeLabel} - ${row.section}` : (gradeLabel || row.gradeCode),
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

// ─── v8 lesson-plan catalogue ───────────────────────────────────────────────
//
// The portal used to answer "which lesson plans exist?" from its own Supabase
// reads against curriculum_lp_ast + pre_generated_lps, while the K-5 Flow
// answered it from data/lp_catalog.json ∩ niete_lp_assets. Unrelated corpora:
// on prod, grade 5 maths was 0 chapters in the portal and 8 chapters / 87
// lessons on WhatsApp. These four routes make the bot the single answer, the
// way training rules and certificates already are.
//
// They return SURFACE-NEUTRAL data — full untruncated titles, no pagination,
// no on-click payloads. The Flow keeps building its own capped NavigationList
// rows from the same catalogue; the portal renders these. One source for what
// exists, each surface responsible for how it looks.

/** Shared wrapper: one require, one catch, one shape. Mirrors trainingRoute. */
function lpBrowseRoute(name, handler) {
  return async (req, res) => {
    try {
      const Browse = require('../services/lp-v8-browse.service');
      return await handler(Browse, req, res);
    } catch (error) {
      logToFile('❌ Internal LP catalogue API failed', { route: name, error: error?.message }, 'error');
      return res.status(500).json({ success: false, error: 'Lesson-plan catalogue lookup failed' });
    }
  };
}

/**
 * POST /api/internal/lp/v8/grades
 * Body {} → { success, grades: [{ grade, subject_count }] }
 */
router.post('/lp/v8/grades', requireInternalKey, lpBrowseRoute('grades', async (Browse, req, res) => {
  const grades = await Browse.listGrades();
  return res.json({ success: true, grades });
}));

/**
 * POST /api/internal/lp/v8/subjects
 * Body { grade } → { success, subjects: [{ subject_key, subject, rtl, lesson_count }] }
 */
router.post('/lp/v8/subjects', requireInternalKey, lpBrowseRoute('subjects', async (Browse, req, res) => {
  const grade = num((req.body || {}).grade);
  if (grade === null) return res.status(400).json({ success: false, error: 'grade is required' });

  const subjects = await Browse.listSubjects(grade);
  return res.json({ success: true, subjects });
}));

/**
 * POST /api/internal/lp/v8/chapters
 * Body { grade, subjectKey } → { success, chapters: [...] }
 */
router.post('/lp/v8/chapters', requireInternalKey, lpBrowseRoute('chapters', async (Browse, req, res) => {
  const grade = num((req.body || {}).grade);
  const subjectKey = String((req.body || {}).subjectKey || '').trim();
  if (grade === null) return res.status(400).json({ success: false, error: 'grade is required' });
  if (!subjectKey) return res.status(400).json({ success: false, error: 'subjectKey is required' });

  const chapters = await Browse.listChapters(grade, subjectKey);
  return res.json({ success: true, chapters });
}));

/**
 * POST /api/internal/lp/v8/lessons
 * Body { grade, subjectKey, chapterNumber, userId? } → { success, lessons: [...] }
 *
 * `userId` is optional and only drives the per-teacher `downloaded` tick. The
 * caller reads it from its SESSION — never from a request body — the same rule
 * the certificates client follows.
 */
router.post('/lp/v8/lessons', requireInternalKey, lpBrowseRoute('lessons', async (Browse, req, res) => {
  const body = req.body || {};
  const grade = num(body.grade);
  const subjectKey = String(body.subjectKey || '').trim();
  const chapterNumber = num(body.chapterNumber);
  if (grade === null) return res.status(400).json({ success: false, error: 'grade is required' });
  if (!subjectKey) return res.status(400).json({ success: false, error: 'subjectKey is required' });
  if (chapterNumber === null) return res.status(400).json({ success: false, error: 'chapterNumber is required' });

  const lessons = await Browse.listLessons(grade, subjectKey, chapterNumber, body.userId || null);
  return res.json({ success: true, lessons });
}));

/**
 * POST /api/internal/lp/v8/pdf
 * Body { lessonId, assetKind? } → { success, available, url?, version_stamp? }
 *
 * `available: false` (with HTTP 200) is a real answer — the lesson exists in
 * the catalogue but has no current asset yet. Only a genuine failure is a 5xx,
 * so the portal can tell "not rendered" apart from "we are broken".
 */
router.post('/lp/v8/pdf', requireInternalKey, lpBrowseRoute('pdf', async (Browse, req, res) => {
  const body = req.body || {};
  const lessonId = String(body.lessonId || '').trim();
  const assetKind = body.assetKind === 'answer_key' ? 'answer_key' : 'lesson';
  if (!lessonId) return res.status(400).json({ success: false, error: 'lessonId is required' });

  const hit = await Browse.lessonPdfUrl(lessonId, assetKind);
  if (!hit) return res.json({ success: true, available: false });
  return res.json({ success: true, available: true, ...hit });
}));

// ─── lesson plans, grades 6-12 ──────────────────────────────────────────────
//
// The portal's catalogue stops at grade 5. On WhatsApp a teacher reaches 5,466
// segments across grades 6-12, and where no lesson has been written yet the
// bot writes one on the spot.
//
// TWO THINGS MAKE THIS LANE DIFFERENT FROM /lp/v8/* ABOVE.
//
// 1. K-5 lessons are pre-rendered: a lesson exists iff its PDF is uploaded. A
//    6-12 SEGMENT always exists; only ~8% have a render on today's template.
//    So `ready` is a per-lesson fact the browse endpoints report, and a tap on
//    a lesson that is not ready starts real work.
// 2. That work takes a MEDIAN OF 172 SECONDS (p90 314s, measured over all 473
//    completed renders on production). The portal therefore cannot use the
//    request/response shape the AG uses for a ~25s job. `/request` answers 202
//    with a state, and the browser polls `/status`.
//
// As with the LP catalogue and the AG, the portal holds no lp612 logic and
// reads no lp612 table — everything here goes through the same services the
// WhatsApp Flow uses.

/** Shared wrapper: one require, one catch, one shape. Mirrors lpBrowseRoute. */
function lp612Route(name, handler) {
  return async (req, res) => {
    try {
      const Browse = require('../services/lp612-browse.service');
      return await handler(Browse, req, res);
    } catch (error) {
      logToFile('❌ Internal LP 6-12 API failed', { route: name, error: error?.message }, 'error');
      return res.status(500).json({ success: false, error: 'Lesson-plan lookup failed' });
    }
  };
}

/**
 * POST /api/internal/lp612/grades
 * Body {} → { success, grades: [{ grade }] }
 */
router.post('/lp612/grades', requireInternalKey, lp612Route('grades', async (Browse, req, res) => {
  const grades = await Browse.listGrades();
  return res.json({ success: true, grades });
}));

/**
 * POST /api/internal/lp612/subjects
 * Body { grade } → { success, subjects: [{ subject, lesson_count }] }
 */
router.post('/lp612/subjects', requireInternalKey, lp612Route('subjects', async (Browse, req, res) => {
  const grade = num((req.body || {}).grade);
  if (grade === null) return res.status(400).json({ success: false, error: 'grade is required' });

  const subjects = await Browse.listSubjects(grade);
  return res.json({ success: true, subjects });
}));

/**
 * POST /api/internal/lp612/chapters
 * Body { grade, subject } → { success, chapters: [...] }
 */
router.post('/lp612/chapters', requireInternalKey, lp612Route('chapters', async (Browse, req, res) => {
  const body = req.body || {};
  const grade = num(body.grade);
  const subject = String(body.subject || '').trim();
  if (grade === null) return res.status(400).json({ success: false, error: 'grade is required' });
  if (!subject) return res.status(400).json({ success: false, error: 'subject is required' });

  const chapters = await Browse.listChapters(grade, subject);
  return res.json({ success: true, chapters });
}));

/**
 * POST /api/internal/lp612/lessons
 * Body { grade, subject, chapterKey, lang? } → { success, lessons: [{ …, ready }] }
 *
 * `ready` is the field the UI must not drop. ~92% of taps are a cold miss, and
 * a teacher is entitled to know she is starting a three-minute job BEFORE she
 * starts it.
 */
router.post('/lp612/lessons', requireInternalKey, lp612Route('lessons', async (Browse, req, res) => {
  const body = req.body || {};
  const grade = num(body.grade);
  const subject = String(body.subject || '').trim();
  const chapterKey = String(body.chapterKey || '').trim();
  if (grade === null) return res.status(400).json({ success: false, error: 'grade is required' });
  if (!subject) return res.status(400).json({ success: false, error: 'subject is required' });
  if (!chapterKey) return res.status(400).json({ success: false, error: 'chapterKey is required' });

  const lang = clampLanguage(body.lang);
  const lessons = await Browse.listLessons(grade, subject, chapterKey, lang);
  return res.json({ success: true, lessons });
}));

/**
 * POST /api/internal/lp612/request
 * Body { segmentId, userId, lang? } → 202 { success, state, renderId?, url? }
 *
 * ALWAYS 202, NEVER 200-with-a-file, even on a cache hit. The four states the
 * serving path can answer with (`cache_hit`, `joined`, `retry`, `queued`) are
 * the same four whatever the surface, and a caller that has to handle "your
 * lesson is being written" anyway is not helped by a second, faster-looking
 * shape for the ~8% of taps that hit. One code path in the browser.
 *
 * `surface: 'portal'` is set HERE and is not read from the body — the same
 * rule the AG's `deliveryFor(surface)` follows. A body-supplied surface is one
 * forged request away from WhatsApping a lesson to a number the caller chose.
 */
router.post('/lp612/request', requireInternalKey, async (req, res) => {
  try {
    const body = req.body || {};
    const segmentId = String(body.segmentId || '').trim();
    const userId = String(body.userId || '').trim();
    if (!segmentId) return res.status(400).json({ success: false, error: 'segmentId is required' });
    if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

    const Serving = require('../services/lp612-serving.service');
    const out = await Serving.requestLesson({
      segmentId,
      userId,
      lang: clampLanguage(body.lang),
      surface: 'portal',
      correlationId: body.correlationId || null,
    });

    // `held` and `not_found` are real answers about a real request, not server
    // faults — 404/403 rather than a 5xx, so the browser can say something true.
    if (out.outcome === 'not_found') {
      return res.status(404).json({ success: false, error: 'That lesson is not in the catalogue' });
    }
    if (out.outcome === 'held') {
      return res.status(403).json({ success: false, error: 'That lesson is not available yet' });
    }
    if (out.outcome === 'error' || out.outcome === 'deliver_failed') {
      return res.status(500).json({ success: false, error: 'Could not start that lesson' });
    }

    return res.status(202).json({
      success: true,
      state: out.outcome === 'cache_hit' ? 'ready' : 'authoring',
      renderId: out.renderId || null,
      r2Key: out.r2Key || null,
      oneScreen: out.oneScreen || null,
    });
  } catch (error) {
    logToFile('❌ Internal LP 6-12 request failed', { error: error?.message }, 'error');
    return res.status(500).json({ success: false, error: 'Could not start that lesson' });
  }
});

/**
 * POST /api/internal/lp612/status
 * Body { renderId, userId } → { success, state, url?, oneScreen?, errorCode? }
 *
 * The poll. `state` is one of ready | authoring | failed, and a `ready` answer
 * carries a freshly presigned URL — never a raw R2 key, and never a URL minted
 * earlier and cached, because a presigned link expires.
 *
 * A render this teacher has no claim on answers 404, identically to one that
 * does not exist. Distinguishing them would let a caller enumerate other
 * teachers' renders by id.
 */
router.post('/lp612/status', requireInternalKey, lp612Route('status', async (Browse, req, res) => {
  const body = req.body || {};
  const renderId = String(body.renderId || '').trim();
  const userId = String(body.userId || '').trim();
  if (!renderId) return res.status(400).json({ success: false, error: 'renderId is required' });
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

  const row = await Browse.renderStatus(renderId, userId);
  if (!row) return res.status(404).json({ success: false, error: 'No such lesson request' });

  if (row.status === 'ready' && row.r2_key) {
    const { buildR2PublicUrl, getPresignedUrl } = require('../storage/r2');
    return res.json({
      success: true,
      state: 'ready',
      url: await getPresignedUrl(buildR2PublicUrl(row.r2_key)),
      oneScreen: row.one_screen || null,
      segmentId: row.segment_id,
    });
  }

  return res.json({
    success: true,
    // A `ready` row with no key is NOT ready — presigning `undefined` fails far
    // from here with nothing useful logged. The serving path makes the same
    // judgement for the same reason.
    state: row.status === 'failed' ? 'failed' : 'authoring',
    errorCode: row.error_code || null,
    segmentId: row.segment_id,
    startedAt: row.started_at || null,
  });
}));

/**
 * POST /api/internal/lp612/mine
 * Body { userId } → { success, lessons: [...] }
 *
 * "My lesson plans". Authoring takes a median of 172 seconds, so a teacher
 * WILL navigate away — without this list the lesson we already paid for is
 * lost to her.
 *
 * Deliberately does NOT presign every row: a list of fifty would mint fifty
 * URLs, most never clicked, all expiring. The list says which are ready; the
 * download endpoint mints one when she asks for it.
 */
router.post('/lp612/mine', requireInternalKey, lp612Route('mine', async (Browse, req, res) => {
  const userId = String((req.body || {}).userId || '').trim();
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });

  const rows = await Browse.myRenders(userId);
  const segments = await Promise.all(rows.map((r) => Browse.segmentById(r.segment_id)));

  return res.json({
    success: true,
    lessons: rows.map((r, i) => ({
      renderId: r.id,
      segmentId: r.segment_id,
      state: r.status === 'ready' && r.r2_key
        ? 'ready'
        : (r.status === 'failed' ? 'failed' : 'authoring'),
      lang: r.lang,
      startedAt: r.started_at || null,
      completedAt: r.completed_at || null,
      errorCode: r.error_code || null,
      // Null when the segment has since been superseded or withheld — the render
      // still happened, and hiding the row would be stranger than naming it thinly.
      title: segments[i] ? (segments[i].subtopic_title || segments[i].menu_title) : null,
      grade: segments[i] ? segments[i].grade : null,
      subject: segments[i] ? segments[i].subject : null,
    })),
  });
}));

module.exports = router;
