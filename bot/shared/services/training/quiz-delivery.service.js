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
function isMultiKey(correctOption) {
  return String(correctOption || '').includes(',');
}

function parseSet(str) {
  return new Set(String(str || '').split(',').map(s => s.trim()).filter(Boolean));
}

function normalizeSet(set) {
  return [...set].map(Number).sort((a, b) => a - b).join(',');
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
  let qBuilder = supabase
    .from('training_questions')
    .select('id, order_index, bloom_level')
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
  const served = selectServedQuestions(all, { attemptId: attempt.id, isModuleQuiz, config });

  const snapshot = Number(attempt.total_questions);
  if (Number.isFinite(snapshot) && snapshot > 0 && served.length !== snapshot && all.length === snapshot) {
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
  const { data: quiz, error: qErr } = await supabase
    .from('training_grand_quizzes')
    .select('id, level_id, quiz_type')
    .eq('level_id', level.id)
    .in('quiz_type', ['grand_quiz', 'capstone'])
    .eq('is_active', true)
    .maybeSingle();
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
    logToFile('⚠️ Invalid moduleId for startTrainingQuiz', { userId, moduleId });
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
    logToFile('❌ Module lookup failed', { moduleId: moduleIdNum, error: mErr?.message });
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
    // No questions for this module — caller decides what to do next.
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
    logToFile('⚠️ Cannot start module quiz — no active program assignment', { userId, moduleId: moduleIdNum });
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
    logToFile('❌ Training-quiz attempt insert failed', { userId, moduleId: moduleIdNum, error: aErr?.message });
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
    .select('id, question_text, options, correct_option, order_index')
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
  if (isMultiKey(q.correct_option) && msqFlowId()) {
    await WhatsAppService.sendFlow(phoneNumber, {
      flowId: msqFlowId(),
      header: `Q${attempt.current_question_index + 1}/${attempt.total_questions}`,
      body: (q.question_text || 'Select all that apply.').toString().slice(0, 1024),
      footer: 'Select all that apply',
      buttonText: 'Answer',
      // Leads with the teacher's own id (segment 0 is how every Flow endpoint
      // here resolves the user) and names the exact question, so a submission
      // from a Flow message re-opened after the quiz moved on is recognised as
      // stale and dropped instead of overwriting a newer answer.
      flowToken: `${attempt.user_id}:${MSQ_TOKEN_TAG}:${attempt.id}:${attempt.current_question_index}`,
    });
    return true;
  }
  if (isMultiKey(q.correct_option)) {
    logToFile('⚠️ TRAINING_MSQ_FLOW_ID not set — falling back to list + Done delivery', {
      attemptId: attempt.id, questionId: q.id, index: attempt.current_question_index,
    });
  }

  // bd-2230 — WhatsApp list rows truncate descriptions at OPTION_DESC_MAX
  // (72). When any option would be cut, render the FULL options as lettered
  // lines inside the body (4,096-char cap) and reduce the rows to bare
  // letters so nothing the teacher must read is lost.
  const optionsInBody = options.some(o => String(o || '').length > OPTION_DESC_MAX);

  const rows = options.map((text, i) => ({
    // The id carries the CANONICAL index, so the shuffle never escapes the
    // rendering layer — everything downstream keeps speaking the DB's own
    // 1-based option numbering.
    id: `training_quiz_${attempt.id}_${displayOrder[i]}`,
    title: OPTION_LETTERS[i],
    // Full text lives in the body when it would truncate here (bd-2230).
    description: optionsInBody ? '' : (text || '').toString().slice(0, OPTION_DESC_MAX),
  }));

  const multi = isMultiKey(q.correct_option);
  let bodyText = q.question_text || '(missing question text)';
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

  if (optionsInBody) {
    bodyText += '\n\n' + options
      .map((o, i) => `${OPTION_LETTERS[i]}. ${String(o || '')}`)
      .join('\n');
  }

  if (multi) {
    rows.push({
      id: `training_quiz_${attempt.id}_done`,
      title: '✅ Done',
      description: 'Submit your selected answers',
    });
    const selected = await loadPartialAnswer(attempt.id, attempt.current_question_index);
    if (selected.size > 0) bodyText += `\n\nSelected: ${selectedLetters(selected, displayOrder)}`;
    footer = 'Select all that apply, then tap Done';
  }

  await WhatsAppService.sendInteractiveMessage(phoneNumber, {
    header: { type: 'text', text: `Q${attempt.current_question_index + 1}/${attempt.total_questions}` },
    body: { text: bodyText.slice(0, 4096) },   // WhatsApp interactive body hard cap
    footer: { text: footer },
    action: {
      button: 'Answer',
      sections: [{ title: 'Options', rows }],
    },
  });
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
  if (messageId) {
    try {
      await WhatsAppService.sendReaction(phoneNumber, messageId, isCorrect ? '✅' : '❌');
    } catch (error) {
      logToFile('⚠️ Could not react to quiz answer', {
        attemptId: attempt.id,
        index: attempt.current_question_index,
        error: error.message,
      });
    }
  }

  try {
    await WhatsAppService.sendMessage(
      phoneNumber,
      isCorrect ? '✅ *Correct*' : '✗ *Not correct.*'
    );
  } catch (error) {
    logToFile('⚠️ Could not send per-question feedback', {
      attemptId: attempt.id,
      index: attempt.current_question_index,
      error: error.message,
    });
  }

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
  if (!isMultiKey(question.correct_option)) return { reason: 'not_multi_answer' };

  const allOptions = Array.isArray(question.options) ? question.options : [];
  const displayOrder = buildOptionDisplayOrder({
    optionCount: allOptions.length,
    correctOption: question.correct_option,
    cap: MULTI_OPTION_CAP,
    attemptId: attempt.id,
    questionId: question.id,
    shuffle: config.shuffle_options,
  });
  if (displayOrder.length === 0) return { reason: 'no_options' };

  return { attempt, question, allOptions, displayOrder, index };
}

const MSQ_OPTION_TITLE_MAX = 80;   // Meta CheckboxGroup data-source title cap

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
  const options = r.displayOrder.map((canonical) => {
    const text = String(r.allOptions[canonical - 1] ?? '');
    const option = {
      // CANONICAL index, never the display position — the shuffle stops at the
      // rendering layer and storage keeps speaking the database's numbering.
      id: String(canonical),
      title: text.slice(0, MSQ_OPTION_TITLE_MAX) || `Option ${canonical}`,
    };
    if (text.length > MSQ_OPTION_TITLE_MAX) option.description = text;
    return option;
  });

  return {
    progress: `Question ${r.index + 1} of ${r.attempt.total_questions}`,
    question_text: String(r.question.question_text || 'Select all that apply.'),
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
    max_selected: options.length,
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
async function handleQuizFlowSubmission(userId, responseJson, phoneNumber) {
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
  const chosen = parseSelectedOptionIds(responseJson?.selected_options)
    .filter(n => r.displayOrder.includes(n));
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

  return await sendQuestion(r.attempt.id, phoneNumber);
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
    .select('is_correct')
    .eq('attempt_id', attemptId);
  const score = (answers || []).filter(a => a.is_correct === true).length;

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
  const examTotal = attempt.total_questions || 0;
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

module.exports = {
  startGrandQuiz,
  startTrainingQuiz,
  sendQuestion,
  handleQuizButton,
  gradeAttempt,
  decideModuleQuizPass,
  getVendorPassingPctByLevel,
  // Multi-answer Flow surface
  buildMsqFlowScreenData,
  handleQuizFlowSubmission,
};
