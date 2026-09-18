/**
 * Teacher Training — Quiz Delivery Service
 *
 * Inline Q-by-Q state machine that handles TWO quiz kinds:
 *
 *   1. Grand quiz (kind='grand')       — per-Level, BLOCKING, pass bar from
 *                                        training_vendors.passing_pct (NIETE
 *                                        80%, Beacon House 70%), 24h cooldown
 *                                        on failure.
 *   2. Training-module quiz (kind='training_module') — per-Module, BLOCKING
 *                                        since bd-2390: it GATES module
 *                                        completion. Bar from
 *                                        training_vendors.module_passing_pct
 *                                        (NIETE 100%, BH/Oxbridge 70%). No
 *                                        cooldown — retry is immediate.
 *
 * State lives entirely in DB:
 *   - training_assessment_attempts (id, user_id, quiz_kind, grand_quiz_id,
 *     training_module_id, level_id, program_id, current_question_index,
 *     total_questions, total_score, status, cooldown_until, is_passed, score)
 *   - training_assessment_answers  (attempt_id, question_index, question_id,
 *     chosen_option, is_correct)
 *
 * Grand-quiz flow:
 *   startGrandQuiz(userId, levelOrder)
 *     → creates attempt (kind='grand', status='in_progress', index=0)
 *     → sends Q1 as an interactive list message
 *
 * Training-quiz flow:
 *   startTrainingQuiz(userId, moduleId)
 *     → creates attempt (kind='training_module')
 *     → sends Q1 as an interactive list message
 *     → pass → gradeAttempt writes the progress row AND calls
 *       content-delivery.deliverNextModule (the module is released here, not
 *       on the button tap)
 *     → fail → no progress row, no next module, immediate retry offered
 *
 * Shared:
 *   sendQuestion(attemptId)             — renders current Q, or grades if done
 *   handleQuizButton(userId, replyId)   — records answer, advances index
 *   gradeAttempt(attemptId)             — branches on quiz_kind
 *
 * Button ID format is the same for both kinds:
 *   training_quiz_<attemptUuid>_<optionIndex1based>
 *
 * The option index in that id is ALWAYS the question's CANONICAL 1-based
 * option index — the one `correct_option` is written in and the one 400k+
 * historical answer rows hold. When option order is shuffled for display
 * (see quiz-serving.service) the translation happens at RENDER time, in the
 * row id, so nothing downstream — this handler, grading, the portal, the
 * analytics — ever sees a display position. The id format itself is
 * unchanged; only which options sit behind which letter moves.
 *
 * WHICH questions get served is likewise a decision, not "all of them":
 * quiz-serving.service picks the set from the vendor's config (one per
 * Bloom level for a module check, a random cap for a level exam) seeded on
 * the attempt id. It is stored nowhere, so every path here re-derives it.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { issueCertificate } = require('./certificate.service');
const { hasImageOptions, parseOptionImages, imageOptionRows } = require('./question-images.rules');
const {
  isPerModuleQuiz, moduleSourceQuizId, isLevelCertifyingAttempt, moduleExamPassMessage,
} = require('./isaps-module-exam.rules');
const {
  isOpenEndedQuestion, selectPaperWithOneCrq, isTextAnswerForOpenQuestion, scoreMixedPaper,
} = require('./isaps-crq-paper.rules');
// bd-2673 — the marking rule lives in ONE module, shared with the portal over
// the internal API. Do not re-implement isMultiKey/normalizeSet here: a second
// copy is the bug this extraction removed.
const {
  isMultiKey,
  normalizeAnswerKey,
} = require('./paper-marking.service');
const {
  DEFAULT_SERVING_CONFIG,
  normalizeServingConfig,
  selectServedQuestions,
  buildOptionDisplayOrder,
} = require('./quiz-serving.service');

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const MAX_OPTIONS = 10;         // WhatsApp interactive list row cap
const OPTION_DESC_MAX = 72;     // WhatsApp row description length cap
const COOLDOWN_HOURS = 24;

// ─── Multi-answer delivery surface ─────────────────────────────────────────
//
// Multi-answer questions have two possible surfaces:
//
//   Flow      — one WhatsApp Flow screen with a CheckboxGroup. The whole set
//               is picked and submitted in ONE interaction.
//   List      — the original fallback: one interactive-list row per option,
//               each tap toggling the stored selection, plus a "Done" row.
//
// The Flow is used iff TRAINING_MSQ_FLOW_ID is configured. That is deliberate
// and load-bearing: clearing the env var restores list delivery instantly,
// with no deploy and no code revert, and both surfaces persist the identical
// canonical `chosen_option`, so an attempt started on one can be finished on
// the other. Read at call time, not module load, so a restart is enough.
function msqFlowId() {
  return process.env.TRAINING_MSQ_FLOW_ID || '';
}

/**
 * The option cap the multi-answer DISPLAY ORDER is derived with.
 *
 * The list surface must reserve one of WhatsApp's 10 rows for "Done", so it
 * has always shown at most 9 options. The Flow has no such limit — but
 * buildOptionDisplayOrder seeds its permutation on the KEPT set, so a
 * different cap would letter the options differently on the two surfaces.
 * A teacher who saw the question as a list yesterday and as a Flow today
 * would be looking at a reordered question. Same cap, same order, always.
 */
const MULTI_OPTION_CAP = MAX_OPTIONS - 1;

/** Flow token format: `<userId>:training-msq:<attemptId>:<questionIndex>`. */
const MSQ_TOKEN_TAG = 'training-msq';

// bd-43496 — Meta's cap on an INTERACTIVE message body. A text message allows
// 4096 and this code used that number, so a long question was rejected outright
// with (#131009) "Body text length invalid. Min length: 1, Max length: 1024"
// rather than truncated. Every other quiz surface in the repo already uses
// 1024 (quiz-session.service, quiz-generation.service, and the MSQ branch
// below); this was the one place that did not.
const INTERACTIVE_BODY_MAX = 1024;

// Shown when a question cannot be delivered. The teacher gets a real sentence
// instead of silence, and the attempt is left where it is so a retry re-sends
// the SAME question rather than skipping it and marking it wrong.
const QUESTION_SEND_FAILED_MSG =
  "I couldn't display that question just now. Please tap Take exam again — nothing you've answered is lost.";

/** Truncate by CODE POINT, so a multi-byte question is never cut mid-character. */
function sliceCodePoints(text, max) {
  const cp = [...String(text ?? '')];
  return cp.length <= max ? String(text ?? '') : cp.slice(0, max).join('');
}

/**
 * The body the LIST surface would send for this question.
 *
 * Kept as one function so the size CHECK and the actual send can never drift
 * apart — measuring one string and sending a different one is how a cap gets
 * missed. `Selected: …` (multi-answer only) is added by the caller after this
 * and is bounded by the option letters, so it cannot push a fitting question
 * over the cap on its own.
 */
function listBodyText(question, options, optionsInBody) {
  let body = question.question_text || '(missing question text)';
  if (optionsInBody) {
    body += '\n\n' + options
      .map((o, i) => `${OPTION_LETTERS[i]}. ${cleanOptionText(o)}`)
      .join('\n');
  }
  return body;
}

const KIND_GRAND = 'grand';
const KIND_TRAINING_MODULE = 'training_module';

/**
 * Hand the teacher the actual certificate file after the congratulation
 * message. Purely additive: the message with the code has already gone out and
 * remains the source of truth, so a certificate with no PDF (`pdf_r2_key`
 * null — the state of every certificate issued before PDFs existed) simply
 * gets no attachment. Never throws; delivery must not fail grading.
 *
 * @param {string} phoneNumber
 * @param {{certificate_code?: string, level_name?: string, pdf_r2_key?: string|null}} cert
 */
async function deliverCertificatePdf(phoneNumber, cert) {
  try {
    if (!cert || !cert.pdf_r2_key) return;
    const { sendCertificateDocument } = require('./certificate-pdf.service');
    await sendCertificateDocument(phoneNumber, {
      certificate_code: cert.certificate_code,
      level_name: cert.level_name,
      pdf_r2_key: cert.pdf_r2_key,
    });
  } catch (err) {
    logToFile('❌ Certificate PDF delivery failed (message already sent)', {
      certificateCode: cert && cert.certificate_code, error: err.message,
    });
  }
}

// bd-2138 — multi-answer ("msq") questions. A question is multi iff its
// correct_option holds a comma-joined set ('1,3,5' — restored from the
// legacy `answers` array). Selection accumulates on the answers row across
// taps and is graded by SET EQUALITY when the teacher taps Done.
//
// bd-2673 — `isMultiKey` now comes from paper-marking.service (imported above)
// so the portal and WhatsApp cannot disagree about what counts as multi.
// The Set-based helpers below stay local on purpose: they serve WhatsApp's
// INCREMENTAL tap accumulation (a selection built up across several taps),
// which the portal has no equivalent of — it submits a complete paper in one
// request. normalizeSet(set) is normalizeAnswerKey([...set]) by construction.

function parseSet(str) {
  return new Set(String(str || '').split(',').map(s => s.trim()).filter(Boolean));
}

function normalizeSet(set) {
  return normalizeAnswerKey([...set]);
}

function setsEqual(a, b) {
  return a.size === b.size && [...a].every(x => b.has(x));
}

/**
 * Render a stored (canonical) selection as the letters the teacher can
 * actually see. With shuffled options the canonical index and the display
 * position differ, so the letter has to come from the display order — quoting
 * "Selected: A" for canonical 1 when canonical 1 is sitting in row C is how a
 * teacher ends up submitting a set they did not choose.
 *
 * @param {Set<string>} set canonical 1-based indices, as stored
 * @param {number[]} displayOrder canonical indices in display order
 */
function selectedLetters(set, displayOrder) {
  const order = Array.isArray(displayOrder) && displayOrder.length ? displayOrder : null;
  return [...set].map(Number).sort((a, b) => a - b)
    .map((n) => {
      const pos = order ? order.indexOf(n) : n - 1;
      return pos >= 0 ? (OPTION_LETTERS[pos] || String(n)) : String(n);
    })
    .join(', ');
}

// ─── Serving policy: which questions, in which option order ────────────────
//
// The rules live in quiz-serving.service (pure). What lives here is the
// lookup that feeds them — the same module → course → level → vendor walk the
// pass-mark helpers below already do, because that is where per-vendor policy
// is configured.

/**
 * Serving config for a level's vendor. Fail-open: any miss returns the
 * behaviour that shipped before serving selection existed (serve everything,
 * unshuffled), never a shorter or empty quiz.
 *
 * @param {number} levelId training_levels.id
 */
async function getServingConfigByLevel(levelId) {
  if (!levelId) return { ...DEFAULT_SERVING_CONFIG };
  try {
    const { data: level } = await supabase
      .from('training_levels').select('vendor_id').eq('id', levelId).maybeSingle();
    if (!level?.vendor_id) return { ...DEFAULT_SERVING_CONFIG };
    const { data: vendor } = await supabase
      .from('training_vendors')
      .select('key, module_quiz_strategy, exam_question_cap, shuffle_options')
      .eq('id', level.vendor_id)
      .maybeSingle();
    return normalizeServingConfig(vendor);
  } catch (err) {
    logToFile('⚠️ Could not resolve vendor serving config — serving everything', {
      levelId, error: err?.message,
    });
    return { ...DEFAULT_SERVING_CONFIG };
  }
}

/**
 * Same, starting from whichever handle the caller has. Module-quiz attempts
 * carry level_id, but older rows may not (the column is nullable for them),
 * hence the module → course → level fallback.
 */
async function getServingConfig({ levelId, moduleId }) {
  if (levelId) return getServingConfigByLevel(levelId);
  if (!moduleId) return { ...DEFAULT_SERVING_CONFIG };
  try {
    const { data: mod } = await supabase
      .from('training_modules').select('course_id').eq('id', moduleId).maybeSingle();
    if (!mod?.course_id) return { ...DEFAULT_SERVING_CONFIG };
    const { data: course } = await supabase
      .from('training_courses').select('level_id').eq('id', mod.course_id).maybeSingle();
    return await getServingConfigByLevel(course?.level_id);
  } catch (err) {
    logToFile('⚠️ Could not resolve vendor serving config by module — serving everything', {
      moduleId, error: err?.message,
    });
    return { ...DEFAULT_SERVING_CONFIG };
  }
}

/**
 * The active question bank for an attempt (or a not-yet-inserted attempt
 * shape), lightest columns only — the bank can be 400+ rows and all the
 * selection needs is identity, order and Bloom level.
 */
async function loadQuestionBank({ quizKind, trainingModuleId, grandQuizId }) {
  // bd-60131 — `options` and `correct_option` are part of the projection
  // because the CRQ rule needs the ANSWER SHAPE, not just the id. Without
  // them, isOpenEndedQuestion cannot tell an MCQ from a written answer: every
  // row read as open-ended, Module 1's 12-row bank collapsed to a single
  // question, and the exam resolved the module on one CRQ.
  let qBuilder = supabase
    .from('training_questions')
    .select('id, order_index, bloom_level, options, correct_option')
    .eq('is_active', true)
    .order('order_index', { ascending: true });
  qBuilder = quizKind === KIND_TRAINING_MODULE
    ? qBuilder.eq('training_module_id', trainingModuleId)
    : qBuilder.eq('grand_quiz_id', grandQuizId);
  const { data, error } = await qBuilder;
  if (error) {
    logToFile('❌ Question bank lookup failed', { quizKind, error: error.message });
    return [];
  }
  return data || [];
}

/**
 * The served question set for an EXISTING attempt, re-derived from scratch.
 *
 * Called independently by sendQuestion and handleQuizButton; both must land on
 * the same list or a teacher gets graded on a question they never saw. That
 * holds because every input is immutable: the attempt id, the bank, and the
 * vendor config.
 *
 * COMPATIBILITY. Attempts started before serving selection shipped snapshotted
 * total_questions = the whole bank. Serving them a 3-question paper now would
 * renumber indices they have already answered against. So when the snapshot
 * matches the FULL bank rather than the served set, the attempt keeps the full
 * bank and finishes the way it started. Option order is still shuffled — that
 * is per-render and harmless mid-attempt.
 *
 * @returns {Promise<{questions: object[], config: object}>}
 */
async function resolveServedQuestions(attempt) {
  const isModuleQuiz = attempt.quiz_kind === KIND_TRAINING_MODULE;
  const all = await loadQuestionBank({
    quizKind: attempt.quiz_kind,
    trainingModuleId: attempt.training_module_id,
    grandQuizId: attempt.grand_quiz_id,
  });
  if (all.length === 0) return { questions: [], config: { ...DEFAULT_SERVING_CONFIG } };

  const config = await getServingConfig({
    levelId: attempt.level_id,
    moduleId: isModuleQuiz ? attempt.training_module_id : null,
  });
  // bd-60128 — a folded I-SAPS module bank holds the module's MCQs AND all four
  // of its CRQs. Only ONE CRQ is sat per attempt, drawn on the attempt id, so
  // the generic selector would otherwise serve all four. Detected by the bank's
  // own shape rather than by vendor, so it cannot drift from the data.
  const bankHasOpenEnded = all.some(isOpenEndedQuestion);
  const served = bankHasOpenEnded
    ? selectPaperWithOneCrq(all, attempt.id)
    : selectServedQuestions(all, { attemptId: attempt.id, isModuleQuiz, config });

  const snapshot = Number(attempt.total_questions);
  // bd-60129 — the fallback below exists for attempts created BEFORE serving
  // selection shipped: their snapshot equals the full bank, so the bank is what
  // must be served. A folded I-SAPS paper legitimately serves FEWER than its
  // bank (one CRQ of four), so applying that fallback here would undo the
  // one-CRQ rule and shift every question index. It is skipped for such a bank.
  if (!bankHasOpenEnded
      && Number.isFinite(snapshot) && snapshot > 0
      && served.length !== snapshot && all.length === snapshot) {
    logToFile('🎓 Attempt predates serving selection — keeping the full bank', {
      attemptId: attempt.id, snapshot, wouldServe: served.length,
    });
    return {
      questions: selectServedQuestions(all, {
        attemptId: attempt.id, isModuleQuiz, config: DEFAULT_SERVING_CONFIG,
      }),
      config,
    };
  }
  return { questions: served, config };
}

async function loadPartialAnswer(attemptId, questionIndex) {
  const { data } = await supabase
    .from('training_assessment_answers')
    .select('chosen_option')
    .eq('attempt_id', attemptId)
    .eq('question_index', questionIndex)
    .maybeSingle();
  return parseSet(data?.chosen_option);
}

/**
 * Start a fresh grand quiz attempt for the given level.
 */
/**
 * bd-60120 — start the END-OF-MODULE exam for an I-SAPS module.
 *
 * I-SAPS assesses per module (doc §4): scenario MCQs plus one CRQ, keyed onto
 * per-module quizzes by bd-60119. This is the sibling of startGrandQuiz, and it
 * runs the SAME preconditions — which is the entire point. bd-2452/2453
 * hardened the level exam after a teacher sat one at 38/40 modules and minted a
 * duplicate certificate, because every CTA in this Flow is a tappable
 * EmbeddedLink with no disabled state. The endpoint's slot already refuses a
 * locked tap; this is the second line, for anything that reaches the service
 * directly.
 *
 * The MCQ set and the CRQ set are two rows (grand_quiz + capstone) sharing one
 * source_quiz_id. The MCQs run here; a capstone-only module delegates to the
 * capstone starter, exactly as the level path does.
 *
 * @param {string} userId
 * @param {number|string} courseId training_courses.id — the MODULE
 * @param {string} phoneNumber
 * @returns {Promise<boolean>}
 */
async function startModuleExam(userId, courseId, phoneNumber) {
  const courseIdNum = parseInt(String(courseId), 10);
  if (!Number.isFinite(courseIdNum)) {
    logToFile('⚠️ Invalid courseId for startModuleExam', { userId, courseId });
    await WhatsAppService.sendMessage(phoneNumber, 'Could not start the exam — please open /training again.');
    return false;
  }

  const { data: course } = await supabase
    .from('training_courses').select('id, title, level_id')
    .eq('id', courseIdNum).maybeSingle();
  if (!course?.level_id) {
    logToFile('⚠️ startModuleExam for an unknown course', { userId, courseId: courseIdNum });
    await WhatsAppService.sendMessage(phoneNumber, 'That module is not available. Please open /training again.');
    return false;
  }
  const m = /Module (\d+)/.exec(course.title || '');
  if (!m) {
    logToFile('⚠️ startModuleExam: course title carries no module number', {
      userId, courseId: courseIdNum, title: course.title,
    });
    await WhatsAppService.sendMessage(phoneNumber, 'No exam is configured for this module yet. Please contact NIETE support.');
    return false;
  }
  const srcId = moduleSourceQuizId(parseInt(m[1], 10));

  const { data: quizRows } = await supabase
    .from('training_grand_quizzes')
    .select('id, quiz_type')
    .eq('level_id', course.level_id)
    .eq('source_quiz_id', srcId)
    .eq('is_active', true);
  const quizzes = quizRows || [];
  const mcqQuiz = quizzes.find(q => q.quiz_type === 'grand_quiz') || null;
  const crqQuiz = quizzes.find(q => q.quiz_type === 'capstone') || null;
  if (!mcqQuiz && !crqQuiz) {
    logToFile('❌ Module exam lookup found nothing', { userId, courseId: courseIdNum, srcId });
    await WhatsAppService.sendMessage(phoneNumber, 'No exam is configured for this module yet. Please contact NIETE support.');
    return false;
  }

  // THE GATE — the endpoint's own slot, reused rather than re-derived, so the
  // screen and the service can never disagree about whether this exam is open.
  const { loadModulesWithProgress, loadModuleExamSlot } = require('../../routes/teacher-training-endpoint');
  const mods = await loadModulesWithProgress(userId, course.level_id);
  const slot = await loadModuleExamSlot(userId, course.level_id, courseIdNum, mods);
  if (!slot || !slot.ok) {
    logToFile('🎓 startModuleExam refused', {
      userId, courseId: courseIdNum, reason: slot ? slot.cta : 'no slot',
    });
    await WhatsAppService.sendMessage(phoneNumber, slot ? slot.body : 'That exam is not available yet.');
    return false;
  }

  // MCQs first when the module has them; the CRQ follows as its own capstone.
  if (!mcqQuiz) {
    const CapstoneDelivery = require('./capstone-delivery.service');
    return CapstoneDelivery.handleCapstoneButton(userId, `capstone_start_${course.level_id}`, phoneNumber);
  }

  const { data: assignment } = await supabase
    .from('teacher_training_assignments')
    .select('program_id').eq('user_id', userId).eq('is_active', true)
    .limit(1).maybeSingle();
  if (!assignment) {
    logToFile('❌ No active program for user', { userId });
    await WhatsAppService.sendMessage(phoneNumber, 'You are not enrolled in a training program yet. Please contact your NIETE coach.');
    return false;
  }

  const bank = await loadQuestionBank({ quizKind: KIND_GRAND, grandQuizId: mcqQuiz.id });
  if (bank.length === 0) {
    await WhatsAppService.sendMessage(phoneNumber, 'This module has no active exam questions yet. Please contact NIETE support.');
    return false;
  }

  // Resume an in-progress attempt rather than starting a second one.
  const { data: existing } = await supabase
    .from('training_assessment_attempts')
    .select('id, status, cooldown_until, current_question_index')
    .eq('user_id', userId).eq('grand_quiz_id', mcqQuiz.id)
    .order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (existing?.status === 'in_progress') {
    logToFile('🎓 Resuming in-progress module exam', { attemptId: existing.id });
    return await sendQuestion(existing.id, phoneNumber);
  }

  const now = new Date().toISOString();

  // bd-60129 — size the attempt to the SERVED paper, not the bank.
  //
  // The bank holds all four of the module's CRQs but only ONE is sat, so
  // `bank.length` over-counts by three. That mismatch was not merely cosmetic:
  // loadServedQuestions compares total_questions against what it would serve
  // and, when they disagree, decides the attempt "predates serving selection"
  // and falls back to the FULL bank — silently turning the one-CRQ rule off.
  // Four CRQs then shifted every index, so the question the code inspected was
  // not the question the teacher was looking at, her typed answer was never
  // claimed, and it fell through to ordinary LLM chat.
  //
  // The paper is drawn here with the same seed sendQuestion will use, so the
  // count and the content cannot disagree. Note the seed is the attempt id,
  // which does not exist yet — so the count is taken from a paper drawn with
  // the same RULE (all MCQs + exactly one CRQ), which is what determines
  // LENGTH regardless of which CRQ is picked.
  const servedCount = selectPaperWithOneCrq(bank, 'sizing').length;

  const { data: attempt, error: aErr } = await supabase
    .from('training_assessment_attempts')
    .insert({
      user_id: userId,
      program_id: assignment.program_id,
      quiz_kind: KIND_GRAND,
      grand_quiz_id: mcqQuiz.id,
      level_id: course.level_id,
      current_question_index: 0,
      total_questions: servedCount,
      total_score: servedCount,
      status: 'in_progress',
      started_at: now,
      last_activity_at: now,
    })
    .select('id').single();
  if (aErr || !attempt) {
    logToFile('❌ Module-exam attempt insert failed', {
      userId, courseId: courseIdNum, error: aErr?.message,
    });
    await WhatsAppService.sendMessage(phoneNumber, 'Could not start the exam — please try again in a moment.');
    return false;
  }

  await WhatsAppService.sendMessage(
    phoneNumber,
    `📝 *${course.title}* — module exam\n\n${servedCount} question${servedCount === 1 ? '' : 's'}. Your answers are saved as you go.`,
  );
  return await sendQuestion(attempt.id, phoneNumber);
}

async function startGrandQuiz(userId, levelOrder, phoneNumber) {
  const levelOrderIdx = (typeof levelOrder === 'number' ? levelOrder : parseInt(levelOrder, 10)) - 1;
  if (!Number.isFinite(levelOrderIdx) || levelOrderIdx < 0) {
    logToFile('⚠️ Invalid levelOrder for startGrandQuiz', { userId, levelOrder });
    await WhatsAppService.sendMessage(phoneNumber, 'Could not start the exam — please open /training again.');
    return false;
  }

  // bd-2452/2453 — ONE gate, shared with the Flow's start_grand_quiz branch.
  //
  // This used to resolve the level itself and start the exam unconditionally.
  // The Flow's "🔒 Locked" / "✓ Passed" CTAs are tappable EmbeddedLinks with no
  // disabled state, so an ungated start meant a teacher could sit a level exam
  // with the level unfinished (reproduced live at 38/40 modules), or re-sit an
  // already-certified level and mint a duplicate certificate.
  //
  // assertCanStartGrandQuiz resolves the level from the teacher's own scoped
  // catalog (bd-2392: order_index is per-vendor and not unique) AND checks
  // locked / no-exam / already-passed / cooldown / incomplete in one place.
  const { assertCanStartGrandQuiz } = require('../../routes/teacher-training-endpoint');
  const gate = await assertCanStartGrandQuiz(userId, levelOrder);
  if (!gate.ok) {
    logToFile('🎓 startGrandQuiz refused', { userId, levelOrder, reason: gate.reason });
    await WhatsAppService.sendMessage(phoneNumber, gate.message);
    return false;
  }
  const level = gate.level;
  logToFile('🎓 Resolved grand-quiz level', {
    userId, levelOrder, levelId: level.id, name: level.name, vendor: level.vendor_key,
  });

  // 2. The level's exam. bd-2476 — this used to filter quiz_type='grand_quiz'
  // only, so a Beacon House level (whose exam is a 'capstone') hit
  // "No grand quiz configured for this level yet" even though capstones 29-32
  // are active. bd-2474 widened the DISPLAY lookups but not this one, so the
  // Flow correctly offered an exam and then refused to start it — confirmed in
  // production: "❌ Grand quiz lookup failed levelId=18".
  //
  // One entry point, two engines: resolve by level, then route on type. The
  // capstone starter owns its own preconditions (bd-2454), so we delegate
  // rather than reimplementing them here.
  // bd-60120 — `.lt('source_quiz_id', ...)` is load-bearing, not cosmetic.
  // I-SAPS carries 18 PER-MODULE quizzes on one level (bd-60119), and
  // .maybeSingle() THROWS on more than one row — so without this filter every
  // I-SAPS exam start dies, and it takes the shared level-exam path down with
  // it. Legacy exams are 1-11, per-module are 900+, and a NULL source id is a
  // level exam, which is why the rows are fetched and narrowed in JS: SQL drops
  // NULLs from a `<` comparison (learned in bd-60119).
  const { data: levelQuizRows, error: qErr } = await supabase
    .from('training_grand_quizzes')
    .select('id, level_id, quiz_type, source_quiz_id')
    .eq('level_id', level.id)
    .in('quiz_type', ['grand_quiz', 'capstone'])
    .eq('is_active', true);
  const quiz = (levelQuizRows || []).find(q => !isPerModuleQuiz(q.source_quiz_id)) || null;
  if (qErr || !quiz) {
    logToFile('❌ Level exam lookup failed', { levelId: level.id, error: qErr?.message });
    await WhatsAppService.sendMessage(phoneNumber, 'No exam is configured for this level yet. Please contact NIETE support.');
    return false;
  }
  if (quiz.quiz_type === 'capstone') {
    logToFile('🎓 Level exam is a capstone — delegating to the capstone starter', {
      userId, levelId: level.id, quizId: quiz.id,
    });
    const CapstoneDelivery = require('./capstone-delivery.service');
    return CapstoneDelivery.handleCapstoneButton(userId, `capstone_start_${level.id}`, phoneNumber);
  }

  // 3. Program from assignment (needed for attempt row)
  const { data: assignment } = await supabase
    .from('teacher_training_assignments')
    .select('program_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!assignment) {
    logToFile('❌ No active program for user', { userId });
    await WhatsAppService.sendMessage(phoneNumber, 'You are not enrolled in a training program yet. Please contact your NIETE coach.');
    return false;
  }

  // 4. The question bank for this exam.
  const bank = await loadQuestionBank({ quizKind: KIND_GRAND, grandQuizId: quiz.id });
  if (bank.length === 0) {
    await WhatsAppService.sendMessage(phoneNumber, 'This level has no active exam questions yet. Please contact NIETE support.');
    return false;
  }

  // 5. Cooldown / in-progress guard
  const { data: existing } = await supabase
    .from('training_assessment_attempts')
    .select('id, status, cooldown_until, current_question_index')
    .eq('user_id', userId)
    .eq('grand_quiz_id', quiz.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.status === 'in_progress') {
    logToFile('🎓 Resuming in-progress attempt', { attemptId: existing.id });
    return await sendQuestion(existing.id, phoneNumber);
  }
  if (existing?.status === 'failed' && existing.cooldown_until && new Date(existing.cooldown_until) > new Date()) {
    const hoursLeft = Math.max(1, Math.round((new Date(existing.cooldown_until) - Date.now()) / 3_600_000));
    await WhatsAppService.sendMessage(
      phoneNumber,
      `⏳ You attempted this exam recently. Please try again in about *${hoursLeft} hours*.`
    );
    return true;
  }

  // 6. Create attempt.
  //
  // The id is minted HERE rather than by the database default, because the
  // served paper is seeded on it (quiz-serving.service) and total_questions
  // has to record the SERVED count — otherwise the pass ratio is measured
  // against questions the teacher was never asked. Chicken-and-egg with a
  // DB-generated id; a client-side uuid resolves it and the column keeps its
  // default for every other writer.
  const attemptId = crypto.randomUUID();
  const servingConfig = await getServingConfigByLevel(level.id);
  const served = selectServedQuestions(bank, {
    attemptId, isModuleQuiz: false, config: servingConfig,
  });
  const totalQuestions = served.length;
  logToFile('🎓 Exam paper selected', {
    attemptId, levelId: level.id, bank: bank.length, served: totalQuestions,
    cap: servingConfig.exam_question_cap,
  });

  const { data: attempt, error: aErr } = await supabase
    .from('training_assessment_attempts')
    .insert({
      id: attemptId,
      user_id: userId,
      program_id: assignment.program_id,
      quiz_kind: KIND_GRAND,
      grand_quiz_id: quiz.id,
      level_id: level.id,
      current_question_index: 0,
      total_questions: totalQuestions,
      total_score: totalQuestions, // one point per question; the pass bar is a % of this
      status: 'in_progress',
    })
    .select('id')
    .single();
  if (aErr || !attempt) {
    logToFile('❌ Attempt insert failed', { userId, error: aErr?.message });
    await WhatsAppService.sendMessage(phoneNumber, 'Could not start the exam — please try again in a moment.');
    return false;
  }

  // bd-2393 — quote the vendor's real bar (NIETE 80%, BH 70%), not "100%".
  const passPct = await getVendorPassingPctByLevel(level.id, 'exam');
  const needed = Math.ceil((passPct / 100) * totalQuestions);
  await WhatsAppService.sendMessage(
    phoneNumber,
    `🎓 *Level ${level.order_index + 1} · ${level.name} — Grand Quiz*\n\n` +
    `${totalQuestions} questions · You need *${passPct}% to pass* (${needed} of ${totalQuestions}).\n` +
    `If you fail, there's a ${COOLDOWN_HOURS}-hour cooldown before your next attempt.\n\n` +
    `Answer each question by tapping an option below.`
  );

  return await sendQuestion(attempt.id, phoneNumber);
}

/**
 * Start a fresh training-module quiz attempt.
 *
 * No cooldown check — a missed check can be retried immediately. But this
 * quiz DOES gate the module (bd-2390): the caller must send Q1 and stop, and
 * let gradeAttempt release the next module once the teacher passes.
 *
 * Returns:
 *   true  — quiz was started (Q1 sent) OR gracefully skipped because there
 *           are no questions or an in-progress attempt already exists.
 *   false — a hard error prevented the quiz (attempt insert failed, etc.).
 *           The caller should still deliver the next module regardless.
 */
async function startTrainingQuiz(userId, moduleId, phoneNumber) {
  const moduleIdNum = (typeof moduleId === 'number' ? moduleId : parseInt(moduleId, 10));
  if (!Number.isFinite(moduleIdNum) || moduleIdNum <= 0) {
    logToFile('⚠️ Invalid moduleId for startTrainingQuiz', { userId, moduleId }, 'warn');
    await WhatsAppService.sendMessage(phoneNumber,
      'Could not open that module check — please send /training and try again.');
    return false;
  }

  // 1. Module + course + level (level_id is optional on the attempt for
  // training-module quizzes; we still capture it if easy to derive).
  const { data: mod, error: mErr } = await supabase
    .from('training_modules')
    .select('id, course_id, title')
    .eq('id', moduleIdNum)
    .maybeSingle();
  if (mErr || !mod) {
    logToFile('❌ Module lookup failed', { moduleId: moduleIdNum, error: mErr?.message }, 'error');
    await WhatsAppService.sendMessage(phoneNumber,
      'Could not open that module check — please send /training and try again.');
    return false;
  }

  // 2. The active question bank for this module (the SERVED subset is chosen
  // at step 6, once the attempt id that seeds it exists).
  const bank = await loadQuestionBank({
    quizKind: KIND_TRAINING_MODULE, trainingModuleId: moduleIdNum,
  });

  const eligPayload = {
    user_uuid: userId,
    module_row_id: moduleIdNum,
    questions_found: bank.length,
    source: 'start_training_quiz',
  };
  logEvent('training_quiz_eligibility_checked', eligPayload);

  if (bank.length === 0) {
    // bd-2wzpi — the comment used to read "caller decides what to do next".
    // Neither caller checks the return value, so nobody decided and the teacher
    // got silence. Reachable from the Retry button, which does not pre-count
    // questions the way handleModuleDone does.
    //
    // loadQuestionBank returns [] for BOTH "no questions" and "the query
    // failed" — it logs the error and hands back an empty array. Telling a
    // teacher to carry on because a lookup blipped would wave her past a check
    // that gates her next module, so re-count before saying which it was.
    // Lazy require, matching how markModuleComplete is pulled in below — these
    // two modules reference each other and a top-level import would cycle.
    const { countActiveQuestions } = require('./progress.service');
    const actual = await countActiveQuestions(moduleIdNum);
    if (actual > 0) {
      logToFile('❌ Question bank came back empty but the module has questions', {
        userId, moduleId: moduleIdNum, expected: actual,
      }, 'error');
      await WhatsAppService.sendMessage(phoneNumber,
        'Could not load the questions for this module check — please try again in a moment.');
      return false;
    }
    logToFile('⚠️ Module check has no active questions', { userId, moduleId: moduleIdNum }, 'warn');
    await WhatsAppService.sendMessage(phoneNumber,
      'This module has no quick check yet — you can carry on to the next one.');
    return true;
  }

  // 3. Program (best-effort — may be null if unassigned; column is NOT NULL
  // on the attempts table so we require it).
  const { data: assignment } = await supabase
    .from('teacher_training_assignments')
    .select('program_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!assignment) {
    logToFile('⚠️ Cannot start module quiz — no active program assignment', { userId, moduleId: moduleIdNum }, 'warn');
    // Same sentence the level-exam path already sends on this exact condition.
    await WhatsAppService.sendMessage(phoneNumber,
      'You are not enrolled in a training program yet. Please contact your NIETE coach.');
    return false;
  }

  // 4. Derive level_id from course → level (nice-to-have for reporting; the
  // schema now allows attempts to have NULL level_id for module quizzes).
  let levelId = null;
  if (mod.course_id) {
    const { data: course } = await supabase
      .from('training_courses')
      .select('level_id')
      .eq('id', mod.course_id)
      .maybeSingle();
    levelId = course?.level_id || null;
  }

  // 5. If there's already an in-progress training-module attempt for this
  // module, resume it rather than starting a new one.
  const { data: existing } = await supabase
    .from('training_assessment_attempts')
    .select('id, status')
    .eq('user_id', userId)
    .eq('training_module_id', moduleIdNum)
    .eq('quiz_kind', KIND_TRAINING_MODULE)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.status === 'in_progress') {
    logToFile('🎓 Resuming in-progress training-module attempt', { attemptId: existing.id });
    return await sendQuestion(existing.id, phoneNumber);
  }

  // 6. Create attempt.
  //
  // The id is minted client-side because the served paper is seeded on it and
  // total_questions must be the SERVED count — see the same note in
  // startGrandQuiz. With one_per_bloom this is where a 9-question bank
  // becomes a 3-question check.
  const attemptId = crypto.randomUUID();
  const servingConfig = await getServingConfig({ levelId, moduleId: moduleIdNum });
  const served = selectServedQuestions(bank, {
    attemptId, isModuleQuiz: true, config: servingConfig,
  });
  const totalQuestions = served.length;
  logToFile('🎓 Module check paper selected', {
    attemptId, moduleId: moduleIdNum, bank: bank.length, served: totalQuestions,
    strategy: servingConfig.module_quiz_strategy,
  });

  const { data: attempt, error: aErr } = await supabase
    .from('training_assessment_attempts')
    .insert({
      id: attemptId,
      user_id: userId,
      program_id: assignment.program_id,
      quiz_kind: KIND_TRAINING_MODULE,
      training_module_id: moduleIdNum,
      level_id: levelId,
      current_question_index: 0,
      total_questions: totalQuestions,
      total_score: totalQuestions,
      status: 'in_progress',
    })
    .select('id')
    .single();
  if (aErr || !attempt) {
    logToFile('❌ Training-quiz attempt insert failed', { userId, moduleId: moduleIdNum, error: aErr?.message }, 'error');
    await WhatsAppService.sendMessage(phoneNumber,
      'Could not start the module check — please try again in a moment.');
    return false;
  }

  const startedPayload = {
    user_uuid: userId,
    attempt_uuid: attempt.id,
    module_row_id: moduleIdNum,
    total_qs: totalQuestions,
    bank_size: bank.length,
  };
  logEvent('training_quiz_started', startedPayload);

  // bd-2446 — this used to read "just a self-check — your progress isn't
  // blocked either way", which was true before bd-2390 and false after it.
  // The check IS the gate: the next module is released by gradeAttempt only
  // on a pass. Quote the same bar gradeAttempt marks against, and say the
  // one thing that takes the sting out of it — retries are immediate.
  const introPct = await getVendorPassingPct(moduleIdNum, 'module');
  await WhatsAppService.sendMessage(
    phoneNumber,
    `📝 *Module check — "${mod.title}"*\n\n` +
    `${totalQuestions} question${totalQuestions === 1 ? '' : 's'}. ` +
    `You need *${introPct}%* to unlock the next module — if you miss it you can retry straight away.`
  );

  return await sendQuestion(attempt.id, phoneNumber);
}

/**
 * Hydrate a selected question with the columns delivery/grading need.
 *
 * Selection runs on a light projection (id / order_index / bloom_level) so an
 * exam bank of 400+ rows is not dragged across the wire on every render; only
 * the one question actually being served is fetched in full.
 *
 * @param {{id: (string|number)}|undefined} selected
 */
async function loadQuestionForDelivery(selected) {
  if (!selected?.id) return null;
  const { data } = await supabase
    .from('training_questions')
    .select('id, question_text, options, correct_option, order_index, option_images')
    .eq('id', selected.id)
    .maybeSingle();
  return data || null;
}

/**
 * Fetch the current question for an attempt and send it to the teacher.
 * If the attempt has advanced past the last question, grades it.
 */
async function sendQuestion(attemptId, phoneNumber) {
  const { data: attempt } = await supabase
    .from('training_assessment_attempts')
    // level_id is needed for the bd-2393 per-question footer (vendor pass bar).
    // user_id is needed for the multi-answer Flow token: every Flow endpoint
    // in this repo resolves the teacher from segment 0 of the token, so the
    // token has to lead with it.
    .select('id, user_id, quiz_kind, grand_quiz_id, training_module_id, level_id, current_question_index, total_questions, status')
    .eq('id', attemptId)
    .single();
  if (!attempt) return false;
  if (attempt.status !== 'in_progress') {
    logToFile('⚠️ sendQuestion called on non-in-progress attempt', { attemptId, status: attempt.status });
    return false;
  }

  // Are we done?
  if (attempt.current_question_index >= attempt.total_questions) {
    return await gradeAttempt(attemptId, phoneNumber);
  }

  // The question at this index within the SERVED set — not the raw bank. The
  // set is re-derived (never stored); handleQuizButton derives the identical
  // one from the identical inputs.
  const { questions: served, config: servingConfig } = await resolveServedQuestions(attempt);
  const q = await loadQuestionForDelivery(served[attempt.current_question_index]);
  if (!q) {
    logToFile('⚠️ No question at index', { attemptId, index: attempt.current_question_index });
    return await gradeAttempt(attemptId, phoneNumber);
  }

  // bd-60128 — an OPEN-ENDED question (the I-SAPS CRQ) is answered by typing,
  // so it goes out as plain text and returns here. This MUST precede the
  // option handling below: a CRQ has no options, and that path treats "no
  // options" as bad data — it records a wrong answer and advances, which would
  // silently score every CRQ zero without the teacher ever seeing it.
  if (isOpenEndedQuestion(q)) {
    const sentOpen = await WhatsAppService.sendMessage(
      phoneNumber,
      `*Q${attempt.current_question_index + 1}/${attempt.total_questions}*\n\n`
      + `${q.question_text || ''}\n\n`
      + '_Type your answer as a message. Take your time — it is marked against '
      + 'the I-SAPS rubric._',
    );
    // bd-43496 — never claim a delivery that did not happen: an unreported
    // failure leaves the attempt in_progress on a question never seen, and
    // every retry resumes onto the same one.
    if (sentOpen === false) {
      logToFile('❌ Open-ended question send failed', {
        attemptId: attempt.id, questionId: q.id, index: attempt.current_question_index,
      }, 'error');
      await WhatsAppService.sendMessage(phoneNumber, QUESTION_SEND_FAILED_MSG);
      return false;
    }
    return true;
  }

  // WhatsApp interactive list — one row per option (A, B, C, ...). Multi
  // questions reserve one row for the Done submit action (10-row list cap).
  const optionCap = isMultiKey(q.correct_option) ? MULTI_OPTION_CAP : MAX_OPTIONS;
  const allOptions = Array.isArray(q.options) ? q.options : [];
  // Canonical 1-based option indices, capped and (optionally) permuted for
  // display. The permutation is seeded on (attempt, question) so a re-render
  // after a multi-select tap — or a resume tomorrow — shows the same letters
  // against the same text.
  const displayOrder = buildOptionDisplayOrder({
    optionCount: allOptions.length,
    correctOption: q.correct_option,
    cap: optionCap,
    attemptId: attempt.id,
    questionId: q.id,
    shuffle: servingConfig.shuffle_options,
  });
  const options = displayOrder.map(canonical => allOptions[canonical - 1]);
  if (options.length === 0) {
    // Bad question data — skip it (count as wrong, advance).
    logToFile('⚠️ Question has no options, skipping', { questionId: q.id });
    await recordAnswer(attempt.id, attempt.current_question_index, q.id, '', false);
    await supabase.from('training_assessment_attempts').update({
      current_question_index: attempt.current_question_index + 1,
      last_activity_at: new Date().toISOString(),
    }).eq('id', attempt.id);
    return await sendQuestion(attempt.id, phoneNumber);
  }

  // Multi-answer questions go out as a Flow when one is configured: a single
  // CheckboxGroup screen the teacher fills once, instead of one round-trip per
  // option plus a Done tap. The screen's contents are NOT sent here — the Flow
  // endpoint's INIT builds them from this same attempt + question, so there is
  // one derivation, not two. All this message carries is the token that names
  // the question.
  const multiAnswer = isMultiKey(q.correct_option);

  // bd-2230 — WhatsApp list rows truncate descriptions at OPTION_DESC_MAX
  // (72). When any option would be cut, render the FULL options as lettered
  // lines inside the body and reduce the rows to bare letters so nothing the
  // teacher must read is lost.
  const optionsInBody = options.some(o => String(o || '').length > OPTION_DESC_MAX);

  // bd-43496 — how long the LIST rendering would actually be. Measured before
  // the surface is chosen, because it is what decides the surface: options
  // pushed into the body by the line above are what blow Meta's 1024-char
  // interactive-body cap. On the live NIETE "Teacher Leader" exam that was 21
  // of 45 questions, so no 20-question paper could be completed at all.
  //
  // Measured in code points, not UTF-16 units: Meta counts characters, and an
  // Urdu question would otherwise be over-counted and needlessly routed away
  // from the fast path.
  const listBodyLength = [...listBodyText(q, options, optionsInBody)].length;
  const listBodyFits = listBodyLength <= INTERACTIVE_BODY_MAX;

  // The Flow surface carries the options in its CheckboxGroup data-source
  // instead of in the body, so the body holds the question alone — which is
  // exactly the headroom an oversized list rendering needs. It is therefore
  // the delivery surface for BOTH multi-answer questions (always, so one tap
  // submits the set) and single-answer questions that cannot fit a list.
  if ((multiAnswer || !listBodyFits) && msqFlowId()) {
    const flowBody = String(q.question_text || (multiAnswer ? 'Select all that apply.' : 'Choose one option.'));
    if (!multiAnswer) {
      logToFile('🎓 Oversized question — routing to the MSQ Flow', {
        attemptId: attempt.id, questionId: q.id, index: attempt.current_question_index,
        listBodyLength, cap: INTERACTIVE_BODY_MAX,
      });
    }
    const sentFlow = await WhatsAppService.sendFlow(phoneNumber, {
      flowId: msqFlowId(),
      header: `Q${attempt.current_question_index + 1}/${attempt.total_questions}`,
      body: sliceCodePoints(flowBody, INTERACTIVE_BODY_MAX),
      footer: multiAnswer ? 'Select all that apply' : 'Choose one option',
      buttonText: 'Answer',
      // Leads with the teacher's own id (segment 0 is how every Flow endpoint
      // here resolves the user) and names the exact question, so a submission
      // from a Flow message re-opened after the quiz moved on is recognised as
      // stale and dropped instead of overwriting a newer answer.
      flowToken: `${attempt.user_id}:${MSQ_TOKEN_TAG}:${attempt.id}:${attempt.current_question_index}`,
    });
    // bd-43496 — never claim a delivery that did not happen: an unreported
    // failure leaves the attempt in_progress on a question the teacher never
    // saw, and every retry resumes onto the same one. That is the silence.
    if (sentFlow === false) {
      logToFile('❌ Question Flow send failed', {
        attemptId: attempt.id, questionId: q.id, index: attempt.current_question_index,
      }, 'error');
      await WhatsAppService.sendMessage(phoneNumber, QUESTION_SEND_FAILED_MSG);
      return false;
    }
    return true;
  }
  if (multiAnswer) {
    logToFile('⚠️ TRAINING_MSQ_FLOW_ID not set — falling back to list + Done delivery', {
      attemptId: attempt.id, questionId: q.id, index: attempt.current_question_index,
    });
  }
  if (!listBodyFits) {
    // No Flow configured and the list cannot carry it. Truncating silently
    // would mark a teacher on text she cannot read, so say so instead.
    logToFile('❌ Question exceeds the interactive body cap and no MSQ Flow is configured', {
      attemptId: attempt.id, questionId: q.id, index: attempt.current_question_index,
      listBodyLength, cap: INTERACTIVE_BODY_MAX,
    }, 'error');
    await WhatsAppService.sendMessage(phoneNumber, QUESTION_SEND_FAILED_MSG);
    return false;
  }

  // bd-60118 — options that are PICTURES. I-SAPS M1 item 1.6 ships its four
  // choices as one embedded grid; the panels are split, each stamped with its
  // option number, and sent as their own images just before the list.
  //
  // The shuffle is deliberately BYPASSED here. displayOrder permutes which text
  // sits behind which letter, but the number is burned into the bitmap — a
  // shuffled row would point at a panel the teacher never saw under that
  // number. Fixed order is what keeps picture and button agreeing.
  const optionImages = parseOptionImages(q.option_images);
  const imageMode = optionImages.length > 0;
  if (imageMode) {
    for (let i = 0; i < optionImages.length; i += 1) {
      // Failure to send ONE panel must not strand the attempt: the teacher
      // still gets the list, and the log names the panel that went missing.
      try {
        await WhatsAppService.sendImageFromUrl(
          phoneNumber, optionImages[i], `Option ${i + 1}`,
        );
      } catch (err) {
        logToFile('⚠️ Option image send failed', {
          attemptId: attempt.id, questionId: q.id, option: i + 1, error: err?.message,
        }, 'warn');
      }
    }
  }

  const rows = imageMode
    ? imageOptionRows(optionImages, attempt.id)
    : options.map((text, i) => ({
      // The id carries the CANONICAL index, so the shuffle never escapes the
      // rendering layer — everything downstream keeps speaking the DB's own
      // 1-based option numbering.
      id: `training_quiz_${attempt.id}_${displayOrder[i]}`,
      title: OPTION_LETTERS[i],
      // Full text lives in the body when it would truncate here (bd-2230).
      description: optionsInBody ? '' : (text || '').toString().slice(0, OPTION_DESC_MAX),
    }));

  const multi = isMultiKey(q.correct_option);
  // Built by the same helper the size check used, so the string measured above
  // and the string sent below cannot drift apart (bd-43496).
  let bodyText = listBodyText(q, options, optionsInBody);
  // bd-2393 — the exam footer quoted a flat "100% required", which is not the
  // marking policy for any vendor's level exam (NIETE 80, BH 70).
  let footer;
  if (attempt.quiz_kind === KIND_TRAINING_MODULE) {
    // bd-2446 — "Self-check" undersold a gate. Quote the module bar, the way
    // the exam branch below quotes the exam bar.
    const modulePct = await getVendorPassingPct(attempt.training_module_id, 'module');
    footer = `${modulePct}% required · tap an option`;
  } else {
    const footerPct = await getVendorPassingPctByLevel(attempt.level_id, 'exam');
    footer = `${footerPct}% required to pass · tap an option`;
  }

  if (multiAnswer) {
    rows.push({
      id: `training_quiz_${attempt.id}_done`,
      title: '✅ Done',
      description: 'Submit your selected answers',
    });
    const selected = await loadPartialAnswer(attempt.id, attempt.current_question_index);
    if (selected.size > 0) bodyText += `\n\nSelected: ${selectedLetters(selected, displayOrder)}`;
    footer = 'Select all that apply, then tap Done';
  }

  const sent = await WhatsAppService.sendInteractiveMessage(phoneNumber, {
    header: { type: 'text', text: `Q${attempt.current_question_index + 1}/${attempt.total_questions}` },
    // bd-43496 — 1024, not 4096: that is Meta's cap for an INTERACTIVE body.
    body: { text: sliceCodePoints(bodyText, INTERACTIVE_BODY_MAX) },
    footer: { text: footer },
    action: {
      button: 'Answer',
      sections: [{ title: 'Options', rows }],
    },
  });
  // bd-43496 — the result used to be discarded and `true` returned regardless,
  // so a rejected send read as delivered and left the attempt frozen on a
  // question the teacher never received.
  if (sent === false) {
    logToFile('❌ Question list send failed', {
      attemptId: attempt.id, questionId: q.id, index: attempt.current_question_index,
      bodyLength: [...bodyText].length,
    }, 'error');
    await WhatsAppService.sendMessage(phoneNumber, QUESTION_SEND_FAILED_MSG);
    return false;
  }
  return true;
}

/**
 * Handle a list-reply from the teacher for a quiz question.
 * ID format: training_quiz_<attemptId>_<optionIndex1based>
 *
 * @param {string} userId
 * @param {string} replyId
 * @param {string} phoneNumber
 * @param {string} [messageId] the inbound wamid of the teacher's tap. Optional
 *        — bd-2525 reacts ✅/❌ on it when present, and simply skips the
 *        reaction when a caller does not have one (the text feedback still
 *        goes out either way, so no path loses its verdict).
 */
async function handleQuizButton(userId, replyId, phoneNumber, messageId = null) {
  const m = /^training_quiz_([a-f0-9-]{36})_(\d+|done)$/.exec(replyId || '');
  if (!m) {
    logToFile('⚠️ Unrecognized training quiz reply id', { replyId });
    return false;
  }
  const attemptId = m[1];
  const chosen = m[2]; // "1", "2", "3", ... or "done" (multi-select submit)

  const { data: attempt } = await supabase
    .from('training_assessment_attempts')
    // level_id joins the vendor's serving config — the same config sendQuestion
    // used to choose the paper, so both derive the same served set.
    .select('id, user_id, quiz_kind, grand_quiz_id, training_module_id, level_id, current_question_index, total_questions, status')
    .eq('id', attemptId)
    .single();
  if (!attempt) {
    logToFile('⚠️ Attempt not found', { attemptId });
    return false;
  }
  if (attempt.user_id !== userId) {
    logToFile('⚠️ Attempt user_id mismatch', { attemptId, attempt_user: attempt.user_id, actual: userId });
    return false;
  }
  if (attempt.status !== 'in_progress') {
    logToFile('⚠️ Answer on non-in-progress attempt', { attemptId, status: attempt.status });
    return false;
  }

  // Load the current question to check correctness. Re-derives the served set
  // exactly as sendQuestion did — same attempt id, same bank, same vendor
  // config, therefore same question. `chosen` is already the CANONICAL option
  // index (the row id carries it), so no display-order translation is needed
  // here and nothing shuffled ever reaches storage.
  const { questions: served } = await resolveServedQuestions(attempt);
  const q = await loadQuestionForDelivery(served[attempt.current_question_index]);
  if (!q) {
    logToFile('⚠️ Question missing when recording answer', { attemptId, idx: attempt.current_question_index });
    return false;
  }

  // bd-2138 — multi-answer branch. Option taps toggle the stored selection
  // and re-render the question; the "done" row grades set equality.
  if (isMultiKey(q.correct_option)) {
    const selected = await loadPartialAnswer(attempt.id, attempt.current_question_index);

    if (chosen === 'done') {
      if (selected.size === 0) {
        // Nothing picked yet — re-prompt, no grade, no advance.
        return await sendQuestion(attempt.id, phoneNumber);
      }
      const isCorrect = setsEqual(selected, parseSet(q.correct_option));
      await recordAnswer(attempt.id, attempt.current_question_index, q.id, normalizeSet(selected), isCorrect);
      await supabase.from('training_assessment_attempts').update({
        current_question_index: attempt.current_question_index + 1,
        last_activity_at: new Date().toISOString(),
      }).eq('id', attempt.id);
      return await sendQuestion(attempt.id, phoneNumber);
    }

    // Toggle the tapped option in the selection set.
    if (selected.has(chosen)) selected.delete(chosen);
    else selected.add(chosen);
    await recordAnswer(attempt.id, attempt.current_question_index, q.id, normalizeSet(selected), false);
    return await sendQuestion(attempt.id, phoneNumber);
  }

  if (chosen === 'done') {
    // "done" on a single-answer question — stale tap from a re-rendered
    // multi question that has since advanced; ignore.
    logToFile('⚠️ done tap on single-answer question', { attemptId, idx: attempt.current_question_index });
    return false;
  }

  const isCorrect = String(q.correct_option).trim() === String(chosen).trim();
  await recordAnswer(attempt.id, attempt.current_question_index, q.id, chosen, isCorrect);

  // bd-2523 — say so, immediately. The grade above was already computed and
  // stored, then discarded: the teacher answered four questions and only found
  // out at the end that two were wrong, with no way to tell which. A NIETE
  // reviewer flagged it as P1 ("difficult to track progress").
  //
  // Sent BEFORE the next question so it reads as a verdict on the one just
  // answered, and wrapped because it is a courtesy — if this single message
  // fails to deliver, the quiz must still advance rather than strand the
  // attempt mid-flight.
  //
  // Deliberately does NOT reveal the correct option. Module quizzes have no
  // cooldown and NIETE's bar is 100%, so a teacher retries immediately;
  // showing the answer would train recall of the letter rather than the idea.
  // bd-2524 will add the WHY here — the source question bank has per-option
  // explanations for ~43% of questions that were never migrated — which
  // extends this message rather than replacing it. That is also when the
  // wrong-answer line earns a 💡: there will finally be an insight after it.
  //
  // bd-2525, two parts:
  //
  //  1. React on the teacher's OWN tap. A reaction is the right shape for a
  //     one-glyph verdict — it lands on their reply at the bottom of the
  //     thread, where their eye already is, and costs no extra bubble. It has
  //     to be their message: sendInteractiveMessage returns a bare boolean, so
  //     the question we sent has no id we could react to.
  //
  //  2. Copy. "❌ Not quite" pulled in two directions — ❌ is the loudest mark
  //     in the set while "not quite" hedges, implying a near miss that often
  //     was not one. An adult professional needs the fact stated plainly. The
  //     thin ✗ carries "wrong" without the red-block shout and matches the ✓
  //     family; the heavy ❌ stays where it works, on the reaction.
  // Shared with the Flow surface (bd-43496) so the two can never drift apart on
  // either signal or copy.
  await sendAnswerVerdict(phoneNumber, isCorrect, messageId, {
    attemptId: attempt.id, index: attempt.current_question_index,
  });

  const nextIdx = attempt.current_question_index + 1;
  await supabase.from('training_assessment_attempts').update({
    current_question_index: nextIdx,
    last_activity_at: new Date().toISOString(),
  }).eq('id', attempt.id);

  return await sendQuestion(attempt.id, phoneNumber);
}

// ─── Multi-answer Flow surface ─────────────────────────────────────────────
//
// Everything below serves the CheckboxGroup Flow. It shares every derivation
// with the list surface — the served set, the display order, the partial
// selection, the set-equality grade — so the two are the same question asked
// two ways, and `chosen_option` comes out identical either way.

/**
 * Resolve the multi-answer question an attempt is currently on, with the
 * option order it is being displayed in.
 *
 * Re-derived from scratch, exactly as sendQuestion and handleQuizButton do:
 * the served set is stored nowhere, so every path must reach the same answer
 * from the same immutable inputs (attempt id, bank, vendor config).
 *
 * @param {string} attemptId
 * @param {number|string} questionIndex the index the caller believes it is
 *        answering. A mismatch with the attempt's own cursor means a stale
 *        submission — an old Flow message re-opened after the quiz moved on —
 *        and is refused rather than allowed to overwrite a newer answer.
 * @returns {Promise<{reason?: string, attempt?: object, question?: object,
 *                    allOptions?: any[], displayOrder?: number[], index?: number}>}
 */
async function resolveMsqQuestion(attemptId, questionIndex) {
  const { data: attempt } = await supabase
    .from('training_assessment_attempts')
    .select('id, user_id, quiz_kind, grand_quiz_id, training_module_id, level_id, current_question_index, total_questions, status')
    .eq('id', attemptId)
    .maybeSingle();
  if (!attempt) return { reason: 'attempt_not_found' };
  if (attempt.status !== 'in_progress') return { reason: 'attempt_not_in_progress' };

  const index = attempt.current_question_index;
  const claimed = Number(questionIndex);
  if (Number.isFinite(claimed) && claimed !== index) return { reason: 'stale_question' };

  const { questions: served, config } = await resolveServedQuestions(attempt);
  const question = await loadQuestionForDelivery(served[index]);
  if (!question) return { reason: 'question_not_found' };
  // bd-43496 — single-answer questions reach this Flow too now: it is the only
  // surface that can carry a question whose list rendering exceeds Meta's
  // 1024-char interactive body. The screen constrains them to one selection
  // via max_selected, and grading is answer-count agnostic (setsEqual over a
  // one-element set), so nothing downstream needs to know which surface was
  // used. Refusing them here is what made the oversized ones undeliverable.
  const multiAnswer = isMultiKey(question.correct_option);

  const allOptions = Array.isArray(question.options) ? question.options : [];
  const displayOrder = buildOptionDisplayOrder({
    optionCount: allOptions.length,
    correctOption: question.correct_option,
    // A single-answer question has no "Done" row to reserve, so it may use all
    // MAX_OPTIONS slots; multi-answer keeps the shared cap so the list and Flow
    // surfaces letter the same question identically.
    cap: multiAnswer ? MULTI_OPTION_CAP : MAX_OPTIONS,
    attemptId: attempt.id,
    questionId: question.id,
    shuffle: config.shuffle_options,
  });
  if (displayOrder.length === 0) return { reason: 'no_options' };

  return { attempt, question, allOptions, displayOrder, index, multiAnswer };
}

// bd-43496 — the REAL Meta caps for a Radio/Checkbox data-source row. The title
// was set to 80 here, which is nearly 3x the actual limit, so the device clipped
// it mid-word and the same opening text was then repeated by the description.
// Verified against the documented component table (whatsapp-flows skill).
const MSQ_OPTION_TITLE_MAX = 30;    // Radio/Checkbox option title
// A row `description` ACCEPTS 300 but the device renders only ~3 lines (~140
// code points) and ellipsizes — measured on-device 2026-08-24. The answer text
// therefore lives in the screen's TextBody; this shorter budget is only for the
// row echo, kept inside one clean line so it never looks truncated.
const MSQ_ROW_ECHO_MAX = 120;

/**
 * A row for one option: a short lettered label, with the answer text in full
 * underneath.
 *
 * The title is NOT a truncated copy of the answer — at 30 characters a
 * prefix of a 130-character pedagogical statement is noise, and repeating it
 * above the description wasted the row's most visible line. It carries the
 * option LETTER instead, matching what the interactive-list surface shows and
 * what `selectedLetters` echoes back, so the two surfaces read the same.
 *
 * The full text goes in `description` (300 chars). On this exam that renders
 * 173 of 180 options complete; the 7 that are longer are marked with an
 * ellipsis rather than being cut mid-word, so a teacher can see that text is
 * missing instead of silently reading a half sentence.
 */
function msqOptionRow(canonical, letter) {
  return {
    // CANONICAL index, never the display position — the shuffle stops at the
    // rendering layer and storage keeps speaking the database's numbering.
    id: String(canonical),
    title: letter ? `${letter}.` : `Option ${canonical}`,
    // NO `description`. The answer text is in the screen's TextBody in full;
    // a row description is clamped to ~3 lines on the device, so an echo here
    // only ever rendered as a half sentence competing with the real copy.
  };
}

/**
 * Tidy one option's text for display.
 *
 * The legacy import left artefacts in the bank: on quiz 4 alone, 64 of 180
 * options carry leading or trailing whitespace and 9 begin with a stray "."
 * (a list marker that survived the migration). Rendered straight after our own
 * "A." prefix that reads as "A. . Pilot the project…".
 *
 * Fixed at the RENDER layer, not by rewriting the bank: it repairs every
 * question in every quiz at once, cannot desynchronise from the stored answer
 * key, and touches no exam content. Internal newlines collapse to spaces so one
 * option stays one paragraph, which is what makes the block scannable.
 */
function cleanOptionText(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.•·-]\s*/, '')
    .trim();
}

/**
 * Cut to `max` code points on a word boundary, marking the cut with an ellipsis.
 *
 * Only used where the text genuinely cannot fit a Meta field. Cutting on a space
 * and showing "…" is the difference between a teacher knowing the option
 * continues and a teacher confidently answering half a sentence.
 */
function truncateOnWord(text, max) {
  const cp = [...String(text ?? '')];
  if (cp.length <= max) return String(text ?? '');
  const slice = cp.slice(0, max - 1).join('');
  const cut = slice.lastIndexOf(' ');
  return (cut > max * 0.6 ? slice.slice(0, cut) : slice).trimEnd() + '…';
}

/**
 * The Flow screen's data for the question an attempt is currently on.
 *
 * Called by the Flow endpoint's INIT. Every key here MUST be declared in the
 * MSQ_QUESTION screen's `data` block, or Meta renders `${data.x}` as literal
 * text.
 *
 * @param {string} userId the teacher, from segment 0 of the flow token
 * @param {string} attemptId
 * @param {number|string} questionIndex
 * @returns {Promise<object|null>} screen data, or null if the question cannot
 *          be served to this teacher right now
 */
async function buildMsqFlowScreenData(userId, attemptId, questionIndex) {
  const r = await resolveMsqQuestion(attemptId, questionIndex);
  if (r.reason) {
    logToFile('⚠️ Multi-answer Flow screen not buildable', { attemptId, questionIndex, reason: r.reason });
    return null;
  }
  if (r.attempt.user_id !== userId) {
    logToFile('⚠️ Multi-answer Flow token user mismatch', { attemptId, tokenUser: userId });
    return null;
  }

  const stored = await loadPartialAnswer(r.attempt.id, r.index);
  // Letters come from the DISPLAY position, exactly as the list surface letters
  // its rows, so "Selected: B" means the same option on either surface.
  const options = r.displayOrder.map((canonical, i) =>
    msqOptionRow(canonical, OPTION_LETTERS[i]));

  // bd-43496 — the answer text lives in the screen's TextBody, NOT in the option
  // rows. A Radio/Checkbox row `description` is clamped to THREE LINES on the
  // device (~140 chars), which cut 41% of this exam's options; a TextBody is a
  // block that wraps and scrolls, which is why the question stem already renders
  // in full. The rows carry only the letter, so the letters in this body ARE the
  // key to the tap targets — they must line up, and they do: both are indexed by
  // display position.
  //
  // A Flow TextBody renders PLAIN text — no markdown, so emphasis has to be
  // structural. The stem and the option block are separated by a ruled line and
  // each option starts on its own blank-line-separated paragraph, because in a
  // wall of wrapped prose a bare "A." at the start of a line is easy to miss
  // (reported after the first TextBody build).
  //
  // Budget: stem + 4 options is a median of ~1057 and a max of ~1497 code points
  // on this exam, so this stays well inside the TextBody allowance.
  const stem = String(r.question.question_text
    || (r.multiAnswer ? 'Select all that apply.' : 'Choose one option.'));
  const optionLines = options.map((o, i) =>
    `${OPTION_LETTERS[i]}.  ${cleanOptionText(r.allOptions[r.displayOrder[i] - 1])}`);
  const questionText = [
    stem,
    '',
    '──────────',
    r.multiAnswer ? 'SELECT ALL THAT APPLY:' : 'CHOOSE ONE:',
    '',
    optionLines.join('\n\n'),
  ].join('\n');

  return {
    progress: `Question ${r.index + 1} of ${r.attempt.total_questions}`,
    question_text: questionText,
    options,
    // Pre-checks a partially-answered question so a resume does not silently
    // discard taps the teacher already made on the list surface. Anything no
    // longer on display is dropped — an init-value with no matching option is
    // how a CheckboxGroup renders empty.
    selected: [...stored].filter(s => r.displayOrder.includes(Number(s))).map(String),
    // bd-2502 — the ceiling travels with the question. This was frozen at 10 in
    // the Flow JSON, so a 5-option question told the teacher "Select 1-10".
    // Bound to what is actually rendered: the displayed set after bd-2495's cap
    // and shuffle, never the raw bank and never a constant.
    // bd-43496 — Meta enforces `max-selected-items >= 2` on a CheckboxGroup, so a
    // single-answer question CANNOT use one: binding it to 1 uploads clean and
    // then fails on the device (the screen paints, then "Something Went Wrong").
    // Those questions get the RadioButtonsGroup instead, gated on is_single, and
    // this ceiling only ever applies to the multi-answer checkbox. Floored at 2
    // so the bound value is never below Meta's minimum even for a 1-option
    // multi-answer question.
    max_selected: Math.max(2, options.length),
    // Exactly one of these is true; they gate which control the screen shows.
    is_multi: r.multiAnswer,
    is_single: !r.multiAnswer,
    // RadioButtonsGroup init-value: a single canonical id, or '' for unanswered.
    // A value not on display would render as nothing selected, so it is filtered
    // the same way `selected` is.
    selected_one: (!r.multiAnswer && stored.size > 0
      ? ([...stored].map(String).find(s => r.displayOrder.includes(Number(s))) || '')
      : ''),
    attempt_ref: `${r.attempt.id}:${r.index}`,
    training_msq_action: 'submit',
  };
}

/**
 * Which question a Flow submission is answering.
 *
 * `attempt_ref` is echoed back from the screen's own data, so it does not
 * depend on Meta returning the flow token in the completion payload; the token
 * is the fallback.
 */
function parseMsqRef(responseJson) {
  const ref = String(responseJson?.attempt_ref || '');
  let m = /^([a-f0-9-]{36}):(\d+)$/.exec(ref);
  if (m) return { attemptId: m[1], questionIndex: Number(m[2]) };

  const token = String(responseJson?.flow_token || '');
  m = new RegExp(`:${MSQ_TOKEN_TAG}:([a-f0-9-]{36}):(\\d+)$`).exec(token);
  if (m) return { attemptId: m[1], questionIndex: Number(m[2]) };
  return null;
}

/**
 * The checked option ids, as canonical integers.
 *
 * Meta sends a CheckboxGroup's value as an array, but has been observed to
 * deliver it as a JSON-encoded string in completion payloads, so both are
 * accepted. Anything that is not a plain integer is dropped here rather than
 * being allowed to reach the answer row.
 */
function parseSelectedOptionIds(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try {
      const parsed = JSON.parse(list);
      list = Array.isArray(parsed) ? parsed : String(list).split(',');
    } catch {
      list = String(list).split(',');
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map(v => Number(String(v).trim()))
    .filter(n => Number.isInteger(n) && n >= 1);
}

/**
 * Record a multi-answer question answered through the Flow.
 *
 * Deliberately the same three steps the list surface's "Done" branch takes —
 * set-equality grade, canonical comma-joined write, advance — so an attempt is
 * indistinguishable afterwards regardless of which surface delivered it.
 *
 * @param {string} userId
 * @param {object} responseJson the NFM completion payload
 * @param {string} phoneNumber
 * @returns {Promise<boolean>} true when the answer was recorded
 */
async function handleQuizFlowSubmission(userId, responseJson, phoneNumber, messageId = null) {
  const ref = parseMsqRef(responseJson);
  if (!ref) {
    logToFile('⚠️ Multi-answer Flow submission carried no attempt reference', {
      fields: Object.keys(responseJson || {}),
    });
    return false;
  }

  const r = await resolveMsqQuestion(ref.attemptId, ref.questionIndex);
  if (r.reason) {
    logToFile('⚠️ Multi-answer Flow submission refused', {
      attemptId: ref.attemptId, index: ref.questionIndex, reason: r.reason,
    });
    return false;
  }
  if (r.attempt.user_id !== userId) {
    logToFile('⚠️ Multi-answer Flow submission user mismatch', {
      attemptId: ref.attemptId, attempt_user: r.attempt.user_id, actual: userId,
    });
    return false;
  }

  // Only ids that are actually on display count. A checkbox cannot return an
  // id the screen never offered, but the payload is user-reachable input and
  // an unfiltered value would land in a column 400k+ rows are compared against.
  // bd-43496 — two possible controls sent this: `selected_options` from the
  // multi-answer CheckboxGroup, `selected_option` (singular) from the
  // single-answer RadioButtonsGroup. Only one is ever visible, but BOTH keys
  // ride along in the payload, so read whichever the question's own shape
  // implies rather than trusting the client to omit the other.
  const rawSelection = r.multiAnswer
    ? responseJson?.selected_options
    : (responseJson?.selected_option ?? responseJson?.selected_options);
  const chosen = parseSelectedOptionIds(rawSelection)
    .filter(n => r.displayOrder.includes(n))
    // A radio can only ever yield one, but a hand-crafted payload could carry
    // more; a single-answer question must never record a set.
    .slice(0, r.multiAnswer ? undefined : 1);
  if (chosen.length === 0) {
    logToFile('⚠️ Multi-answer Flow submission had no valid options — re-sending', {
      attemptId: r.attempt.id, index: r.index,
    });
    return await sendQuestion(r.attempt.id, phoneNumber);
  }

  const selected = new Set(chosen.map(String));
  const isCorrect = setsEqual(selected, parseSet(r.question.correct_option));
  await recordAnswer(r.attempt.id, r.index, r.question.id, normalizeSet(selected), isCorrect);
  await supabase.from('training_assessment_attempts').update({
    current_question_index: r.index + 1,
    last_activity_at: new Date().toISOString(),
  }).eq('id', r.attempt.id);

  // bd-43496 — per-question verdict, which this path never sent. The list
  // surface has reacted ✅/❌ and echoed the verdict in text since bd-2525;
  // answering through the Flow silently produced nothing, so a teacher had no
  // idea whether the answer landed. Same two signals, same copy, so the two
  // surfaces are indistinguishable to the teacher.
  await sendAnswerVerdict(phoneNumber, isCorrect, messageId, {
    attemptId: r.attempt.id, index: r.index,
  });

  return await sendQuestion(r.attempt.id, phoneNumber);
}

/**
 * Tell the teacher whether the answer was right: a reaction on her own message
 * plus a one-line text echo.
 *
 * Both are best-effort — a failed reaction must never cost the teacher her
 * recorded answer or stop the next question, so each is caught separately. The
 * reaction needs the inbound wamid; callers that do not have one still send the
 * text, so no path loses its verdict (the bd-2525 rule).
 */
async function sendAnswerVerdict(phoneNumber, isCorrect, messageId, ctx = {}) {
  if (messageId) {
    try {
      await WhatsAppService.sendReaction(phoneNumber, messageId, isCorrect ? '✅' : '❌');
    } catch (error) {
      logToFile('⚠️ Could not react to quiz answer', { ...ctx, error: error.message });
    }
  }
  try {
    await WhatsAppService.sendMessage(
      phoneNumber,
      isCorrect ? '✅ *Correct*' : '✗ *Not correct.*'
    );
  } catch (error) {
    logToFile('⚠️ Could not send per-question feedback', { ...ctx, error: error.message });
  }
}

/**
 * bd-60128 — claim a plain text message as the answer to an open-ended
 * question the teacher is currently on (the I-SAPS CRQ).
 *
 * Mirrors capstone-delivery.routeTextAnswer, including the lesson recorded in
 * its own comment: that read used `.maybeSingle()`, a teacher with two open
 * attempts hit a PGRST116 error, the attempt came back null, and her answer
 * was passed to ordinary chat — 11 teachers, 28 attempts, answers lost. The
 * read below is therefore a LIST ordered by activity, never a single row.
 *
 * Returns true when the message was consumed, so the text handler stops.
 *
 * @param {string} phoneNumber
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function routeOpenEndedAnswer(phoneNumber, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.startsWith('/')) return false;

  const { data: user } = await supabase
    .from('users').select('id, name').eq('phone_number', phoneNumber).maybeSingle();
  if (!user) return false;

  const { data: openAttempts } = await supabase
    .from('training_assessment_attempts')
    .select('id, user_id, level_id, grand_quiz_id, program_id, current_question_index, total_questions, total_score, status')
    .eq('user_id', user.id)
    .eq('quiz_kind', KIND_GRAND)
    .eq('status', 'in_progress')
    .order('last_activity_at', { ascending: false })
    .limit(5);
  const attempt = (openAttempts || [])[0];
  if (!attempt) return false;

  // Only claim it when the question actually IS open-ended; otherwise a
  // teacher typing chat during an MCQ would have it stored and marked.
  const { questions } = await loadServedQuestions(attempt);
  const q = questions[attempt.current_question_index];
  if (!isTextAnswerForOpenQuestion(trimmed, q)) return false;

  const CapstoneDelivery = require('./capstone-delivery.service');
  if (!CapstoneDelivery.meetsAnswerFloor(trimmed)) {
    await WhatsAppService.sendMessage(
      phoneNumber,
      `Your answer looks very short. Please write at least ${CapstoneDelivery.MIN_ANSWER_CHARS} characters so it can be marked fairly.`,
    );
    return true;
  }

  // Marked against the module's own scale — I-SAPS CRQs are 10 marks
  // (bd-60113), Beacon House answers 5.
  const perAnswer = await capstonePointsForLevel(attempt.level_id);
  const { score, feedback } = await CapstoneDelivery.scoreAnswer(q, trimmed, perAnswer);

  await supabase.from('training_assessment_answers').upsert({
    attempt_id: attempt.id,
    question_index: attempt.current_question_index,
    question_id: q.id,
    chosen_option: '',
    is_correct: null,
    answer_text: trimmed,
    answer_score: score,
    feedback_text: feedback,
  }, { onConflict: 'attempt_id,question_index' });

  await supabase.from('training_assessment_attempts').update({
    current_question_index: attempt.current_question_index + 1,
    last_activity_at: new Date().toISOString(),
  }).eq('id', attempt.id);

  await WhatsAppService.sendMessage(
    phoneNumber, `📝 Answer recorded — *${score}/${perAnswer}*.\n\n${feedback}`,
  );
  logToFile('🎓 Open-ended answer recorded', {
    attemptId: attempt.id, questionId: q.id, score, perAnswer,
  });

  const nextIndex = attempt.current_question_index + 1;
  if (nextIndex >= (attempt.total_questions || 0)) {
    return await gradeAttempt(attempt.id, phoneNumber);
  }
  return await sendQuestion(attempt.id, phoneNumber);
}

async function recordAnswer(attemptId, questionIndex, questionId, chosenOption, isCorrect) {
  await supabase
    .from('training_assessment_answers')
    .upsert(
      { attempt_id: attemptId, question_index: questionIndex, question_id: questionId, chosen_option: chosenOption, is_correct: isCorrect },
      { onConflict: 'attempt_id,question_index' }
    );
}

// bd-2390 — pass marks are per-vendor AND per-quiz-kind:
//
//   vendor        module quiz    level exam
//   TALEEMABAD    100%           80%   (grand quiz)
//   BEACONHOUSE    70%           70%   (capstone)
//   OXBRIDGE       70%           n/a   (no level exam)
//
// Both live on training_vendors (module_passing_pct / passing_pct) so a
// policy change is a DB update, not a deploy. 100 is the fallback for either
// column: the strictest bar, so a lookup failure can never hand out an easier
// pass than the vendor intended.
const DEFAULT_PASS_PCT = 100;

/**
 * Resolve a vendor's pass mark by walking module → course → level → vendor.
 *
 * @param {number} moduleId training_modules.id
 * @param {'module'|'exam'} kind which bar to read — the module-quiz bar
 *        (`module_passing_pct`) or the level-exam bar (`passing_pct`)
 * @returns {Promise<number>} passing percentage, 1-100
 */
async function getVendorPassingPct(moduleId, kind = 'module') {
  const column = kind === 'exam' ? 'passing_pct' : 'module_passing_pct';
  if (!moduleId) return DEFAULT_PASS_PCT;
  try {
    const { data: mod } = await supabase
      .from('training_modules').select('course_id').eq('id', moduleId).maybeSingle();
    if (!mod?.course_id) return DEFAULT_PASS_PCT;
    const { data: course } = await supabase
      .from('training_courses').select('level_id').eq('id', mod.course_id).maybeSingle();
    if (!course?.level_id) return DEFAULT_PASS_PCT;
    return await getVendorPassingPctByLevel(course.level_id, kind);
  } catch (err) {
    logToFile('⚠️ Could not resolve vendor pass mark — using default', {
      moduleId, column, default: DEFAULT_PASS_PCT, error: err?.message,
    });
    return DEFAULT_PASS_PCT;
  }
}

/**
 * Same lookup, but starting from a level (the grand quiz knows its level, not
 * a module).
 *
 * @param {number} levelId training_levels.id
 * @param {'module'|'exam'} kind
 * @returns {Promise<number>} passing percentage, 1-100
 */
async function getVendorPassingPctByLevel(levelId, kind = 'exam') {
  const column = kind === 'exam' ? 'passing_pct' : 'module_passing_pct';
  if (!levelId) return DEFAULT_PASS_PCT;
  try {
    const { data: level } = await supabase
      .from('training_levels').select('vendor_id').eq('id', levelId).maybeSingle();
    if (!level?.vendor_id) return DEFAULT_PASS_PCT;
    const { data: vendor } = await supabase
      .from('training_vendors').select(`key, ${column}`).eq('id', level.vendor_id).maybeSingle();
    const pct = Number(vendor?.[column]);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return DEFAULT_PASS_PCT;
    return pct;
  } catch (err) {
    logToFile('⚠️ Could not resolve vendor pass mark by level — using default', {
      levelId, column, default: DEFAULT_PASS_PCT, error: err?.message,
    });
    return DEFAULT_PASS_PCT;
  }
}

/**
 * Grade a completed attempt. Branches on quiz_kind:
 *   - grand              → pass/fail, cert or cooldown message
 *   - training_module    → pass/fail against module_passing_pct. A pass
 *                          writes the progress row and delivers the next
 *                          module; a fail holds the teacher here with an
 *                          immediate retry. No cooldown either way.
 */
async function gradeAttempt(attemptId, phoneNumber) {
  const { data: attempt } = await supabase
    .from('training_assessment_attempts')
    .select('id, user_id, quiz_kind, grand_quiz_id, training_module_id, level_id, program_id, total_questions')
    .eq('id', attemptId)
    .single();
  if (!attempt) return false;

  const { data: answers } = await supabase
    .from('training_assessment_answers')
    .select('is_correct, question_index, answer_score')
    .eq('attempt_id', attemptId);

  // bd-60128 — a folded I-SAPS paper mixes auto-marked MCQs with ONE
  // rubric-marked CRQ, so counting is_correct would score every CRQ zero. When
  // an answer row carries a rubric mark, the mixed scorer runs instead: MCQs
  // are worth 1 each, the CRQ its vendor's capstone_points_per_question.
  const hasRubricMark = (answers || []).some(
    a => a.answer_score !== null && a.answer_score !== undefined,
  );
  let score = (answers || []).filter(a => a.is_correct === true).length;
  let mixedPossible = null;
  if (hasRubricMark) {
    const crqMax = await capstonePointsForLevel(attempt.level_id);
    const mcqCount = Math.max(0, (Number(attempt.total_questions) || 0) - 1);
    const mixed = scoreMixedPaper({ answers: answers || [], mcqCount, crqMaxPoints: crqMax });
    score = mixed.earned;
    mixedPossible = mixed.possible;
    logToFile('🎓 Mixed paper scored (MCQs + rubric-marked CRQ)', {
      attemptId, mcqCount, crqMax, earned: mixed.earned, possible: mixed.possible,
    });
  }

  if (attempt.quiz_kind === KIND_TRAINING_MODULE) {
    // bd-2390 — the module quiz is now a GATE, so it has a real pass/fail.
    //
    // Previously this wrote status:'passed' unconditionally ("attempt
    // closed"), which made a failed check indistinguishable from a passed
    // one for every downstream reader. The bar is per-vendor and comes from
    // training_vendors.module_passing_pct — NIETE 100 (their quick checks
    // are meant to be answered correctly), Beacon House / Oxbridge 70.
    // Note this is a DIFFERENT column from the level-exam bar below.
    //
    // No cooldown: a teacher who misses the bar retries immediately.
    const passingPct = await getVendorPassingPct(attempt.training_module_id, 'module');
    const total = attempt.total_questions || 0;
    const pct = total > 0 ? (score / total) * 100 : 0;
    const isPassed = total > 0 && pct >= passingPct;

    await supabase.from('training_assessment_attempts').update({
      status: isPassed ? 'passed' : 'failed',
      score,
      is_passed: isPassed,
      completed_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      cooldown_until: null,
    }).eq('id', attemptId);

    if (!isPassed) {
      // Hold the teacher here: no progress row, no next module. Offer an
      // immediate re-attempt of the same module quiz.
      logEvent('training_quiz_failed', {
        user_uuid: attempt.user_id,
        attempt_uuid: attemptId,
        module_row_id: attempt.training_module_id,
        raw_score: score,
        total_qs: total,
        pct_required: passingPct,
      });
      const pctRounded = Math.round(pct);
      await WhatsAppService.sendMessage(
        phoneNumber,
        `📝 *Module check — not quite.*\n\n` +
        `You got *${score}/${total}* (${pctRounded}%). You need ${passingPct}% to move on.\n\n` +
        `Give it another go — you can retry right away.`
      );
      await WhatsAppService.sendInteractiveButtons(phoneNumber, {
        body: 'Ready to try the module check again?',
        buttons: [
          { id: `training_quiz_retry_${attempt.training_module_id}`, title: '🔄 Try again' },
          { id: 'training_pause', title: '⏸ Pause' },
        ],
      });
      return true;
    }

    // Semantic event — keys deliberately snake_case_less to avoid tripping
    // the column-completeness parser (which scans `logEvent(...)` object
    // literals near a `.from()` chain and flags anything that isn't a real
    // column). Data payload built as a variable then passed in one arg.
    const completedEventPayload = {
      user_uuid: attempt.user_id,
      attempt_uuid: attemptId,
      module_row_id: attempt.training_module_id,
      raw_score: score,
      total_qs: attempt.total_questions,
      is_perfect: score === total,
    };
    logEvent('training_quiz_completed', completedEventPayload);

    // Passed — NOW the module counts as complete. This is the only runtime
    // path (besides a module with no quiz) that writes a progress row.
    // markModuleComplete comes from progress.service (not content-delivery) to
    // keep this file off the content-delivery ↔ quiz-delivery cycle.
    const { markModuleComplete } = require('./progress.service');
    const { onModuleCompleted } = require('./content-delivery.service');
    await markModuleComplete(attempt.user_id, attempt.training_module_id);

    const pctRounded = Math.round(pct);
    const line = score === total
      ? `Nice — *${score}/${total}* correct. Perfect score! ✨`
      : `You got *${score}/${total}* (${pctRounded}%) — that clears the ${passingPct}% bar.`;
    // bd-2446 — say the module is unlocked, since that is what the teacher was
    // promised when they tapped "📝 Take quiz".
    await WhatsAppService.sendMessage(
      phoneNumber,
      `📝 *Module check — passed.*\n\n${line}\n\nLoading the next module…`
    );

    // bd-2234 — Oxbridge-style levels certify on quiz scores (all modules
    // complete, best score >= 70% each). Cheap early-outs inside; capstone
    // levels (BH) and chain vendors are excluded there.
    const { maybeIssueQuizScoreCertificate } = require('./certificate.service');
    const certRes = await maybeIssueQuizScoreCertificate(supabase, {
      userId: attempt.user_id,
      moduleId: attempt.training_module_id,
      attemptId: attempt.id,
      programId: attempt.program_id,
    });
    if (certRes.issued) {
      await WhatsAppService.sendMessage(
        phoneNumber,
        `🏆 *Congratulations, ${certRes.teacher_name}!*\n\n` +
        `You completed every ${certRes.level_name} training with 70%+ on each quiz.\n\n` +
        `Certificate code: \`${certRes.certificate_code}\`\nYou can also download it from your portal.`
      );
      await deliverCertificatePdf(phoneNumber, certRes);
    }

    // bd-2390 — the next module is released here, not on the button tap.
    // bd-2472/2473 — via the SHARED post-completion step, not a course-scoped
    // deliverNextModule. Two things were wrong with going direct: the capstone
    // offer only existed on the other completion branch (so Beacon House was
    // never offered an exam, ever), and course-scoped advancement re-sent
    // module 1 of a finished course instead of moving on.
    await onModuleCompleted(attempt.user_id, attempt.training_module_id, phoneNumber);
    return true;
  }

  // Grand quiz (the level exam) — bar comes from training_vendors.passing_pct.
  //
  // bd-2390: this was hardcoded to 100% (`score === total_questions`), which
  // is not the marking policy and not what the legacy platform did. NIETE
  // level exams pass at 80%; Beacon House certifies via the capstone path at
  // 70%. Holding teachers to a perfect score meant failing people who had
  // genuinely passed — across 30,996 historical attempts the source data
  // matches ">= 80 TALEEMABAD / >= 70 otherwise" for all but 4 rows.
  const examPassingPct = await getVendorPassingPctByLevel(attempt.level_id, 'exam');
  // bd-60128 — a mixed paper's denominator is MARKS, not questions: 8 MCQs
  // plus a 10-mark CRQ is out of 18, not out of 9.
  const examTotal = mixedPossible !== null ? mixedPossible : (attempt.total_questions || 0);
  const examPct = examTotal > 0 ? (score / examTotal) * 100 : 0;
  const isPassed = examTotal > 0 && examPct >= examPassingPct;
  const update = {
    status: isPassed ? 'passed' : 'failed',
    score,
    is_passed: isPassed,
    completed_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    cooldown_until: isPassed ? null : new Date(Date.now() + COOLDOWN_HOURS * 3_600_000).toISOString(),
  };
  await supabase.from('training_assessment_attempts').update(update).eq('id', attemptId);

  // bd-60126 — is this a LEVEL exam or an I-SAPS MODULE exam?
  //
  // Both store quiz_kind='grand' (the CHECK constraint admits no third kind),
  // so quiz_kind alone cannot tell them apart — which is how passing Module 1
  // announced a Level 1 pass and issued a level certificate. The quiz's
  // source_quiz_id is the separating signal (bd-60119).
  const { data: attemptQuiz } = attempt.grand_quiz_id
    ? await supabase.from('training_grand_quizzes')
      .select('id, source_quiz_id').eq('id', attempt.grand_quiz_id).maybeSingle()
    : { data: null };
  const certifiesLevel = isLevelCertifyingAttempt(attemptQuiz);

  if (isPassed && !certifiesLevel) {
    // A module exam. Record the pass, report the MODULE score, and hand over to
    // the module's CRQ — no level claim, no certificate. The level certificate
    // is the composite across all nine modules (bd-60113).
    const { data: course } = await supabase
      .from('training_courses').select('id, title').eq('level_id', attempt.level_id)
      .order('order_index').limit(1).maybeSingle();
    let crqQuizId = null;
    let moduleTitle = null;
    if (attemptQuiz?.source_quiz_id) {
      const { data: crq } = await supabase
        .from('training_grand_quizzes').select('id')
        .eq('level_id', attempt.level_id)
        .eq('source_quiz_id', attemptQuiz.source_quiz_id)
        .eq('quiz_type', 'capstone').eq('is_active', true).maybeSingle();
      crqQuizId = crq?.id || null;
      const modNo = attemptQuiz.source_quiz_id - 900;
      const { data: c } = await supabase
        .from('training_courses').select('title')
        .eq('level_id', attempt.level_id).ilike('title', `Module ${modNo}%`).maybeSingle();
      moduleTitle = c?.title || course?.title || null;
    }
    await WhatsAppService.sendMessage(phoneNumber, moduleExamPassMessage({
      moduleTitle, score, total: attempt.total_questions, hasCrq: Boolean(crqQuizId),
    }));
    logToFile('🎓 Module exam passed — no level certificate', {
      userId: attempt.user_id, attemptId, sourceQuizId: attemptQuiz?.source_quiz_id,
      hasCrq: Boolean(crqQuizId),
    });
    // The CRQ hand-off is NOT wired yet, and this comment is the honest state.
    // capstone-delivery resolves a capstone by LEVEL with .maybeSingle(), which
    // throws now that I-SAPS carries nine of them on one level (bd-60119).
    // Auto-delivering the CRQ therefore needs that service made
    // module-aware first; until then the teacher is told it is outstanding
    // rather than being handed a broken flow or silently skipped.
    return true;
  }

  if (isPassed) {
    // Certificate row via the shared issuance service (PDF rendering is
    // separate) — same path the teacher portal's level-exam submit uses.
    const cert = await issueCertificate(supabase, {
      userId: attempt.user_id,
      programId: attempt.program_id,
      levelId: attempt.level_id,
      attemptId: attempt.id,
    });
    await WhatsAppService.sendMessage(
      phoneNumber,
      `🏆 *Congratulations, ${cert.teacher_name}!*\n\n` +
      `You passed the ${cert.level_name} grand quiz with *${score}/${attempt.total_questions}* (${Math.round(examPct)}%).\n\n` +
      `Certificate code: \`${cert.certificate_code}\`\n\nSend /training to continue to the next level.`
    );
    await deliverCertificatePdf(phoneNumber, cert);
  } else {
    await WhatsAppService.sendMessage(
      phoneNumber,
      `❌ *Not this time.*\n\nYou scored *${score}/${attempt.total_questions}* (${Math.round(examPct)}%). This exam requires ${examPassingPct}%.\n\n` +
      `Try again in *${COOLDOWN_HOURS} hours*. Use that time to review the modules you struggled with.\n\n` +
      `Send /training when you're ready.`
    );
  }
  return true;
}

/**
 * bd-2483 — the module-quiz PASS decision, on its own.
 *
 * gradeAttempt owns grading AND WhatsApp delivery in one 176-line function, so
 * the portal cannot reuse it without sending messages. But the only part the
 * portal was getting wrong is the verdict: it used
 * `is_passed = (score === total)` and wrote `status: 'passed'` unconditionally,
 * where the bot applies training_vendors.module_passing_pct (NIETE 100, Beacon
 * House / Oxbridge 70) and records a real failure. That mismatch is the root of
 * bd-2450 — the portal marking modules complete off failed quizzes, which the
 * bot then reads as passed because it treats any progress row as a pass.
 *
 * Extracting the verdict is enough to make both surfaces agree, and is far
 * smaller than splitting delivery out of gradeAttempt. Kept byte-identical to
 * gradeAttempt's own computation, including the `total > 0` guard, so there is
 * one rule and not two that merely look alike.
 *
 * @returns {Promise<{is_passed: boolean, status: string, pass_pct: number, achieved_pct: number}>}
 */
async function decideModuleQuizPass(moduleId, score, totalQuestions) {
  const passingPct = await getVendorPassingPct(moduleId, 'module');
  const total = Number(totalQuestions) || 0;
  const pct = total > 0 ? (Number(score) / total) * 100 : 0;
  const isPassed = total > 0 && pct >= passingPct;
  return {
    is_passed: isPassed,
    status: isPassed ? 'passed' : 'failed',
    pass_pct: passingPct,
    achieved_pct: Math.round(pct),
  };
}

/**
 * bd-2673 — the LEVEL-EXAM pass decision, the sibling of the above.
 *
 * The portal was doing this arithmetic itself: reading training_vendors
 * .passing_pct inline and comparing `(score / total) * 100 >= bar`, with a
 * hardcoded fallback of 100. bd-2393 had already fixed that same line once (it
 * used to require 100% and failed teachers who had passed on WhatsApp), which
 * is the tell that a second copy invites the same bug twice.
 *
 * Same shape and same guards as decideModuleQuizPass, differing only in which
 * vendor column supplies the bar — `passing_pct` here (NIETE 80, Beacon House
 * 70) rather than `module_passing_pct`.
 *
 * @returns {Promise<{is_passed: boolean, status: string, pass_pct: number, achieved_pct: number}>}
 */
async function decideExamPass(levelId, score, totalQuestions) {
  const passingPct = await getVendorPassingPctByLevel(levelId, 'exam');
  const total = Number(totalQuestions) || 0;
  const pct = total > 0 ? (Number(score) / total) * 100 : 0;
  const isPassed = total > 0 && pct >= passingPct;
  return {
    is_passed: isPassed,
    status: isPassed ? 'passed' : 'failed',
    pass_pct: passingPct,
    achieved_pct: Math.round(pct),
  };
}

module.exports = {
  startGrandQuiz,
  startModuleExam,
  routeOpenEndedAnswer,
  startTrainingQuiz,
  sendQuestion,
  handleQuizButton,
  gradeAttempt,
  decideModuleQuizPass,
  decideExamPass,
  getVendorPassingPctByLevel,
  // Multi-answer Flow surface
  buildMsqFlowScreenData,
  handleQuizFlowSubmission,
};
