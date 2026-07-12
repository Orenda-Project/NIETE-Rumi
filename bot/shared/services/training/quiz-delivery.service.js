/**
 * Teacher Training — Grand Quiz Delivery Service
 *
 * Inline Q-by-Q state machine for the level grand quiz.
 *
 * State lives entirely in DB:
 *   - training_assessment_attempts (id, user_id, grand_quiz_id, level_id,
 *     program_id, current_question_index, total_questions, total_score,
 *     status, cooldown_until, is_passed, score)
 *   - training_assessment_answers  (attempt_id, question_index, question_id,
 *     chosen_option, is_correct)
 *
 * Flow:
 *   startGrandQuiz(userId, levelOrder)
 *     → creates attempt (status='in_progress', index=0)
 *     → sends Q1 as an interactive list message
 *   handleQuizButton(userId, listReplyId)
 *     → parses attemptId + chosenOption
 *     → records answer, increments attempt.current_question_index
 *     → sends next Q, or grades and finalizes when done
 *
 * Passing bar: 100% correct (per grill session with the operator).
 * Fail → 24h cooldown before another attempt is allowed.
 */
const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const MAX_OPTIONS = 10;         // WhatsApp interactive list row cap
const OPTION_DESC_MAX = 72;     // WhatsApp row description length cap
const COOLDOWN_HOURS = 24;

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
 * Fetch the current question for an attempt and send it to the teacher.
 * If the attempt has advanced past the last question, grades it.
 */
async function sendQuestion(attemptId, phoneNumber) {
  const { data: attempt } = await supabase
    .from('training_assessment_attempts')
    .select('id, grand_quiz_id, current_question_index, total_questions, status')
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

  // Load the question at this index (order_index is 1-based per DB inspection)
  const { data: questions } = await supabase
    .from('training_questions')
    .select('id, question_text, options, correct_option, order_index')
    .eq('grand_quiz_id', attempt.grand_quiz_id)
    .eq('is_active', true)
    .order('order_index', { ascending: true })
    .range(attempt.current_question_index, attempt.current_question_index);
  const q = questions?.[0];
  if (!q) {
    logToFile('⚠️ No question at index', { attemptId, index: attempt.current_question_index });
    return await gradeAttempt(attemptId, phoneNumber);
  }

  // WhatsApp interactive list — one row per option (A, B, C, ...).
  const options = Array.isArray(q.options) ? q.options.slice(0, MAX_OPTIONS) : [];
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

  const rows = options.map((text, i) => ({
    id: `training_quiz_${attempt.id}_${i + 1}`,   // chosen_option is 1-indexed to match DB
    title: OPTION_LETTERS[i],
    description: (text || '').toString().slice(0, OPTION_DESC_MAX),
  }));

  await WhatsAppService.sendInteractiveMessage(phoneNumber, {
    header: { type: 'text', text: `Q${attempt.current_question_index + 1}/${attempt.total_questions}` },
    body: { text: q.question_text || '(missing question text)' },
    footer: { text: '100% required to pass · tap an option' },
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
  const m = /^training_quiz_([a-f0-9-]{36})_(\d+)$/.exec(replyId || '');
  if (!m) {
    logToFile('⚠️ Unrecognized training quiz reply id', { replyId });
    return false;
  }
  const attemptId = m[1];
  const chosen = m[2]; // "1", "2", "3", ...

  const { data: attempt } = await supabase
    .from('training_assessment_attempts')
    .select('id, user_id, grand_quiz_id, current_question_index, total_questions, status')
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

  // Load the current question to check correctness
  const { data: questions } = await supabase
    .from('training_questions')
    .select('id, correct_option')
    .eq('grand_quiz_id', attempt.grand_quiz_id)
    .eq('is_active', true)
    .order('order_index', { ascending: true })
    .range(attempt.current_question_index, attempt.current_question_index);
  const q = questions?.[0];
  if (!q) {
    logToFile('⚠️ Question missing when recording answer', { attemptId, idx: attempt.current_question_index });
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
 * Grade a completed attempt: count correct answers, decide pass/fail,
 * write cooldown or certificate, tell the teacher the result.
 */
async function gradeAttempt(attemptId, phoneNumber) {
  const { data: attempt } = await supabase
    .from('training_assessment_attempts')
    .select('id, user_id, grand_quiz_id, level_id, program_id, total_questions')
    .eq('id', attemptId)
    .single();
  if (!attempt) return false;

  const { data: answers } = await supabase
    .from('training_assessment_answers')
    .select('is_correct')
    .eq('attempt_id', attemptId);
  const score = (answers || []).filter(a => a.is_correct === true).length;
  const isPassed = score === attempt.total_questions; // 100% required

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
    // Create a lightweight certificate row (PDF rendering is separate)
    const { data: user } = await supabase.from('users').select('name, first_name, last_name').eq('id', attempt.user_id).maybeSingle();
    const { data: level } = await supabase.from('training_levels').select('name').eq('id', attempt.level_id).maybeSingle();
    const teacherName = user?.name || `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Teacher';
    const levelName = level?.name || 'Level';
    const code = `NIETE-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await supabase.from('training_certificates').insert({
      user_id: attempt.user_id,
      program_id: attempt.program_id,
      level_id: attempt.level_id,
      attempt_id: attempt.id,
      certificate_code: code,
      teacher_name_snapshot: teacherName,
      level_name_snapshot: levelName,
    });
    await WhatsAppService.sendMessage(
      phoneNumber,
      `🏆 *Congratulations, ${teacherName}!*\n\n` +
      `You passed the ${levelName} grand quiz with *${score}/${attempt.total_questions}* — a perfect score.\n\n` +
      `Certificate code: \`${code}\`\n\nSend /training to continue to the next level.`
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

module.exports = { startGrandQuiz, sendQuestion, handleQuizButton };
