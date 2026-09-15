/**
 * The stale-session reminder's "Continue coaching" tap.
 *
 * Lifted out of the webhook's button dispatch so it can be EXECUTED by a test.
 * The webhook branch now only dispatches — the same shape the classroom-photo
 * "add another" tap already uses, and for the same reason: the dispatch block
 * requires ~40 services at module load and cannot be booted in a unit suite, so
 * anything left inside it can only ever be checked by reading the source.
 *
 * It matters here because this tap is the ONE live path that reopens a reflective
 * conversation. Its question count was hardcoded from the three-question era
 * while the debrief has been configured at one for months, so a teacher who
 * tapped Continue after answering was asked a second question nobody configured
 * — and that second question is the only reader of the session-scoped reflection
 * language. Both halves are fixed together, or the second question keeps the
 * flipped language alive.
 *
 * The read projects the one JSONB key it consumes. The tap used to pull
 * `transcript_text` and `analysis_data` whole and then use neither — the full
 * transcript plus the full analysis blob, per tap, for a counter.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const WhatsAppService = require('../whatsapp.service');
const { NUM_REFLECTIVE_QUESTIONS } = require('../../config/coaching-debrief.config');
const { getCoachingMessage } = require('../../config/coaching-messages');
const { getUserLanguage } = require('../../utils/language-cache');
const { offerDefaultLanguage } = require('../../config/languages');

/**
 * @param {object} opts
 * @param {string} opts.sessionId  coaching_sessions id from the button payload
 * @param {string} opts.from       the teacher's WhatsApp number
 * @param {object|null} [opts.user]  her users row, for the reply language
 */
async function handleContinueCoachingTap({ sessionId, from, user = null }) {
  logToFile('🔄 User clicked Continue on stale session reminder', { sessionId, from });

  const language = user && user.id
    ? await getUserLanguage(user.id)
    : offerDefaultLanguage();

  const { data: session } = await supabase
    .from('coaching_sessions')
    .select('id, questions_answered:conversation_state->questions_answered')
    .eq('id', sessionId)
    .single();

  if (!session) {
    await WhatsAppService.sendMessage(from, getCoachingMessage('coaching_sessionNotFound', language));
    return;
  }

  const questionsAnswered = Number(session.questions_answered) || 0;
  const nextQuestionNumber = questionsAnswered + 1;

  logToFile('📊 Resuming coaching session', {
    sessionId,
    questionsAnswered,
    nextQuestionNumber,
    configuredQuestions: NUM_REFLECTIVE_QUESTIONS,
  });

  // The configured count, not a literal. The debrief config's own header calls
  // itself the single source for the loop bound; this path never read it.
  if (nextQuestionNumber > NUM_REFLECTIVE_QUESTIONS) {
    const CoachingJobQueueService = require('./coaching-job-queue.service');
    await CoachingJobQueueService.queueReport(sessionId, { from });
    await WhatsAppService.sendMessage(from, getCoachingMessage('coaching_continueAllAnswered', language));
    return;
  }

  const ReflectiveConversationService = require('./reflective-conversation.service');
  await ReflectiveConversationService.conductReflectiveConversation(
    sessionId,
    from,
    nextQuestionNumber
  );

  // Clear reminder_sent_at since user re-engaged
  await supabase
    .from('coaching_sessions')
    .update({ reminder_sent_at: null })
    .eq('id', sessionId);
}

module.exports = { handleContinueCoachingTap };
