'use strict';
// Follow-up LP system. Wires the 4 buttons emitted by the quiz
// report bundle and orchestrates the dual-revision flow:
//   1. Teacher taps a button — handleFollowUpButton stores intent + prior-
//      quiz context in Redis (awaiting_next_topic, 1h TTL) and asks for
//      the next topic.
//   2. text-message.handler.js intercepts the next text from this teacher,
//      checks for awaiting_next_topic state, and calls handleNextTopicReply
//      with the topic.
//   3. handleNextTopicReply acknowledges the intent and clears the awaiting
//      state. It USED to enqueue a freeform Gamma-rendered follow-up LP; that
//      feature was retired with bd-2540 (Option A partial Gamma strip).

const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const WhatsAppService = require('../whatsapp.service');
const QuizInsightService = require('./quiz-insight.service');
const { logToFile } = require('../../utils/logger');

const AWAITING_KEY = (userId) => `quiz:awaiting_next_topic:${userId}`;
const AWAITING_TTL = 3600;     // 1h — comfortably under the 24h ceiling

const KIND_BY_PREFIX = {
  'quiz_revise_next_': 'dual_revision_then_next',
  'quiz_revise_only_': 'revision_only',
  'quiz_extend_':       'extension_after_mastery',
  'quiz_bridge_':       'next_topic_bridge'
};

/**
 * Handle a follow-up button tap. Determines the kind, loads prior-quiz
 * context, stores it in Redis, and asks for the next topic (if needed).
 *
 * Strong-band buttons: extension_after_mastery and next_topic_bridge
 * still ask for next topic. The teacher always gets to name it — the
 * comingUp quick-list (when curriculum LP) makes that fast.
 */
async function handleFollowUpButton(buttonId, user, from) {
  if (!user?.id) {
    logToFile('⚠️ quiz follow-up button tapped without registered user', { buttonId, from });
    await WhatsAppService.sendMessage(from,
      'Please register first — type /register and we\'ll continue.');
    return;
  }

  const prefix = Object.keys(KIND_BY_PREFIX).find(p => buttonId.startsWith(p));
  if (!prefix) {
    logToFile('⚠️ Unknown follow-up button prefix', { buttonId });
    return;
  }
  const kind = KIND_BY_PREFIX[prefix];
  const quizId = buttonId.slice(prefix.length);

  logToFile('🎯 Follow-up button tapped', { kind, quizId, userId: user.id });

  // Load the cluster to capture the misconception text now (the
  // quiz_questions row already has distractor_misconceptions).
  const QuizReportService = require('./quiz-report.service');
  const topMissed = await QuizReportService._buildTopMissedQuestions(quizId).catch(() => []);
  const cluster = topMissed[0] || null;

  // Prior LP context (FK-linked, no fuzzy matching)
  const priorLP = await QuizInsightService.loadPriorLPContext(quizId);

  // Fetch the quiz topic + grade + subject + class for the prompt
  const { data: quiz } = await supabase
    .from('quizzes')
    .select(`
      id, topic, grade, subject, list_id,
      student_lists ( class_name, section )
    `)
    .eq('id', quizId)
    .single();

  if (!quiz) {
    await WhatsAppService.sendMessage(from,
      "I couldn't find that quiz anymore. Type /quiz to start a fresh one.");
    return;
  }

  const stragglerNames = await QuizInsightService.loadStragglerNames(quizId);

  const followUpContext = {
    kind,
    quizId,
    priorTopic: quiz.topic,
    priorGrade: quiz.grade || null,
    priorSubject: quiz.subject || null,
    priorLPId: priorLP?.id || null,
    priorLPActivities: priorLP?.activities || null,
    priorLPSource: priorLP?.source || null,
    misconception: cluster?.misconception_feedback || null,
    misconceptionDistractor: cluster?.top_wrong_text || null,
    misconceptionSource: cluster?.misconception_source || null,
    clusterQuestion: cluster?.question_text || null,
    stragglerNames,
    classDisplay: quiz.student_lists
      ? (quiz.student_lists.section
          ? `${quiz.student_lists.class_name}-${quiz.student_lists.section}`
          : quiz.student_lists.class_name)
      : null,
    requestedAt: Date.now()
  };

  await redisService.setexWithCeiling(
    AWAITING_KEY(user.id),
    AWAITING_TTL,
    JSON.stringify(followUpContext)
  );

  // Ask for the next topic — quick-list when curriculum LP has comingUp,
  // free-text otherwise.
  const comingUp = (priorLP?.comingUp || []).slice(0, 3);
  if (comingUp.length > 0) {
    // WhatsApp interactive list (up to 10 rows). We use up to 3 + 1 fallback row.
    await WhatsAppService.sendInteractiveButtons(from, {
      body: 'What\'s the next topic you\'re planning?',
      buttons: comingUp.map((t, i) => ({
        id: `quiz_next_topic_${i}`,
        title: t.length > 20 ? t.slice(0, 17) + '...' : t
      })).concat([{ id: 'quiz_next_topic_other', title: 'Type a different topic' }]).slice(0, 3)
    });
    // Persist the comingUp options too so we can resolve a tapped row id
    // back to the full topic string.
    await redisService.setexWithCeiling(
      `${AWAITING_KEY(user.id)}:options`,
      AWAITING_TTL,
      JSON.stringify(comingUp)
    );
  } else {
    await WhatsAppService.sendMessage(from,
      'What\'s the next topic you\'re planning? (Just type the topic name.)');
  }
}

/**
 * Get the awaiting-next-topic state for a teacher (called by the text-
 * message handler before its registration gate).
 */
async function getAwaitingState(userId) {
  if (!userId) return null;
  try {
    const raw = await redisService.redis.get(AWAITING_KEY(userId));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Resolve the next-topic reply (text or quick-list tap) and enqueue a
 * follow-up LP. Clears the awaiting state.
 */
async function handleNextTopicReply(userId, from, language, replyText) {
  const state = await getAwaitingState(userId);
  if (!state) return false;

  let nextTopic = (replyText || '').trim();

  // If the reply is a quick-list row id, resolve it back to the full topic
  if (/^quiz_next_topic_(\d+)$/.test(replyText || '')) {
    const idx = parseInt(replyText.match(/^quiz_next_topic_(\d+)$/)[1], 10);
    try {
      const optionsRaw = await redisService.redis.get(`${AWAITING_KEY(userId)}:options`);
      const options = optionsRaw ? JSON.parse(optionsRaw) : [];
      nextTopic = options[idx] || nextTopic;
    } catch (_) { /* fall through to free-text */ }
  } else if (replyText === 'quiz_next_topic_other') {
    // Teacher tapped "Type a different topic" — re-prompt for free text
    await WhatsAppService.sendMessage(from,
      'OK — type the next topic you\'re planning to teach.');
    return true;     // consumed, but don't clear state
  }

  if (!nextTopic || nextTopic.length < 2) {
    await WhatsAppService.sendMessage(from,
      'I didn\'t catch that. Type the next topic name (e.g. "Atomic Structures").');
    return true;
  }

  // Friendly chat ack while LP generates (~30s)
  const verbForBand = (state.kind === 'extension_after_mastery') ? 'an extension lesson on'
                    : (state.kind === 'next_topic_bridge')        ? 'a next-topic lesson bridging from'
                    : (state.kind === 'revision_only')            ? 'a 35-min revision lesson on'
                    :                                                'a 35-min lesson on';
  const target = (state.kind === 'next_topic_bridge')
    ? `${state.priorTopic} into ${nextTopic}`
    : (state.kind === 'extension_after_mastery')
      ? `${state.priorTopic} (extending into ${nextTopic})`
      : (state.kind === 'revision_only')
        ? `${state.priorTopic}`
        : `${nextTopic} that opens with a 5-min revision of ${state.priorTopic}`;

  // bd-2540 (Option A partial Gamma strip): the follow-up "revision LP"
  // feature enqueued a freeform Gamma render. Freeform LP generation is
  // retired; instead, we acknowledge the intent, log it (so we can measure
  // demand for a catalog-based follow-up later), and clear the awaiting state.
  await WhatsAppService.sendMessage(from,
    `Thanks for telling me about "${nextTopic}" — the ${verbForBand.replace(/^a(n)? /, '')} on ${target} isn't in the catalog yet. Send "menu" to see what is available.`);

  logToFile('quiz.follow_up.retired_freeform_lp (bd-2540)', {
    userId, from, kind: state.kind, priorTopic: state.priorTopic, nextTopic,
    priorGrade: state.priorGrade, priorSubject: state.priorSubject,
  });

  // Clear awaiting state so the next text isn't misinterpreted
  await redisService.redis.del(AWAITING_KEY(userId));
  await redisService.redis.del(`${AWAITING_KEY(userId)}:options`);

  return true;
}

module.exports = {
  handleFollowUpButton,
  getAwaitingState,
  handleNextTopicReply,
  AWAITING_KEY
};
