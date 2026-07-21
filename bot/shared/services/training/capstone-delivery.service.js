/**
 * Beacon House open-ended capstone ("Grand Quiz") delivery — bd-2233.
 *
 * The legacy app ends each Beacon House subject with 8 open-ended questions
 * (min ~400 chars each in-app, scored /5). On WhatsApp the capstone runs as
 * a plain-text conversation:
 *
 *   1. When a teacher completes the LAST module of an all_modules level that
 *      has an active quiz_type='capstone' grand-quiz row, we offer it with a
 *      "Start Grand Quiz" button (id capstone_start_<levelId>).
 *   2. Questions are sent one at a time as text; the teacher's next text
 *      message IS the answer (slash commands and 'cancel' excepted).
 *   3. Each answer is stored verbatim (answer_text) and scored 0–5 by the
 *      LLM with a 1–2 sentence feedback line (answer_score, feedback_text),
 *      which is sent back before the next question.
 *   4. After the last answer the attempt is graded: total >= PASS_PCT of
 *      total_score → passed; a passed capstone on a fully-completed level
 *      issues the per-subject certificate (bd-2234, NIETE team's 70% rule).
 *
 * Attempt rows live in training_assessment_attempts with
 * quiz_kind='capstone' so every existing MCQ path (module quizzes, NIETE
 * grand quizzes, portal exam endpoints — all filtered on their own
 * quiz_kind/quiz_type) stays inert.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { getClient, getDefaultModel } = require('../llm-client');
const { issueCertificate } = require('./certificate.service');

const KIND_CAPSTONE = 'capstone';
const POINTS_PER_QUESTION = 5;
const PASS_PCT = 0.7; // NIETE team rule (21 Jul): 70% required for certification

const BUTTON_PREFIX = 'capstone_start_';

// ─── shared lookups ─────────────────────────────────────────────────────────

async function loadCapstoneQuiz(levelId) {
  const { data } = await supabase
    .from('training_grand_quizzes')
    .select('id, level_id, quiz_type, is_active')
    .eq('level_id', levelId)
    .eq('quiz_type', KIND_CAPSTONE)
    .eq('is_active', true)
    .maybeSingle();
  return data || null;
}

async function loadCapstoneQuestions(grandQuizId) {
  const { data } = await supabase
    .from('training_questions')
    .select('id, question_text, order_index')
    .eq('grand_quiz_id', grandQuizId)
    .eq('is_active', true)
    .order('order_index', { ascending: true });
  return data || [];
}

async function levelFullyComplete(userId, levelId) {
  const { data: courses } = await supabase
    .from('training_courses')
    .select('id')
    .eq('level_id', levelId)
    .eq('is_active', true);
  const courseIds = (courses || []).map(c => c.id);
  if (courseIds.length === 0) return false;

  const { data: modules } = await supabase
    .from('training_modules')
    .select('id')
    .eq('is_active', true)
    .in('course_id', courseIds);
  const moduleIds = (modules || []).map(m => m.id);
  if (moduleIds.length === 0) return false;

  const { data: progress } = await supabase
    .from('teacher_training_progress')
    .select('module_id')
    .eq('user_id', userId)
    .in('module_id', moduleIds);
  const done = new Set((progress || []).map(p => p.module_id));
  return moduleIds.every(id => done.has(id));
}

function questionMessage(idx, total, text) {
  return (
    `✍️ *Question ${idx + 1} of ${total}*\n\n${text}\n\n` +
    `Reply with your answer in a few sentences (English). Type *cancel* to stop and finish later.`
  );
}

// ─── 1. offer ───────────────────────────────────────────────────────────────

/**
 * Called after a module is marked done. Offers the level's capstone when the
 * teacher has just finished the last module. Never throws.
 * @returns {Promise<boolean>} whether the offer was sent
 */
async function maybeOfferCapstone(userId, moduleId, phoneNumber) {
  try {
    const { data: mod } = await supabase
      .from('training_modules').select('id, course_id').eq('id', moduleId).maybeSingle();
    if (!mod || !mod.course_id) return false;
    const { data: course } = await supabase
      .from('training_courses').select('id, level_id').eq('id', mod.course_id).maybeSingle();
    if (!course) return false;
    const { data: level } = await supabase
      .from('training_levels').select('id, name, vendor_id').eq('id', course.level_id).maybeSingle();
    if (!level) return false;
    const { data: vendor } = await supabase
      .from('training_vendors').select('id, key, unlock_logic').eq('id', level.vendor_id).maybeSingle();
    // Chain vendors (NIETE) have the MCQ grand quiz — capstones are the
    // all_modules vendors' closing assessment only.
    if ((vendor?.unlock_logic || 'chain') === 'chain') return false;

    const quiz = await loadCapstoneQuiz(level.id);
    if (!quiz) return false;

    // Already passed → nothing to offer.
    const { data: passed } = await supabase
      .from('training_assessment_attempts')
      .select('id')
      .eq('user_id', userId)
      .eq('level_id', level.id)
      .eq('quiz_kind', KIND_CAPSTONE)
      .eq('is_passed', true)
      .maybeSingle();
    if (passed) return false;

    if (!(await levelFullyComplete(userId, level.id))) return false;

    const questions = await loadCapstoneQuestions(quiz.id);
    if (questions.length === 0) return false;

    await WhatsAppService.sendInteractiveButtons(phoneNumber, {
      body:
        `🎓 You've completed every ${level.name} module!\n\n` +
        `One step left for your certificate: the *${level.name} Grand Quiz* — ` +
        `${questions.length} written questions, answered in your own words. ` +
        `You need ${Math.round(PASS_PCT * 100)}% to pass.`,
      buttons: [{ id: `${BUTTON_PREFIX}${level.id}`, title: 'Start Grand Quiz' }],
    });
    logEvent('training_capstone_offered', { user_uuid: userId, level_row_id: level.id });
    return true;
  } catch (err) {
    logToFile('❌ maybeOfferCapstone failed', { userId, moduleId, error: err.message });
    return false;
  }
}

// ─── 2. start ───────────────────────────────────────────────────────────────

async function handleCapstoneButton(userId, buttonId, phoneNumber) {
  const m = new RegExp(`^${BUTTON_PREFIX}(\\d+)$`).exec(buttonId || '');
  if (!m) return false;
  const levelId = parseInt(m[1], 10);

  const quiz = await loadCapstoneQuiz(levelId);
  if (!quiz) {
    logToFile('⚠️ Capstone start for level without capstone', { userId, levelId });
    return false;
  }
  const questions = await loadCapstoneQuestions(quiz.id);
  if (questions.length === 0) return false;

  const { data: assignment } = await supabase
    .from('teacher_training_assignments')
    .select('program_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!assignment) {
    await WhatsAppService.sendMessage(phoneNumber, 'No training assignment found — please contact NIETE support.');
    return true;
  }

  const now = new Date().toISOString();
  const { data: attempt, error } = await supabase
    .from('training_assessment_attempts')
    .insert({
      user_id: userId,
      program_id: assignment.program_id,
      quiz_kind: KIND_CAPSTONE,
      grand_quiz_id: quiz.id,
      level_id: levelId,
      current_question_index: 0,
      total_questions: questions.length,
      total_score: questions.length * POINTS_PER_QUESTION,
      status: 'in_progress',
      started_at: now,
      last_activity_at: now,
    })
    .select('id')
    .single();
  if (error || !attempt) {
    logToFile('❌ Capstone attempt insert failed', { userId, levelId, error: error?.message });
    return true;
  }

  logEvent('training_capstone_started', { user_uuid: userId, level_row_id: levelId, attempt_uuid: attempt.id });
  await WhatsAppService.sendMessage(phoneNumber, questionMessage(0, questions.length, questions[0].question_text));
  return true;
}

// ─── 3. answers ─────────────────────────────────────────────────────────────

async function scoreAnswer(question, answerText) {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: getDefaultModel(),
    temperature: 0,
    max_tokens: 200,
    messages: [
      {
        role: 'system',
        content:
          'You grade a teacher-training open-ended answer. Score 0-5 (5 = specific, ' +
          'practical, grounded in classroom practice; 0 = empty/off-topic). Reply ' +
          'ONLY with JSON: {"score": <0-5 integer>, "feedback": "<1-2 encouraging, ' +
          'specific sentences>"}',
      },
      { role: 'user', content: `Question: ${question.question_text}\n\nTeacher's answer: ${answerText}` },
    ],
  });
  let parsed = { score: 0, feedback: 'Thank you for your answer.' };
  try {
    const raw = response.choices?.[0]?.message?.content || '{}';
    parsed = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim());
  } catch (e) {
    logToFile('⚠️ Capstone LLM response unparseable — scoring 0', { error: e.message });
  }
  const score = Math.max(0, Math.min(POINTS_PER_QUESTION, Math.round(Number(parsed.score) || 0)));
  const feedback = String(parsed.feedback || 'Thank you for your answer.').slice(0, 600);
  return { score, feedback };
}

/**
 * Text-message hook. Returns true when the message was consumed as a
 * capstone answer (or cancel); false → the message flows to normal handling.
 */
async function routeTextAnswer(phoneNumber, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.startsWith('/')) return false;

  const { data: user } = await supabase
    .from('users').select('id, first_name').eq('phone_number', phoneNumber).maybeSingle();
  if (!user) return false;

  const { data: attempt } = await supabase
    .from('training_assessment_attempts')
    .select('id, user_id, level_id, grand_quiz_id, program_id, current_question_index, total_questions, total_score, status')
    .eq('user_id', user.id)
    .eq('quiz_kind', KIND_CAPSTONE)
    .eq('status', 'in_progress')
    .maybeSingle();
  if (!attempt) return false;

  if (trimmed.toLowerCase() === 'cancel') {
    await supabase.from('training_assessment_attempts')
      .update({ status: 'abandoned', last_activity_at: new Date().toISOString() })
      .eq('id', attempt.id);
    await WhatsAppService.sendMessage(
      phoneNumber,
      'No problem — your Grand Quiz is paused. Your module progress is safe; start it again any time from the level page.'
    );
    return true;
  }

  const questions = await loadCapstoneQuestions(attempt.grand_quiz_id);
  const q = questions[attempt.current_question_index];
  if (!q) {
    // Index drift (question edits mid-attempt) — grade what we have.
    return await finalizeAttempt(attempt, user, phoneNumber);
  }

  const { score, feedback } = await scoreAnswer(q, trimmed);
  await supabase.from('training_assessment_answers').upsert(
    {
      attempt_id: attempt.id,
      question_index: attempt.current_question_index,
      question_id: q.id,
      chosen_option: 'text',
      is_correct: null,
      answer_text: trimmed,
      answer_score: score,
      feedback_text: feedback,
      answered_at: new Date().toISOString(),
    },
    { onConflict: 'attempt_id,question_index' }
  );
  await WhatsAppService.sendMessage(phoneNumber, `📝 *${score}/5* — ${feedback}`);

  const nextIdx = attempt.current_question_index + 1;
  if (nextIdx >= attempt.total_questions) {
    return await finalizeAttempt({ ...attempt, current_question_index: nextIdx }, user, phoneNumber, { lastScore: score });
  }

  await supabase.from('training_assessment_attempts')
    .update({ current_question_index: nextIdx, last_activity_at: new Date().toISOString() })
    .eq('id', attempt.id);
  await WhatsAppService.sendMessage(phoneNumber, questionMessage(nextIdx, attempt.total_questions, questions[nextIdx].question_text));
  return true;
}

// ─── 4. grading ─────────────────────────────────────────────────────────────

async function finalizeAttempt(attempt, user, phoneNumber, { lastScore } = {}) {
  const { data: answers } = await supabase
    .from('training_assessment_answers')
    .select('question_index, answer_score')
    .eq('attempt_id', attempt.id);
  // The just-written last answer may not be visible through every read path
  // in the same tick; count it explicitly when the row isn't back yet.
  const byIdx = new Map((answers || []).map(a => [a.question_index, a.answer_score || 0]));
  if (lastScore !== undefined && !byIdx.has(attempt.current_question_index - 1)) {
    byIdx.set(attempt.current_question_index - 1, lastScore);
  }
  const score = [...byIdx.values()].reduce((s, v) => s + (v || 0), 0);
  const passBar = Math.ceil(attempt.total_score * PASS_PCT);
  const isPassed = score >= passBar;
  const now = new Date().toISOString();

  await supabase.from('training_assessment_attempts')
    .update({
      status: isPassed ? 'passed' : 'failed',
      score,
      is_passed: isPassed,
      completed_at: now,
      last_activity_at: now,
      current_question_index: attempt.total_questions,
    })
    .eq('id', attempt.id);

  logEvent('training_capstone_completed', {
    user_uuid: attempt.user_id,
    level_row_id: attempt.level_id,
    attempt_uuid: attempt.id,
    raw_score: score,
    total_score: attempt.total_score,
    is_passed: isPassed,
  });

  if (isPassed) {
    let certLine = '';
    if (await levelFullyComplete(attempt.user_id, attempt.level_id)) {
      const cert = await issueCertificate(supabase, {
        userId: attempt.user_id,
        programId: attempt.program_id,
        levelId: attempt.level_id,
        attemptId: attempt.id,
      });
      certLine = `\n\n🏆 Your *${cert.level_name}* certificate is earned!\nCertificate code: \`${cert.certificate_code}\`\nYou can also download it from your portal.`;
    }
    await WhatsAppService.sendMessage(
      phoneNumber,
      `🎉 *Grand Quiz passed!*\n\nYour score: *${score}/${attempt.total_score}* (needed ${passBar}).${certLine}`
    );
  } else {
    await WhatsAppService.sendMessage(
      phoneNumber,
      `You scored *${score}/${attempt.total_score}* — the pass mark is ${passBar} (${Math.round(PASS_PCT * 100)}%).\n\n` +
      `Have another look at the modules and try again when you're ready — your answers' feedback above shows exactly where to strengthen. Open the level page to retake it.`
    );
  }
  return true;
}

module.exports = {
  maybeOfferCapstone,
  handleCapstoneButton,
  routeTextAnswer,
  // exported for the certificate trigger tests
  levelFullyComplete,
  BUTTON_PREFIX,
};
