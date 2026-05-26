'use strict';
/**
 * Quiz Flow Endpoint Handler
 *
 * /quiz opens this Flow instead of going straight into QuizOrchestrator.
 * Teacher sees active quizzes with progress, can send a new quiz, or cancel
 * an active one. State teardown for cancellation handled in
 * QuizOrchestrator.cancelQuiz.
 *
 * Routing (forward-only — Meta requires it):
 *   MAIN → CONFIRM_CANCEL | NEW_QUIZ_CLASS | SUCCESS
 *   CONFIRM_CANCEL → SUCCESS
 *   NEW_QUIZ_CLASS → NEW_QUIZ_LP | NEW_QUIZ_TOPIC | SUCCESS
 *   NEW_QUIZ_LP → NEW_QUIZ_TOPIC | SUCCESS
 *   NEW_QUIZ_TOPIC → SUCCESS
 *
 * 10-second timeout consideration: quiz generation takes ~30s and CANNOT
 * happen inside data_exchange. We return SUCCESS immediately and kick off
 * generation async (setImmediate) — the teacher gets a chat message
 * "Creating a quiz..." that arrives a few seconds after the flow closes.
 */

const { logToFile } = require('../utils/logger');
const supabase = require('../config/supabase');

const ACTIVE_STATUSES = ['ready', 'sent']; // Quizzes that can be cancelled

/**
 * Flow token format: userId:listIdHint (listIdHint optional, ignored if absent)
 * Teacher's user.id is used as the flow_token; listIdHint reserved for future.
 */
async function handleQuizFlowInit(userId /*, flowToken */) {
  logToFile('📋 Quiz Flow INIT', { userId });
  return await buildMainScreen(userId);
}

async function handleQuizFlowDataExchange(userId, screen, screenData /*, flowToken */) {
  logToFile('📋 Quiz Flow data_exchange', { userId, screen, screenData });

  if (screen === 'MAIN') {
    const action = screenData._action;
    if (action === 'cancel') return await buildConfirmCancelScreen(userId);
    if (action === 'new')    return await buildNewQuizClassScreen(userId);
    if (action === 'done')   return buildSuccessScreen('All good — no changes made.', { quizAction: 'done' });
    return createErrorResponse('Unknown action');
  }

  if (screen === 'CONFIRM_CANCEL') {
    return await handleCancelSubmit(userId, screenData._quiz_id);
  }

  if (screen === 'NEW_QUIZ_CLASS') {
    return await handleClassPicked(userId, screenData._class_id);
  }

  if (screen === 'NEW_QUIZ_LP') {
    return await handleLPPicked(userId, screenData._class_id, screenData._lp_choice);
  }

  if (screen === 'NEW_QUIZ_TOPIC') {
    return await handleTopicSubmitted(userId, screenData._class_id, screenData._topic);
  }

  logToFile('⚠️ Unknown screen in quiz flow', { screen });
  return createErrorResponse('Unknown screen');
}

async function handleQuizFlowBack(userId, screen /*, flowToken */) {
  logToFile('📋 Quiz Flow BACK', { userId, screen });
  // BACK from any sub-screen → refresh MAIN
  return await buildMainScreen(userId);
}

// ─── Builders ──────────────────────────────────────────────────────────────

async function buildMainScreen(userId) {
  try {
    const { activeQuizzes, summaryBody, summaryHeading } = await loadActiveQuizSummary(userId);

    const actions = [
      { id: 'new', title: 'Send a new quiz' }
    ];
    if (activeQuizzes.length > 0) {
      actions.push({ id: 'cancel', title: 'Cancel a quiz' });
    }
    actions.push({ id: 'done', title: 'Done' });

    return {
      screen: 'MAIN',
      data: {
        summary_heading: summaryHeading,
        summary_body: summaryBody,
        actions
      }
    };
  } catch (err) {
    logToFile('❌ Error building MAIN', { error: err.message });
    return createErrorResponse('Could not load quiz menu');
  }
}

async function buildConfirmCancelScreen(userId) {
  const { activeQuizzes } = await loadActiveQuizSummary(userId);
  if (activeQuizzes.length === 0) {
    return buildSuccessScreen('No active quizzes to cancel.');
  }
  return {
    screen: 'CONFIRM_CANCEL',
    data: {
      active_quizzes: activeQuizzes.map(q => ({
        id: q.id,
        title: q.cancelTitle
      }))
    }
  };
}

async function buildNewQuizClassScreen(userId) {
  const { data: classes } = await supabase
    .from('student_lists')
    .select('id, class_name, section')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('class_name')
    .limit(20);

  if (!classes || classes.length === 0) {
    return buildSuccessScreen('You need to set up a class first. Type "add class" after this.', { quizAction: 'no_class' });
  }

  return {
    screen: 'NEW_QUIZ_CLASS',
    data: {
      classes: classes.map(c => ({
        id: c.id,
        title: c.section ? `${c.class_name} - ${c.section}` : c.class_name
      }))
    }
  };
}

async function handleClassPicked(userId, classId) {
  if (!classId) return createErrorResponse('No class selected');

  // Verify ownership
  const { data: classRow } = await supabase
    .from('student_lists')
    .select('id')
    .eq('id', classId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();
  if (!classRow) return createErrorResponse('Class not found');

  // Recent LPs in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentLPs } = await supabase
    .from('lesson_plans')
    .select('id, topic, grade, created_at')
    .eq('user_id', userId)
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(8);

  if (!recentLPs || recentLPs.length === 0) {
    // No LPs — go straight to topic prompt
    return {
      screen: 'NEW_QUIZ_TOPIC',
      data: { class_id: classId }
    };
  }

  const lpOptions = recentLPs.map(lp => ({
    id: `lp_${lp.id}`,
    title: trimmed(`${lp.topic} (${humanDate(lp.created_at)})`, 80)
  }));
  lpOptions.push({ id: 'new', title: 'New topic (not from a lesson plan)' });

  return {
    screen: 'NEW_QUIZ_LP',
    data: {
      class_id: classId,
      lp_options: lpOptions
    }
  };
}

async function handleLPPicked(userId, classId, lpChoice) {
  if (!classId || !lpChoice) return createErrorResponse('Missing class or topic source');

  if (lpChoice === 'new') {
    return {
      screen: 'NEW_QUIZ_TOPIC',
      data: { class_id: classId }
    };
  }

  // lpChoice is "lp_<uuid>" — kick off generation async, return SUCCESS
  const lpId = lpChoice.replace(/^lp_/, '');
  await kickOffQuizGenerationFromLP(userId, classId, lpId);

  return buildSuccessScreen(
    "Creating your quiz now. You'll see a confirmation in chat shortly, then your students' parents will receive the quiz invite.",
    { quizAction: 'new' }
  );
}

async function handleTopicSubmitted(userId, classId, topic) {
  if (!classId || !topic || !topic.trim()) {
    return createErrorResponse('Topic is required');
  }
  await kickOffQuizGenerationFromTopic(userId, classId, topic.trim());
  return buildSuccessScreen(
    "Creating your quiz now. You'll see a confirmation in chat shortly, then your students' parents will receive the quiz invite.",
    { quizAction: 'new', quizTopic: topic.trim() }
  );
}

async function handleCancelSubmit(userId, quizId) {
  if (!quizId) return createErrorResponse('No quiz selected');

  // Defence-in-depth: only allow cancel of OWN quizzes
  const { data: quiz } = await supabase
    .from('quizzes')
    .select('id, teacher_id, status, topic')
    .eq('id', quizId)
    .single();

  if (!quiz || quiz.teacher_id !== userId) {
    return createErrorResponse('Quiz not found');
  }
  if (!ACTIVE_STATUSES.includes(quiz.status)) {
    return buildSuccessScreen(
      `That quiz is already "${quiz.status}". Nothing to cancel.`,
      { quizAction: 'cancel_noop', quizTopic: quiz.topic }
    );
  }

  try {
    const QuizOrchestrator = require('../services/quiz/quiz-orchestrator.service');
    await QuizOrchestrator.cancelQuiz(quizId);
    return buildSuccessScreen(
      `Quiz on "${quiz.topic}" cancelled. Parents who hadn't started yet will be told it was cancelled.`,
      { quizAction: 'cancel', quizTopic: quiz.topic }
    );
  } catch (err) {
    logToFile('❌ Error cancelling quiz', { quizId, error: err.message });
    return createErrorResponse('Could not cancel the quiz. Please try again.');
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * `quizAction` is surfaced via the flow's extension_message_response.params
 * so the chat-side handler in whatsapp-bot.js knows what the teacher just
 * did — and can respond contextually instead of with a generic "Thanks for
 * your response!" fallback. Detector keys off quiz_action to route to the
 * Quiz Manager branch.
 */
function buildSuccessScreen(message, { quizAction = 'done', quizTopic = null } = {}) {
  return {
    screen: 'SUCCESS',
    data: {
      success_message: message,
      extension_message_response: {
        params: {
          quiz_action: quizAction,
          ...(quizTopic ? { quiz_topic: quizTopic } : {})
        }
      }
    }
  };
}

function createErrorResponse(message) {
  return { data: { error: { message } } };
}

function trimmed(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function humanDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffH = (now - d) / 3600000;
  if (diffH < 24) return 'Today';
  if (diffH < 48) return 'Yesterday';
  return d.toLocaleDateString('en-PK', { month: 'short', day: 'numeric' });
}

/**
 * Pull active quizzes for this teacher, formatted with progress strings.
 */
async function loadActiveQuizSummary(userId) {
  // only quizzes still in flight
  const { data: quizzes } = await supabase
    .from('quizzes')
    .select('id, topic, status, list_id, total_students_sent, created_at')
    .eq('teacher_id', userId)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(10);

  const list = quizzes || [];

  if (list.length === 0) {
    return {
      activeQuizzes: [],
      summaryHeading: 'No active quizzes right now.',
      summaryBody: 'Tap "Send a new quiz" to create one.'
    };
  }

  // Pull session progress per quiz in one query
  const ids = list.map(q => q.id);
  const { data: sessions } = await supabase
    .from('quiz_sessions')
    .select('quiz_id, status')
    .in('quiz_id', ids);

  // quiz_sessions.status values: invited | active | completed | incomplete |
  // expired | cancelled. 'active' = in-flight (started, not yet done).
  const progressByQuiz = {};
  for (const s of (sessions || [])) {
    const p = progressByQuiz[s.quiz_id] || { completed: 0, in_progress: 0, invited: 0 };
    if (s.status === 'completed' || s.status === 'incomplete') p.completed += 1;
    else if (s.status === 'active') p.in_progress += 1;
    else if (s.status === 'invited') p.invited += 1;
    progressByQuiz[s.quiz_id] = p;
  }

  // Pull class display per list_id
  const listIds = [...new Set(list.map(q => q.list_id).filter(Boolean))];
  const { data: classes } = await supabase
    .from('student_lists')
    .select('id, class_name, section')
    .in('id', listIds);
  const classDisplayById = {};
  for (const c of (classes || [])) {
    classDisplayById[c.id] = c.section ? `${c.class_name}-${c.section}` : c.class_name;
  }

  const enriched = list.map(q => {
    const cls = classDisplayById[q.list_id] || 'Class';
    const p = progressByQuiz[q.id] || { completed: 0, in_progress: 0, invited: 0 };
    // Always derive Sent from the live session count, not the historical
    // total_students_sent column. The column drifts when delivery skips
    // happen (queue-skip, session-error fallthrough) without a matching
    // decrement, and a stale value misleads teachers — the column can run
    // ahead of the actual session inserts.
    const sent = p.completed + p.in_progress + p.invited;
    return {
      id: q.id,
      cancelTitle: trimmed(`${q.topic} · ${cls} · Sent ${sent}`, 80),
      summaryLine: `• ${q.topic} (${cls}) — Sent ${sent} · Done ${p.completed} · Pending ${p.invited}`
    };
  });

  return {
    activeQuizzes: enriched,
    summaryHeading: `You have ${list.length} active quiz${list.length === 1 ? '' : 'es'}.`,
    summaryBody: enriched.map(q => q.summaryLine).join('\n')
  };
}

/**
 * Kick off generation+delivery in the background. We can't await this
 * because the data_exchange has a 10s timeout. setImmediate decouples it.
 */
async function kickOffQuizGenerationFromLP(userId, classId, lpId) {
  setImmediate(async () => {
    try {
      const QuizOrchestrator = require('../services/quiz/quiz-orchestrator.service');
      // Look up user phone from DB
      const { data: user } = await supabase
        .from('users')
        .select('id, phone_number, preferred_language')
        .eq('id', userId)
        .single();
      if (!user) return;
      const from = user.phone_number.startsWith('+') ? user.phone_number : `+${user.phone_number}`;
      await QuizOrchestrator.initiateFromLessonPlan(user, from, lpId, user.preferred_language || 'en', classId);
    } catch (err) {
      logToFile('❌ Async quiz-from-LP generation failed', { userId, classId, lpId, error: err.message });
    }
  });
}

async function kickOffQuizGenerationFromTopic(userId, classId, topic) {
  setImmediate(async () => {
    try {
      const QuizOrchestrator = require('../services/quiz/quiz-orchestrator.service');
      const { data: user } = await supabase
        .from('users')
        .select('id, phone_number, preferred_language')
        .eq('id', userId)
        .single();
      if (!user) return;
      const from = user.phone_number.startsWith('+') ? user.phone_number : `+${user.phone_number}`;

      // Resolve class for grade inference
      const { data: classData } = await supabase
        .from('student_lists')
        .select('class_name, section')
        .eq('id', classId)
        .single();

      // Re-use the orchestrator's generate-and-deliver via the topic-reply path
      await QuizOrchestrator.handleTopicReply(user, from, topic, {
        language: user.preferred_language || 'en',
        classId
      });
    } catch (err) {
      logToFile('❌ Async quiz-from-topic generation failed', { userId, classId, topic, error: err.message });
    }
  });
}

module.exports = {
  handleQuizFlowInit,
  handleQuizFlowDataExchange,
  handleQuizFlowBack,
  createErrorResponse
};
