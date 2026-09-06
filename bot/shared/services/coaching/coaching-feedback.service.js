/**
 * Coaching Feedback Service — post-session "Was this useful?" micro-survey.
 *
 * WHY THIS EXISTS. Roughly 2,800 coaching reports have been delivered and we hold zero
 * satisfaction ratings and zero written feedback. Every scoring change we make is judged on
 * internal arithmetic; nothing tells us whether the teacher found the thing useful. This is the
 * cheapest instrument that answers that, and it is deliberately two taps and one optional line.
 *
 * SHAPE. Mirrors the lesson-plan survey on purpose — same 2-button prompt, same
 * ask-a-reason-only-on-👎 rule, same Redis window that intercepts the teacher's next text
 * message. A teacher who has used one recognises the other.
 *
 * THREE THINGS ARE SPECIFIC TO COACHING:
 *   1. It fires only once the session has SETTLED — report AND voice debrief both delivered.
 *      Asking mid-delivery would rate a half-finished thing.
 *   2. It writes onto the `coaching_quality_metrics` row that already exists for the session
 *      (`user_satisfaction_rating`, `user_feedback`), so the answer is traceable straight back
 *      to the coaching session and its transcript, scores and report. No new table.
 *   3. A session with no metrics row still gets asked, and the answer is still stored — the row
 *      is created on demand rather than the feedback being dropped.
 *
 * RATING CONVENTION. `user_satisfaction_rating` is an INTEGER column. This survey is a binary
 * thumb, not a Likert scale: 1 = 👍, 0 = 👎. It is written down here because the column name
 * invites the wrong assumption, and any later analysis must not average these as if they were
 * points out of five.
 */

const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { clampLanguage, resolveUx } = require('../../config/ux-strings');

// Fire once the report and the voice debrief have both landed, with a short pause so the
// survey is not competing with the audio for her attention.
const FEEDBACK_DELAY_MS = 90 * 1000;
const REASON_WINDOW_SECS = 600; // 10 minutes to answer "what could we do better?"
const REDIS_REASON_KEY = (userId) => `coaching_feedback_pending:${userId}`;

// coaching_fb_yes_<uuid> / coaching_fb_no_<uuid>
const BUTTON_RX = /^coaching_fb_(yes|no)_([0-9a-fA-F-]{36})$/;

const RATING_UP = 1;
const RATING_DOWN = 0;

// Every teacher-facing string in this file comes from the ONE catalog. No inline per-language
// map, no ternary, and no English floor of its own — those are how the two-language set diverges
// between surfaces, and the cap audit measures the catalog, not scattered literals.
const ux = (key, language) => resolveUx(key, { language });

/**
 * The teacher's own language, preferred over anything the caller guessed.
 * Never throws: a survey is not worth failing a session over.
 */
async function _resolveLanguage(userId, contextLanguage) {
  // No English floor here: clampLanguage owns the fallback, and a second floor in a caller is
  // how a surface quietly stops honouring a teacher's stored preference.
  let lang = contextLanguage;
  try {
    const { data } = await supabase
      .from('users')
      .select('preferred_language')
      .eq('id', userId)
      .maybeSingle();
    if (data && data.preferred_language) lang = data.preferred_language;
  } catch (_) { /* fall through to the caller's language, then English */ }
  // One clamp for the whole bot — never an inline en/ur ternary. A second clamp is how the
  // two-language set silently diverges between surfaces.
  return clampLanguage(lang);
}

/**
 * Write onto the session's existing metrics row; create one if the session never got a row
 * (a failed metrics insert must not cost us the teacher's answer).
 */
async function _writeMetrics(coachingSessionId, patch) {
  try {
    const { data: existing } = await supabase
      .from('coaching_quality_metrics')
      .select('id')
      .eq('coaching_session_id', coachingSessionId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('coaching_quality_metrics')
        .update(patch)
        .eq('coaching_session_id', coachingSessionId);
    } else {
      await supabase
        .from('coaching_quality_metrics')
        .insert({
          coaching_session_id: coachingSessionId,
          created_at: new Date().toISOString(),
          ...patch,
        });
    }
    return true;
  } catch (err) {
    logToFile('Coaching Feedback: metrics write failed', {
      coachingSessionId, patch, error: err.message,
    });
    return false;
  }
}

// ─── 1. Scheduler ─────────────────────────────────────────────────────────

/**
 * Schedule the survey to go out `delayMs` after the session settles.
 * Non-blocking, and never throws into the coaching pipeline.
 *
 * @param {object}  opts
 * @param {string}  opts.coachingSessionId
 * @param {string}  opts.userId
 * @param {string}  opts.phone
 * @param {string} [opts.language]
 * @param {number} [opts.delayMs]
 */
function scheduleFeedbackPrompt(opts) {
  const { coachingSessionId, userId, phone, language, delayMs = FEEDBACK_DELAY_MS } = opts || {};

  if (!coachingSessionId || !userId || !phone) {
    logToFile('Coaching Feedback: schedule skipped, missing field', {
      coachingSessionId, userId, phone,
    });
    return;
  }

  logToFile('Coaching Feedback: scheduled', { coachingSessionId, userId, delayMs });

  setTimeout(() => {
    sendFeedbackPrompt({ coachingSessionId, userId, phone, language }).catch((err) => {
      logToFile('Coaching Feedback: sendFeedbackPrompt threw', {
        coachingSessionId, error: err.message,
      });
    });
  }, delayMs);
}

// ─── 2. Send the prompt ───────────────────────────────────────────────────

async function sendFeedbackPrompt({ coachingSessionId, userId, phone, language }) {
  const lang = await _resolveLanguage(userId, language);
  const sent = await WhatsAppService.sendInteractiveButtons(phone, {
    body: ux('coachingSurveyAsk', lang),
    buttons: [
      { id: `coaching_fb_yes_${coachingSessionId}`, title: ux('coachingSurveyYesButton', lang) },
      { id: `coaching_fb_no_${coachingSessionId}`, title: ux('coachingSurveyNoButton', lang) },
    ],
  });
  logToFile("Coaching Feedback: prompt sent", { coachingSessionId, userId, lang, sent });
  return sent;
}

// ─── 3. Button router entry ───────────────────────────────────────────────

/**
 * Handle a `coaching_fb_(yes|no)_<uuid>` tap.
 * @returns {Promise<boolean>} true if this handler owned the button.
 */
async function handleFeedbackButton(buttonId, phone) {
  const match = BUTTON_RX.exec(buttonId || '');
  if (!match) return false;

  const useful = match[1] === 'yes';
  const coachingSessionId = match[2];

  let userId = null;
  try {
    const { data: session } = await supabase
      .from('coaching_sessions')
      .select('id, user_id')
      .eq('id', coachingSessionId)
      .maybeSingle();
    if (session) userId = session.user_id;
  } catch (_) { /* fall through — we can still store the thumb */ }

  const language = await _resolveLanguage(userId, null);

  await _writeMetrics(coachingSessionId, {
    user_satisfaction_rating: useful ? RATING_UP : RATING_DOWN,
  });

  logToFile('Coaching Feedback: button tapped', { coachingSessionId, userId, useful });

  // Transcript quiz: the survey is answered, so the quiz offer no longer has
  // to wait out its window — bring it forward. Idempotent with the delayed
  // job (one claim per session); best-effort, never blocks the survey.
  try {
    const TranscriptQuizOffer = require('../quiz/transcript-quiz-offer.service');
    await TranscriptQuizOffer.triggerEarly(coachingSessionId);
  } catch (tqErr) {
    logToFile('Coaching Feedback: transcript quiz early trigger failed (non-fatal)', {
      coachingSessionId, error: tqErr.message,
    });
  }

  if (useful) {
    await WhatsAppService.sendMessage(phone, ux('coachingSurveyThanks', language));
    return true;
  }

  // 👎 — open a short window so her next plain text is read as the answer to
  // "what could we do better?" rather than routed to the bot's normal intent handling.
  if (userId) {
    await redisService.set(
      REDIS_REASON_KEY(userId),
      { coachingSessionId, promptedAt: Date.now() },
      REASON_WINDOW_SECS,
    );
  }
  await WhatsAppService.sendMessage(phone, ux('coachingSurveyAskReason', language));
  return true;
}

// ─── 4. The written reason ────────────────────────────────────────────────

/**
 * Called from the text-message handler BEFORE normal routing. If this teacher has an open
 * reason window, her message is the answer — store it and consume the message.
 *
 * @returns {Promise<boolean>} true if the message was consumed as feedback.
 */
async function handlePendingReason(userId, phone, text) {
  if (!userId || !text || !text.trim()) return false;

  let pending = null;
  try {
    pending = await redisService.get(REDIS_REASON_KEY(userId));
  } catch (_) { return false; }
  if (!pending || !pending.coachingSessionId) return false;

  await _writeMetrics(pending.coachingSessionId, { user_feedback: text.trim() });

  try { await redisService.del(REDIS_REASON_KEY(userId)); } catch (_) { /* best effort */ }

  const language = await _resolveLanguage(userId, null);
  await WhatsAppService.sendMessage(phone, ux('coachingSurveyReasonThanks', language));
  logToFile('Coaching Feedback: reason recorded', {
    coachingSessionId: pending.coachingSessionId, userId, length: text.trim().length,
  });
  return true;
}

module.exports = {
  scheduleFeedbackPrompt,
  sendFeedbackPrompt,
  handleFeedbackButton,
  handlePendingReason,
  FEEDBACK_DELAY_MS,
  REASON_WINDOW_SECS,
  REDIS_REASON_KEY,
};
