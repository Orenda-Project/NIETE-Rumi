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

// bd-60085 — REQUIRED LAZILY, and this is load-bearing rather than tidy.
//
// The portal imports this module for four things that need no I/O at all:
// MIN_ANSWER_CHARS, POINTS_PER_QUESTION, meetsAnswerFloor and decideCapstonePass.
// With the requires below at top level, that import also pulled in
// bot/shared/config/supabase.js -> `require('dotenv')`, which the portal service cannot
// resolve: Node searches from the REQUIRING FILE's directory, so a file under /app/bot/
// looks in /app/bot/node_modules then /app/node_modules and never /app/dashboard/node_modules
// where dotenv actually is. The portal installs only the root package.json and never
// installs bot/ at all.
//
// The identical shape took down POST /training/bands with a 500 the first time a teacher
// pressed save. The capstone endpoints are staging-only today, so this one had not been hit
// yet — it would have broken on promotion instead, which is a worse place to find it.
//
// `band-selection.service.js` already carries the same deps() pattern for the same reason.
// Lazy is not a workaround here: the pure rules below must stay importable from anywhere,
// including a test with no bot dependencies present.
function deps() {
  return {
    supabase: require('../../config/supabase'),
    WhatsAppService: require('../whatsapp.service'),
    logToFile: require('../../utils/logger').logToFile,
    logEvent: require('../../utils/structured-logger').logEvent,
    llm: require('../llm-client'),
    issueCertificate: require('./certificate.service').issueCertificate,
  };
}

const KIND_CAPSTONE = 'capstone';
// bd-60113 — the default now lives in capstone-points.rules alongside the
// per-vendor override, so the portal can read the scale without pulling this
// file's I/O in. Re-exported below, unchanged at 5, for existing importers.
const { POINTS_PER_QUESTION, pointsPerQuestionFor } = require('./capstone-points.rules');
const PASS_PCT = 0.7; // NIETE team rule (21 Jul): 70% required for certification

const BUTTON_PREFIX = 'capstone_start_';

// ─── shared lookups ─────────────────────────────────────────────────────────

async function loadCapstoneQuiz(levelId) {
  const { supabase } = deps();
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
  const { supabase } = deps();
  const { data } = await supabase
    .from('training_questions')
    .select('id, question_text, order_index')
    .eq('grand_quiz_id', grandQuizId)
    .eq('is_active', true)
    .order('order_index', { ascending: true });
  return data || [];
}

async function levelFullyComplete(userId, levelId) {
  const { supabase } = deps();
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
  const { supabase, WhatsAppService, logToFile, logEvent } = deps();
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
  const { supabase, WhatsAppService, logToFile, logEvent } = deps();
  try {
    // bd-2476 — this function had FOUR paths that returned false without a word
    // to the teacher and, in two cases, without a log line either. A tester
    // tapped "Start Grand Quiz", saw a typing indicator, and got nothing back;
    // by the time we looked, Railway had already rolled the logs (~3 minutes of
    // retention on this service) and there was no evidence left to read.
    // Every exit now logs, and anything unexpected also tells the teacher.
    logToFile('🎓 Capstone button tapped', { userId, buttonId, phoneNumber });

    const m = new RegExp(`^${BUTTON_PREFIX}(\\d+)$`).exec(buttonId || '');
    if (!m) {
      logToFile('⚠️ Capstone button id did not match the expected shape', { userId, buttonId, expected: `${BUTTON_PREFIX}<levelId>` });
      return false;
    }
    const levelId = parseInt(m[1], 10);

    const quiz = await loadCapstoneQuiz(levelId);
    if (!quiz) {
      logToFile('⚠️ Capstone start for level without capstone', { userId, levelId });
      await WhatsAppService.sendMessage(phoneNumber, 'This level has no written exam set up yet. Please contact NIETE support.');
      return true;
    }
    const questions = await loadCapstoneQuestions(quiz.id);
    logToFile('🎓 Capstone resolved', { userId, levelId, quizId: quiz.id, questions: questions.length });
    if (questions.length === 0) {
      logToFile('⚠️ Capstone has no active questions', { userId, levelId, quizId: quiz.id });
      await WhatsAppService.sendMessage(phoneNumber, 'This exam has no questions set up yet. Please contact NIETE support.');
      return true;
    }

    // bd-2454 — re-check the SAME preconditions maybeOfferCapstone checks before
    // offering. WhatsApp interactive buttons live in chat history forever, so a
    // button offered months ago (or offered legitimately and then tapped after
    // the teacher's progress changed) would otherwise start a capstone with the
    // level unfinished, or a second one on a level already passed. The offer
    // being gated is not the same as the start being gated.
    const { data: alreadyPassed } = await supabase
      .from('training_assessment_attempts')
      .select('id')
      .eq('user_id', userId)
      .eq('level_id', levelId)
      .eq('quiz_kind', KIND_CAPSTONE)
      .eq('is_passed', true)
      .maybeSingle();
    if (alreadyPassed) {
      logToFile('🎓 Capstone start refused — already passed', { userId, levelId });
      await WhatsAppService.sendMessage(
        phoneNumber,
        'You have already passed this level\'s Grand Quiz — your certificate is in your records.'
      );
      return true;
    }
    if (!(await levelFullyComplete(userId, levelId))) {
      logToFile('🎓 Capstone start refused — level incomplete', { userId, levelId });
      await WhatsAppService.sendMessage(
        phoneNumber,
        'Finish every module in this level first — the Grand Quiz unlocks once the level is complete.'
      );
      return true;
    }

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

    // bd-60113 — the per-answer scale is a vendor setting (I-SAPS CRQs are 10
    // marks, Beacon House answers 5). Resolved once here so total_score and the
    // LLM prompt agree; a failed lookup falls back to the historical 5.
    const perAnswer = await capstonePointsForLevel(levelId);

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
        total_score: questions.length * perAnswer,
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

    logToFile('🎓 Capstone attempt created — sending Q1', { userId, levelId, attemptId: attempt.id, total: questions.length });
    logEvent('training_capstone_started', { user_uuid: userId, level_row_id: levelId, attempt_uuid: attempt.id });
    await WhatsAppService.sendMessage(phoneNumber, questionMessage(0, questions.length, questions[0].question_text));
    return true;
  } catch (error) {
    // Never let this present as silence again. The teacher tapped a button;
    // they get an answer either way, and we get a stack in the logs.
    logToFile('❌ handleCapstoneButton threw', { userId, buttonId, error: error?.message, stack: String(error?.stack || '').slice(0, 500) });
    try {
      await WhatsAppService.sendMessage(phoneNumber, 'Something went wrong starting your exam. Please try again in a moment.');
    } catch (_) { /* the send itself failed — the log above is what matters */ }
    return true;
  }
}

/**
 * bd-60113 — the per-answer scale for a level's vendor.
 *
 * level -> vendor -> capstone_points_per_question, defaulting to 5. Never
 * throws: a lookup failure must degrade to the historical scale rather than
 * strand a teacher mid-exam, so every failure path returns the default.
 *
 * @param {number} levelId training_levels.id
 * @returns {Promise<number>}
 */
async function capstonePointsForLevel(levelId) {
  const { supabase, logToFile } = deps();
  try {
    const { data: level } = await supabase
      .from('training_levels').select('vendor_id').eq('id', levelId).maybeSingle();
    if (!level?.vendor_id) return POINTS_PER_QUESTION;
    const { data: vendor } = await supabase
      .from('training_vendors')
      .select('key, capstone_points_per_question')
      .eq('id', level.vendor_id)
      .maybeSingle();
    return pointsPerQuestionFor(vendor);
  } catch (err) {
    logToFile('⚠️ capstone points lookup failed — using default', {
      levelId, default: POINTS_PER_QUESTION, error: err?.message,
    });
    return POINTS_PER_QUESTION;
  }
}

// ─── 3. answers ─────────────────────────────────────────────────────────────

/**
 * @param {object} question    training_questions row
 * @param {string} answerText  the teacher's verbatim answer
 * @param {number} [maxPoints] top of the scale for this vendor — bd-60113.
 *        Defaults to POINTS_PER_QUESTION so Beacon House and Oxbridge are
 *        byte-identical to before. The scale is interpolated into the PROMPT as
 *        well as the clamp: telling the model "score 0-5" and then clamping to
 *        10 would silently cap every I-SAPS CRQ at half marks.
 */
/**
 * Render a per-question rubric into the marking prompt.
 *
 * Shape as stored on training_questions.rubric:
 *   { total_marks, criteria: [ { name, marks, bands: { "4": "...", ... } } ] }
 *
 * A band missing from `bands` is UNREACHABLE for that criterion — the partner
 * source prints "-" there. It is stated to the model explicitly, because a
 * marker that invents an Exemplary band for a criterion that has none awards
 * marks the rubric cannot give.
 *
 * @param {object} rubric
 * @returns {string|null} prompt text, or null when the rubric is unusable
 */
function renderRubric(rubric) {
  const criteria = rubric && Array.isArray(rubric.criteria) ? rubric.criteria : null;
  if (!criteria || criteria.length === 0) return null;
  const lines = [];
  for (let i = 0; i < criteria.length; i += 1) {
    const c = criteria[i] || {};
    const bands = c.bands && typeof c.bands === 'object' ? c.bands : {};
    const keys = Object.keys(bands).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
    if (keys.length === 0) return null;
    lines.push(`\nCRITERION ${i + 1}: ${c.name} (max ${c.marks} marks)`);
    for (const k of keys) lines.push(`  ${k} marks: ${bands[k]}`);
    const lowest = keys[keys.length - 1];
    if (lowest > 0) lines.push(`  (No band below ${lowest} exists for this criterion — never award less.)`);
  }
  return lines.join('\n');
}

/**
 * Grade one constructed-response answer.
 *
 * WHEN THE QUESTION CARRIES A RUBRIC, MARK AGAINST IT.
 *
 * I-SAPS writes a different rubric for every CRQ — 36 in Level 1, each with
 * its own criteria and band descriptions. Until this change the seeder stored
 * only the question, so this function graded every answer with one generic
 * "is this practical classroom writing?" instruction. Against 46 hand-graded
 * answers that sat at 0.80 mean absolute error and 0.26 run-to-run drift; the
 * same model given the real rubric reached 0.22 and 0.02. It also passed a
 * fluent, confident, off-task answer two runs out of three — fluency read as
 * quality because nothing told it what quality meant for THAT question.
 *
 * The partner's §4.3 permits AI marking only against the rubric and notes, so
 * the generic path is out of policy as well as less accurate.
 *
 * The generic prompt REMAINS the fallback, deliberately: a question with no
 * rubric (every Beacon House answer, any CRQ whose import failed) must still
 * be gradable. Degrading to the old behaviour is correct; refusing to mark is
 * not.
 *
 * @param {object} question training_questions row; `rubric` used when present
 * @param {string} answerText the teacher's answer
 * @param {number} maxPoints per-answer scale for this vendor
 * @returns {Promise<{score:number, feedback:string}>}
 */
async function scoreAnswer(question, answerText, maxPoints = POINTS_PER_QUESTION) {
  const { logToFile } = deps();
  const { getClient, getDefaultModel } = deps().llm;
  const client = getClient();
  const top = Number.isInteger(maxPoints) && maxPoints > 0 ? maxPoints : POINTS_PER_QUESTION;
  const rubricText = renderRubric(question && question.rubric);
  const rubricTotal = Number(question && question.rubric && question.rubric.total_marks);
  // The rubric's own total wins over the vendor scale: marking out of 10 and
  // then reporting it out of 5 would silently halve every CRQ.
  const cap = rubricText && Number.isFinite(rubricTotal) && rubricTotal > 0 ? rubricTotal : top;

  const system = rubricText
    ? ('You are marking one constructed-response answer from a teacher-training course, '
      + 'against the official rubric supplied below. Follow the rubric exactly.\n\n'
      + 'RULES\n'
      + '- Score EACH criterion independently by choosing the single band whose description '
      + 'best matches the answer. Award exactly the marks of that band.\n'
      + '- A band not listed for a criterion is unavailable; never award it.\n'
      + '- Judge the substance, not fluency or length. A confident, well-written answer that '
      + 'misses what the band asks for scores the lower band.\n'
      + '- Do not reward naming a term unless the answer does what the band describes.\n'
      + `Reply ONLY with JSON: {"criteria":[{"n":1,"marks":<int>}],"total":<0-${cap} integer>,`
      + '"feedback":"<1-2 encouraging, specific sentences for the teacher>"}')
    : (`You grade a teacher-training open-ended answer. Score 0-${cap} (${cap} = specific, `
      + 'practical, grounded in classroom practice; 0 = empty/off-topic). Reply '
      + `ONLY with JSON: {"score": <0-${cap} integer>, "feedback": "<1-2 encouraging, `
      + 'specific sentences>"}');

  const user = rubricText
    ? `QUESTION\n${question.question_text}\n\nRUBRIC (total ${cap} marks)\n${rubricText}\n\nTEACHER'S ANSWER\n${answerText}`
    : `Question: ${question.question_text}\n\nTeacher's answer: ${answerText}`;

  const response = await client.chat.completions.create({
    model: getDefaultModel(),
    job: 'training.capstoneScore',
    temperature: 0,
    // A rubric reply carries per-criterion marks, so it needs more room than
    // the generic one. Too small a cap truncates the JSON and scores 0.
    max_tokens: rubricText ? 700 : 200,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  let parsed = { score: 0, feedback: 'Thank you for your answer.' };
  try {
    const raw = response.choices?.[0]?.message?.content || '{}';
    parsed = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim());
  } catch (e) {
    logToFile('⚠️ Capstone LLM response unparseable — scoring 0', { error: e.message });
  }
  // The rubric path returns `total`; the generic path returns `score`.
  const raw_score = parsed.total !== undefined && parsed.total !== null ? parsed.total : parsed.score;
  const score = Math.max(0, Math.min(cap, Math.round(Number(raw_score) || 0)));
  const feedback = String(parsed.feedback || 'Thank you for your answer.').slice(0, 600);
  return { score, feedback };
}

/**
 * Text-message hook. Returns true when the message was consumed as a
 * capstone answer (or cancel); false → the message flows to normal handling.
 */
async function routeTextAnswer(phoneNumber, text) {
  const { supabase, WhatsAppService, logToFile } = deps();
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.startsWith('/')) return false;

  const { data: user } = await supabase
    .from('users').select('id, name').eq('phone_number', phoneNumber).maybeSingle();
  if (!user) return false;

  // bd-5tn5d — NOT .maybeSingle(). A teacher can legitimately hold one open
  // capstone PER SUBJECT: ux_taa_one_active_per_quiz is UNIQUE (user_id,
  // grand_quiz_id) WHERE status='in_progress', and Beacon House has four. A
  // single-row read over two rows is a PGRST116 ERROR, not a truncation — and
  // the error was never destructured, so `attempt` came back null, this
  // returned false, and the handler passed her answer on to ordinary chat.
  // She got a lesson-plan reply instead of a score and the answer was lost;
  // `cancel` below was equally unreachable. 11 teachers on production, 28
  // attempts, growing by about one teacher every two days.
  //
  // Most-recently-active wins: that is the paper she is actually sitting.
  // Whether a second capstone should be openable AT ALL is a separate
  // question the 2026-08-02 migration deliberately deferred; this only makes
  // sure that whatever is open, an answer lands and cancel works.
  const { data: openAttempts, error: attemptErr } = await supabase
    .from('training_assessment_attempts')
    .select('id, user_id, level_id, grand_quiz_id, program_id, current_question_index, total_questions, total_score, status')
    .eq('user_id', user.id)
    .eq('quiz_kind', KIND_CAPSTONE)
    .eq('status', 'in_progress')
    .order('last_activity_at', { ascending: false })
    // Total order, not just a sort key. last_activity_at is NOT NULL DEFAULT
    // now() and no two of a teacher's open attempts share a timestamp today
    // (closest spread on production: 5m39s) — but "no ties in the data right
    // now" is not a guarantee, and a tie here would make WHICH paper receives
    // her answer non-deterministic. Same defect this codebase already carries
    // in module sequencing, where 28 modules share one order_index and the
    // "next" module is whatever the plan happens to return.
    .order('id', { ascending: false })
    .limit(2);
  if (attemptErr) {
    logToFile('❌ Capstone attempt lookup failed — answer not routed', {
      userId: user.id, error: attemptErr.message,
    }, 'error');
    return false;
  }
  const attempt = openAttempts?.[0];
  if (!attempt) return false;
  if (openAttempts.length > 1) {
    // Visible on purpose: this condition grew silently for nine days because
    // nothing counted it.
    logToFile('⚠️ Teacher holds more than one open capstone — routing to the most recent', {
      userId: user.id, routedTo: attempt.id, levelId: attempt.level_id,
    }, 'warn');
  }

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

  // bd-60113 — derive the scale from the attempt rather than re-reading the
  // vendor. The attempt froze total_score = questions * perAnswer when it was
  // created, so this cannot drift from what the teacher is being marked out of
  // even if the vendor's setting changes mid-exam.
  const perAnswer = Math.round(
    (Number(attempt.total_score) || 0) / Math.max(1, Number(attempt.total_questions) || 0)
  ) || POINTS_PER_QUESTION;
  const { score, feedback } = await scoreAnswer(q, trimmed, perAnswer);
  // bd-2478 — CHECK the write. This upsert silently failed for every capstone
  // answer ever submitted: is_correct was NOT NULL and a written answer has no
  // binary correctness, so Postgres rejected all eight rows of the first real
  // attempt. Nothing checked the error, finalizeAttempt then summed an empty
  // set, and a teacher who answered well scored 2/40.
  const { error: answerErr } = await supabase.from('training_assessment_answers').upsert(
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
  if (answerErr) {
    // Do not let the teacher keep writing into a void. Their work is not being
    // recorded and the final score would be wrong; stop here and say so.
    logToFile('❌ Capstone answer failed to save — aborting the attempt', {
      attemptId: attempt.id, questionIndex: attempt.current_question_index, error: answerErr.message,
    });
    await WhatsAppService.sendMessage(
      phoneNumber,
      'Sorry — your answer could not be saved, so I have stopped the exam here rather than score it wrongly. Please contact NIETE support.'
    );
    return true;
  }
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
  const { supabase, WhatsAppService, logToFile, logEvent, issueCertificate } = deps();
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
  // bd-2478 — a short answer set means rows did not persist, and scoring it
  // anyway is how a teacher who answered eight questions well was told they
  // scored 2/40. The lastScore fallback above is for ONE row that may not be
  // readable yet in the same tick; anything more missing is a fault, not a lag.
  if (byIdx.size < attempt.total_questions) {
    logToFile('❌ Capstone finalize: answers missing — refusing to score', {
      attemptId: attempt.id, found: byIdx.size, expected: attempt.total_questions,
    });
    await supabase.from('training_assessment_attempts')
      .update({ status: 'in_progress', last_activity_at: new Date().toISOString() })
      .eq('id', attempt.id);
    await WhatsAppService.sendMessage(
      phoneNumber,
      'Sorry — some of your answers were not saved, so I cannot score this fairly. Your attempt is still open. Please contact NIETE support.'
    );
    return true;
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
    let earned = null;
    if (await levelFullyComplete(attempt.user_id, attempt.level_id)) {
      earned = await issueCertificate(supabase, {
        userId: attempt.user_id,
        programId: attempt.program_id,
        levelId: attempt.level_id,
        attemptId: attempt.id,
      });
      certLine = `\n\n🏆 Your *${earned.level_name}* certificate is earned!\nCertificate code: \`${earned.certificate_code}\`\nYou can also download it from your portal.`;
    }
    await WhatsAppService.sendMessage(
      phoneNumber,
      `🎉 *Grand Quiz passed!*\n\nYour score: *${score}/${attempt.total_score}* (needed ${passBar}).${certLine}`
    );

    // Hand over the actual file. Best effort and strictly after the message:
    // a certificate whose PDF never rendered (`pdf_r2_key` null) still reaches
    // the teacher as a code, which is how it has always worked.
    if (earned && earned.pdf_r2_key) {
      try {
        const { sendCertificateDocument } = require('./certificate-pdf.service');
        await sendCertificateDocument(phoneNumber, {
          certificate_code: earned.certificate_code,
          level_name: earned.level_name,
          pdf_r2_key: earned.pdf_r2_key,
        });
      } catch (err) {
        logToFile('❌ Capstone certificate PDF delivery failed', {
          certificateCode: earned.certificate_code, error: err.message,
        });
      }
    }
  } else {
    await WhatsAppService.sendMessage(
      phoneNumber,
      `You scored *${score}/${attempt.total_score}* — the pass mark is ${passBar} (${Math.round(PASS_PCT * 100)}%).\n\n` +
      `Have another look at the modules and try again when you're ready — your answers' feedback above shows exactly where to strengthen. Open the level page to retake it.`
    );
  }
  return true;
}

/* ------------------------------------------------------------------------- *
 * bd-2673 — the pure, surface-agnostic half of the capstone.
 *
 * The portal can now run a capstone (it is the reason assessments were
 * WhatsApp-only: a free-text paper rendered as radio buttons gave a Beacon
 * House teacher eight questions, no inputs and a dead Submit). It must reach
 * the SAME rubric and the SAME pass rule as WhatsApp, but it cannot call
 * finalizeAttempt: that function interleaves scoring with WhatsApp sends and
 * takes a phone number.
 *
 * So the rules come out here as pure functions, and finalizeAttempt keeps the
 * delivery. Same split as decideModuleQuizPass / decideExamPass.
 * ------------------------------------------------------------------------- */

/**
 * The minimum answer length, in characters.
 *
 * This module's own header has always described the capstone as "min ~400 chars
 * each in-app" — but nothing enforced it, because on WhatsApp the answer is just
 * the teacher's next text message and there is no field to validate. The portal
 * has a textarea and a Submit button, so the floor becomes real there: it is
 * stated to the teacher, counted live, and checked again server-side.
 */
const MIN_ANSWER_CHARS = 400;

/** Does this answer clear the length floor? Pure; no I/O. */
function meetsAnswerFloor(answerText) {
  return String(answerText || '').trim().length >= MIN_ANSWER_CHARS;
}

/**
 * The capstone verdict, given the per-answer scores that were persisted.
 *
 * Carries the bd-2478 refusal: if fewer answer rows came back than the attempt
 * expects, the paper is NOT scored. That bug told a teacher who answered eight
 * questions well that they had scored 2/40, because the rows had not persisted
 * and the sum ran anyway. A missing row is a fault, not a low score.
 *
 * @param {{answerScores: number[], totalQuestions: number, totalScore: number}} input
 * @returns {{ok: boolean, reason?: string, score?: number, pass_bar?: number,
 *            is_passed?: boolean, pass_pct?: number}}
 */
function decideCapstonePass({ answerScores, totalQuestions, totalScore } = {}) {
  const scores = Array.isArray(answerScores) ? answerScores : [];
  const expected = Number(totalQuestions) || 0;
  if (scores.length < expected) {
    return { ok: false, reason: 'answers_missing' };
  }
  const total = Number(totalScore) || 0;
  const score = scores.reduce((s, v) => s + (Number(v) || 0), 0);
  const passBar = Math.ceil(total * PASS_PCT);
  return {
    ok: true,
    score,
    pass_bar: passBar,
    is_passed: score >= passBar,
    pass_pct: Math.round(PASS_PCT * 100),
  };
}

module.exports = {
  maybeOfferCapstone,
  handleCapstoneButton,
  routeTextAnswer,
  // bd-2673 — the portal's capstone path. Pure: no WhatsApp, no phone number.
  scoreAnswer,
  renderRubric,
  decideCapstonePass,
  meetsAnswerFloor,
  MIN_ANSWER_CHARS,
  POINTS_PER_QUESTION,
  // bd-60137 — the module-exam path needs the same per-vendor scale.
  capstonePointsForLevel,
  // exported for the certificate trigger tests
  levelFullyComplete,
  BUTTON_PREFIX,
  // bd-2489 — the portal's capstone result card used to hardcode "70%". It is
  // the same number as this constant, which made the copy correct by
  // coincidence rather than by construction. Exported so the portal endpoint
  // can send the bar it is ACTUALLY graded against, and the two cannot drift.
  CAPSTONE_PASS_PCT: PASS_PCT,
};
