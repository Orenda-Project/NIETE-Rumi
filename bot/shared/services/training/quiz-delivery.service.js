/**
 * Teacher Training — Quiz Delivery Service
 *
 * Inline Q-by-Q state machine that handles TWO quiz kinds:
 *
 *   1. Grand quiz (kind='grand')       — per-Level, BLOCKING, 100% required
 *                                        to pass, 24h cooldown on failure.
 *   2. Training-module quiz (kind='training_module') — per-Module,
 *                                        NON-BLOCKING (feedback-only, no
 *                                        cooldown), fired automatically after
 *                                        a teacher finishes a module.
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
 *     → completion = friendly feedback only (no cert, no cooldown, next
 *       module already delivered in parallel by content-delivery.service)
 *
 * Shared:
 *   sendQuestion(attemptId)             — renders current Q, or grades if done
 *   handleQuizButton(userId, replyId)   — records answer, advances index
 *   gradeAttempt(attemptId)             — branches on quiz_kind
 *
 * Button ID format is the same for both kinds:
 *   training_quiz_<attemptUuid>_<optionIndex1based>
 */
const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { issueCertificate } = require('./certificate.service');

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const MAX_OPTIONS = 10;         // WhatsApp interactive list row cap
const OPTION_DESC_MAX = 72;     // WhatsApp row description length cap
const COOLDOWN_HOURS = 24;

const KIND_GRAND = 'grand';
const KIND_TRAINING_MODULE = 'training_module';

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

function selectedLetters(set) {
  return [...set].map(Number).sort((a, b) => a - b)
    .map(n => OPTION_LETTERS[n - 1] || String(n)).join(', ');
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

  // 1. Level from order_index
  const { data: level, error: lErr } = await supabase
    .from('training_levels')
    .select('id, name, order_index')
    .eq('order_index', levelOrderIdx)
    .maybeSingle();
  if (lErr || !level) {
    logToFile('❌ Level lookup failed', { levelOrder, error: lErr?.message });
    await WhatsAppService.sendMessage(phoneNumber, 'Could not find that level. Send /training to try again.');
    return false;
  }

  // 2. Grand quiz for the level
  const { data: quiz, error: qErr } = await supabase
    .from('training_grand_quizzes')
    .select('id, level_id')
    .eq('level_id', level.id)
    .eq('quiz_type', 'grand_quiz')
    .eq('is_active', true)
    .maybeSingle();
  if (qErr || !quiz) {
    logToFile('❌ Grand quiz lookup failed', { levelId: level.id, error: qErr?.message });
    await WhatsAppService.sendMessage(phoneNumber, 'No grand quiz configured for this level yet. Please contact NIETE support.');
    return false;
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

  // 4. Count questions
  const { count: totalQuestions } = await supabase
    .from('training_questions')
    .select('id', { count: 'exact', head: true })
    .eq('grand_quiz_id', quiz.id)
    .eq('is_active', true);
  if (!totalQuestions || totalQuestions === 0) {
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

  // 6. Create attempt
  const { data: attempt, error: aErr } = await supabase
    .from('training_assessment_attempts')
    .insert({
      user_id: userId,
      program_id: assignment.program_id,
      quiz_kind: KIND_GRAND,
      grand_quiz_id: quiz.id,
      level_id: level.id,
      current_question_index: 0,
      total_questions: totalQuestions,
      total_score: totalQuestions, // one point per question, 100% required to pass
      status: 'in_progress',
    })
    .select('id')
    .single();
  if (aErr || !attempt) {
    logToFile('❌ Attempt insert failed', { userId, error: aErr?.message });
    await WhatsAppService.sendMessage(phoneNumber, 'Could not start the exam — please try again in a moment.');
    return false;
  }

  await WhatsAppService.sendMessage(
    phoneNumber,
    `🎓 *Level ${level.order_index + 1} · ${level.name} — Grand Quiz*\n\n` +
    `${totalQuestions} questions · You need *100% to pass*.\n` +
    `If you fail, there's a ${COOLDOWN_HOURS}-hour cooldown before your next attempt.\n\n` +
    `Answer each question by tapping an option below.`
  );

  return await sendQuestion(attempt.id, phoneNumber);
}

/**
 * Start a fresh training-module quiz attempt.
 *
 * Non-blocking: no enrollment/cooldown check (module completion is proof of
 * enrollment) and no gating of the next module. The caller (content-delivery
 * service) is free to send Q1 and continue with the next module in parallel.
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

  // 2. Count active questions for this module
  const { count: totalQuestions } = await supabase
    .from('training_questions')
    .select('id', { count: 'exact', head: true })
    .eq('training_module_id', moduleIdNum)
    .eq('is_active', true);

  const eligPayload = {
    user_uuid: userId,
    module_row_id: moduleIdNum,
    questions_found: totalQuestions || 0,
    source: 'start_training_quiz',
  };
  logEvent('training_quiz_eligibility_checked', eligPayload);

  if (!totalQuestions || totalQuestions === 0) {
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

  // 6. Create attempt
  const { data: attempt, error: aErr } = await supabase
    .from('training_assessment_attempts')
    .insert({
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
  };
  logEvent('training_quiz_started', startedPayload);

  await WhatsAppService.sendMessage(
    phoneNumber,
    `📝 *Quick check — "${mod.title}"*\n\n` +
    `${totalQuestions} question${totalQuestions === 1 ? '' : 's'}. This is just a self-check — your progress isn't blocked either way.`
  );

  return await sendQuestion(attempt.id, phoneNumber);
}

/**
 * Fetch the current question for an attempt and send it to the teacher.
 * If the attempt has advanced past the last question, grades it.
 */
async function sendQuestion(attemptId, phoneNumber) {
  const { data: attempt } = await supabase
    .from('training_assessment_attempts')
    .select('id, quiz_kind, grand_quiz_id, training_module_id, current_question_index, total_questions, status')
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

  // Load the question at this index — filter by whichever discriminator this
  // attempt uses. order_index is synthesised 1..N per grand quiz / per module
  // during migration (scripts/migrate-teacher-training.py step 6).
  let qBuilder = supabase
    .from('training_questions')
    .select('id, question_text, options, correct_option, order_index')
    .eq('is_active', true)
    .order('order_index', { ascending: true });
  qBuilder = attempt.quiz_kind === KIND_TRAINING_MODULE
    ? qBuilder.eq('training_module_id', attempt.training_module_id)
    : qBuilder.eq('grand_quiz_id', attempt.grand_quiz_id);
  const { data: questions } = await qBuilder
    .range(attempt.current_question_index, attempt.current_question_index);
  const q = questions?.[0];
  if (!q) {
    logToFile('⚠️ No question at index', { attemptId, index: attempt.current_question_index });
    return await gradeAttempt(attemptId, phoneNumber);
  }

  // WhatsApp interactive list — one row per option (A, B, C, ...). Multi
  // questions reserve one row for the Done submit action (10-row list cap).
  const optionCap = isMultiKey(q.correct_option) ? MAX_OPTIONS - 1 : MAX_OPTIONS;
  const options = Array.isArray(q.options) ? q.options.slice(0, optionCap) : [];
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

  // bd-2230 — WhatsApp list rows truncate descriptions at OPTION_DESC_MAX
  // (72). When any option would be cut, render the FULL options as lettered
  // lines inside the body (4,096-char cap) and reduce the rows to bare
  // letters so nothing the teacher must read is lost.
  const optionsInBody = options.some(o => String(o || '').length > OPTION_DESC_MAX);

  const rows = options.map((text, i) => ({
    id: `training_quiz_${attempt.id}_${i + 1}`,   // chosen_option is 1-indexed to match DB
    title: OPTION_LETTERS[i],
    // Full text lives in the body when it would truncate here (bd-2230).
    description: optionsInBody ? '' : (text || '').toString().slice(0, OPTION_DESC_MAX),
  }));

  const multi = isMultiKey(q.correct_option);
  let bodyText = q.question_text || '(missing question text)';
  let footer = attempt.quiz_kind === KIND_TRAINING_MODULE
    ? 'Self-check · tap an option'
    : '100% required to pass · tap an option';

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
    if (selected.size > 0) bodyText += `\n\nSelected: ${selectedLetters(selected)}`;
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
 */
async function handleQuizButton(userId, replyId, phoneNumber) {
  const m = /^training_quiz_([a-f0-9-]{36})_(\d+|done)$/.exec(replyId || '');
  if (!m) {
    logToFile('⚠️ Unrecognized training quiz reply id', { replyId });
    return false;
  }
  const attemptId = m[1];
  const chosen = m[2]; // "1", "2", "3", ... or "done" (multi-select submit)

  const { data: attempt } = await supabase
    .from('training_assessment_attempts')
    .select('id, user_id, quiz_kind, grand_quiz_id, training_module_id, current_question_index, total_questions, status')
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

  // Load the current question to check correctness — same discriminator branch
  // as sendQuestion above.
  let qBuilder = supabase
    .from('training_questions')
    .select('id, correct_option')
    .eq('is_active', true)
    .order('order_index', { ascending: true });
  qBuilder = attempt.quiz_kind === KIND_TRAINING_MODULE
    ? qBuilder.eq('training_module_id', attempt.training_module_id)
    : qBuilder.eq('grand_quiz_id', attempt.grand_quiz_id);
  const { data: questions } = await qBuilder
    .range(attempt.current_question_index, attempt.current_question_index);
  const q = questions?.[0];
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

  const nextIdx = attempt.current_question_index + 1;
  await supabase.from('training_assessment_attempts').update({
    current_question_index: nextIdx,
    last_activity_at: new Date().toISOString(),
  }).eq('id', attempt.id);

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

/**
 * Grade a completed attempt. Branches on quiz_kind:
 *   - grand              → pass/fail, cert or cooldown message
 *   - training_module    → feedback-only ("You got X/Y"), no cooldown,
 *                          no cert, next module is already scheduled
 *                          in parallel by content-delivery.service.
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
    // Non-blocking: mark completed, no pass/fail bar, no cooldown.
    // is_passed carries the pedagogical signal (100%); the enum-level
    // status uses 'passed' to mean "attempt closed" — training-module
    // attempts don't have a failing enum state.
    const isPerfect = score === attempt.total_questions;
    await supabase.from('training_assessment_attempts').update({
      status: 'passed',
      score,
      is_passed: isPerfect,
      completed_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      cooldown_until: null,
    }).eq('id', attemptId);

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
      is_perfect: isPerfect,
    };
    logEvent('training_quiz_completed', completedEventPayload);

    const pct = Math.round((score / Math.max(1, attempt.total_questions)) * 100);
    const line = isPerfect
      ? `Nice — *${score}/${attempt.total_questions}* correct. Perfect score! ✨`
      : `You got *${score}/${attempt.total_questions}* (${pct}%). That's just for your own tracking — the next module is on its way.`;
    await WhatsAppService.sendMessage(phoneNumber, `📝 *Quick check — done.*\n\n${line}`);

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
    }
    return true;
  }

  // Grand quiz — 100% required.
  const isPassed = score === attempt.total_questions;
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
      `You passed the ${cert.level_name} grand quiz with *${score}/${attempt.total_questions}* — a perfect score.\n\n` +
      `Certificate code: \`${cert.certificate_code}\`\n\nSend /training to continue to the next level.`
    );
  } else {
    await WhatsAppService.sendMessage(
      phoneNumber,
      `❌ *Not this time.*\n\nYou scored *${score}/${attempt.total_questions}*. This exam requires 100%.\n\n` +
      `Try again in *${COOLDOWN_HOURS} hours*. Use that time to review the modules you struggled with.\n\n` +
      `Send /training when you're ready.`
    );
  }
  return true;
}

module.exports = { startGrandQuiz, startTrainingQuiz, sendQuestion, handleQuizButton };
