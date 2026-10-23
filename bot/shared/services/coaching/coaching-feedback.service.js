'use strict';
/**
 * "Was this coaching report useful to you?" — v10 coaching test, bd-v0toag.49.
 *
 * Ported from sandbox's coaching-feedback.service (bd-azzhu), where it goes to every teacher.
 * Here it goes ONLY to groups A and B (today's WhatsApp report) while ab_v10_enabled is on;
 * C and D get the same question on the report page, so the four groups compare. Switch off,
 * school not drawn, or a read error → nothing is sent: today's coaching, unchanged.
 *
 * Shape: two buttons right after the voice debrief; 👎 asks "what could we do better?" and the
 * teacher's next text within 10 minutes is the answer.
 *
 * Storage: coaching_quality_metrics, the session's existing row (created if missing).
 * user_satisfaction_rating is a binary thumb in an INTEGER column: 1 = 👍, 0 = 👎. Never average
 * it as points out of five. Every ask and answer is also logged with the school's group
 * (coaching.useful.asked / coaching.useful.answered) for the tracker.
 */

const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { clampLanguage, resolveUx } = require('../../config/ux-strings');
const { groupFor } = require('./ab-v10-arms');

const REASON_WINDOW_SECS = 600;
const REDIS_REASON_KEY = (userId) => `coaching_feedback_pending:${userId}`;
const BUTTON_RX = /^coaching_fb_(yes|no)_([0-9a-fA-F-]{36})$/;
const RATING_UP = 1;
const RATING_DOWN = 0;
const THANKS_REACTION = '🙏';

const ux = (key, language) => resolveUx(key, { language });

/** The teacher's stored language, else the caller's, clamped. Never throws. */
async function _resolveLanguage(userId, contextLanguage) {
  let lang = contextLanguage;
  try {
    if (userId) {
      const { data } = await supabase.from('users').select('preferred_language').eq('id', userId).maybeSingle();
      if (data && data.preferred_language) lang = data.preferred_language;
    }
  } catch (_) { /* the caller's language, then the default */ }
  return clampLanguage(lang);
}

/** A free 🙏 on her own message; the text only when there is no wamid or the reaction fails. */
async function _thank(phone, messageId, key, language) {
  try {
    if (messageId && (await WhatsAppService.sendReaction(phone, messageId, THANKS_REACTION)) === true) return;
  } catch (_) { /* fall back to the text */ }
  const lang = typeof language === 'function' ? await language() : language;
  await WhatsAppService.sendMessage(phone, ux(key, lang));
}

/** Write onto the session's metrics row; create it if the session has none yet. */
async function _writeMetrics(coachingSessionId, patch) {
  try {
    // limit(1), not maybeSingle(): on a session with two rows maybeSingle errors with no data, which used to
    // insert a third (bd-v0toag.80). Supabase returns failures as { error }, so each one is checked.
    const { data: existing, error: readError } = await supabase.from('coaching_quality_metrics')
      .select('id').eq('coaching_session_id', coachingSessionId).limit(1);
    if (readError) throw new Error(readError.message);
    const { error } = existing && existing.length
      ? await supabase.from('coaching_quality_metrics').update(patch).eq('coaching_session_id', coachingSessionId)
      : await supabase.from('coaching_quality_metrics')
        .insert({ coaching_session_id: coachingSessionId, created_at: new Date().toISOString(), ...patch });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    logToFile('Coaching Feedback: metrics write failed', { coachingSessionId, error: err.message });
    return false;
  }
}

async function sendFeedbackPrompt({ coachingSessionId, userId, phone, language }) {
  const lang = await _resolveLanguage(userId, language);
  return WhatsAppService.sendInteractiveButtons(phone, {
    body: ux('coachingSurveyAsk', lang),
    buttons: [
      { id: `coaching_fb_yes_${coachingSessionId}`, title: ux('coachingSurveyYesButton', lang) },
      { id: `coaching_fb_no_${coachingSessionId}`, title: ux('coachingSurveyNoButton', lang) },
    ],
  });
}

/**
 * Ask only a teacher in group A or B of the v10 test. Returns true when the question went out.
 * Never throws into the report pipeline.
 */
async function askIfInTest({ coachingSessionId, userId, phone, language }) {
  try {
    if (!coachingSessionId || !userId || !phone) return false;
    const g = await groupFor(userId);
    if (!g || g.report !== 'today') return false;
    await sendFeedbackPrompt({ coachingSessionId, userId, phone, language });
    logEvent('coaching.useful.asked', { coachingSessionId, userId, group: g.group });
    return true;
  } catch (err) {
    logToFile('Coaching Feedback: ask failed (the report is unaffected)', { coachingSessionId, error: err.message });
    return false;
  }
}

/** A coaching_fb_(yes|no)_<uuid> tap. Returns true when it was ours. */
async function handleFeedbackButton(buttonId, phone, opts = {}) {
  const match = BUTTON_RX.exec(buttonId || '');
  if (!match) return false;
  const useful = match[1] === 'yes';
  const coachingSessionId = match[2];

  let userId = null;
  try {
    const { data: session } = await supabase.from('coaching_sessions')
      .select('id, user_id').eq('id', coachingSessionId).maybeSingle();
    if (session) userId = session.user_id;
  } catch (_) { /* the thumb is still stored */ }

  await _writeMetrics(coachingSessionId, { user_satisfaction_rating: useful ? RATING_UP : RATING_DOWN });
  let group = null;
  try { const g = userId ? await groupFor(userId) : null; group = g ? g.group : null; } catch (_) { /* logged as null */ }
  logEvent('coaching.useful.answered', { coachingSessionId, userId, useful, group });

  // The survey is answered, so the transcript quiz offer need not wait out its window.
  try {
    await require('../quiz/transcript-quiz-offer.service').triggerEarly(coachingSessionId);
  } catch (err) {
    logToFile('Coaching Feedback: transcript quiz early trigger failed (non-fatal)', { coachingSessionId, error: err.message });
  }

  const language = await _resolveLanguage(userId, null);
  if (useful) {
    await _thank(phone, opts.messageId, 'coachingSurveyThanks', language);
    return true;
  }
  if (userId) {
    try {
      await redisService.set(REDIS_REASON_KEY(userId), { coachingSessionId, promptedAt: Date.now() }, REASON_WINDOW_SECS);
    } catch (err) {
      logToFile('Coaching Feedback: reason window not opened', { coachingSessionId, error: err.message });
    }
  }
  await WhatsAppService.sendMessage(phone, ux('coachingSurveyAskReason', language));
  return true;
}

/** Her text inside the 👎 window is the reason. Returns true when the message was consumed. */
async function handlePendingReason(userId, phone, text, opts = {}) {
  if (!userId || !text || !text.trim()) return false;
  let pending = null;
  try { pending = await redisService.get(REDIS_REASON_KEY(userId)); } catch (_) { return false; }
  if (!pending || !pending.coachingSessionId) return false;

  await _writeMetrics(pending.coachingSessionId, { user_feedback: text.trim() });
  try { await redisService.delete(REDIS_REASON_KEY(userId)); } catch (_) { /* best effort */ }
  await _thank(phone, opts.messageId, 'coachingSurveyReasonThanks', () => _resolveLanguage(userId, null));
  logToFile('Coaching Feedback: reason recorded', { coachingSessionId: pending.coachingSessionId, userId });
  return true;
}

module.exports = {
  askIfInTest, sendFeedbackPrompt, handleFeedbackButton, handlePendingReason,
  REASON_WINDOW_SECS, REDIS_REASON_KEY,
};
