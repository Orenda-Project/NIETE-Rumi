'use strict';
/**
 * bd-n9832 — "Get Report Now" (`coaching_finish_`) on a stale-session reminder.
 *
 * The reminder the stale-session worker sends carries TWO buttons:
 * `coaching_continue_` and `coaching_finish_`. #1008 guarded the first (it
 * already lived in continue-coaching.service) and left the second inline in
 * whatsapp-bot.js, writing `status: 'generating_report'` and queueing a report
 * job without ever reading `status`. So the same stale-button attack that
 * revived an observation through the photo gate's "Yes" also revives one here,
 * and additionally spends a report generation on a session that is over.
 *
 * Extracted for the same reason as its twin: the body can be executed by a
 * test, and the status write goes through the one terminal-guarded owner.
 */

const supabase = require('./../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { refuseTapIfTerminal, updateIfNotTerminal } = require('./session-terminal');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');

/**
 * `coaching_finish_<sessionId>` — finish now and take a partial report.
 *
 * @param {{ sessionId: string, from: string, user: { id: string, preferred_language?: string }|null }} args
 * @returns {Promise<boolean>} true when the session was moved to report generation
 */
async function handleFinishCoachingTap({ sessionId, from, user }) {
  const WhatsAppService = require('../whatsapp.service');
  if (!sessionId) return false;

  const lang = clampLanguage(user && user.preferred_language);

  // A reminder sent before the cancel is still tappable.
  if (await refuseTapIfTerminal({ sessionId, from, language: lang, tap: 'Finish' })) return false;

  logToFile('📊 User clicked Finish on stale session reminder', { sessionId, from });

  const { data: session } = await supabase
    .from('coaching_sessions')
    .select('conversation_state')
    .eq('id', sessionId)
    .maybeSingle();

  if (!session) {
    await WhatsAppService.sendMessage(from, resolveUx('coachingSessionNotFound', { language: lang }));
    return false;
  }

  // Partial-ness is measured against NUM_REFLECTIVE_QUESTIONS, not a literal 3.
  // With the debrief cut to one question, a teacher who had answered it and then
  // tapped "Get Report Now" was still flagged partial, and her report was
  // captioned as missing reflections.
  const { reflectionProgress } = require('./reflection-progress');
  const progress = reflectionProgress(session.conversation_state && session.conversation_state.questions_answered);
  const questionsAnswered = progress.answered;

  // Mark as user-requested early completion. Predicated, so a cancel that lands
  // between the guard above and this write does not lose the race.
  const { applied } = await updateIfNotTerminal(sessionId, {
    status: 'generating_report',
    conversation_state: {
      ...session.conversation_state,
      current_state: 'USER_REQUESTED_EARLY_COMPLETION',
      early_completion_at: new Date().toISOString(),
      questions_at_completion: questionsAnswered,
    },
  });
  if (!applied) {
    await WhatsAppService.sendMessage(from, resolveUx('coachingSessionCancelled', { language: lang }));
    logToFile('🚫 Finish refused — the session went over mid-tap', { sessionId });
    return false;
  }

  // Queue report generation with partial flag — only ever after the write won.
  const CoachingJobQueueService = require('./coaching-job-queue.service');
  await CoachingJobQueueService.queueReport(sessionId, {
    from,
    partial: progress.isPartial,
    userRequestedEarly: true,
  });

  const progressMsg = questionsAnswered > 0
    ? `Got it! I'll generate your report based on the ${questionsAnswered} reflection${questionsAnswered > 1 ? 's' : ''} you provided. 📊`
    : `Got it! I'll generate your report based on your classroom audio analysis. 📊`;
  await WhatsAppService.sendMessage(from, progressMsg);
  return true;
}

module.exports = { handleFinishCoachingTap };
