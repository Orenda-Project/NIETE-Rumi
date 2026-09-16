/**
 * What happens when she taps — the two button handlers and the free-text reason window
 * (bd-86ivw, split out under bd-2dpco).
 *
 * This is the WRITE half of the survey. `lp612-feedback.service.js` decides when to ask and sends
 * the question; everything that lands a row on `lp_feedback` lives here, so the read of "what does
 * a tap actually record" is one file rather than a scroll through the scheduling machinery.
 *
 * EVERY teacher-facing string comes from the catalog (`resolveUx`). The two older survey services
 * carry inline `language === 'ur' ? … : …` maps; that predates the catalog and the pre-push
 * language gate, and copying it here would add more offenders to a surface the repo is actively
 * pulling in the other direction (root CLAUDE.md rule 20 — one writer, catalog copy, code-point
 * caps). `tests/lp612/used-in-class.test.js` globs every `lp612-feedback*.js` and asserts it.
 *
 * The button grammar these handlers parse is documented on `lp612-feedback.shared.js`.
 */

const supabase = require('../config/supabase');
const redisService = require('./cache/railway-redis.service');
const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../config/ux-strings');
const {
  TABLE, SEGMENTS, REASON_WINDOW_SECS, REDIS_REASON_KEY,
  BUTTON_RX, USAGE_RX, variantFor, _voiceOf, _userByPhone,
} = require('./lp612-feedback.shared');

// ─── 3. the tap ─────────────────────────────────────────────────────────────

/**
 * Handle a `lp612_fb_(yes|no)_(en|ur)_<segment_id>` reply. Called from the whatsapp-bot button
 * router.
 *
 * @returns {Promise<boolean>} true iff this handler owned the id
 */
async function handleFeedbackButton(buttonId, phone) {
  const match = BUTTON_RX.exec(buttonId || '');
  if (!match) return false;

  const useful = match[1] === 'yes';
  const docLang = clampLanguage(match[2]);
  const segmentId = match[3];

  const { data: user, error: userError } = await _userByPhone(phone);
  if (userError || !user) {
    // Owned but unattributable. She still gets an answer — a button that does nothing is worse
    // than a lost datum — and the failure is named rather than swallowed.
    logToFile('LP 6-12 feedback: phone → user lookup failed', { phone, error: userError && userError.message });
    logEvent('lp612.feedback.unattributable', { segmentId, phone, useful });
    return true;
  }
  const voice = clampLanguage(user.preferred_language);

  // Snapshot the lesson's own metadata onto the row, exactly as the K-5 lane does, so a query
  // does not have to join a corpus that may since have been re-segmented.
  const { data: segment } = await supabase
    .from(SEGMENTS)
    .select('segment_id, grade, subject, chapter_number, subtopic_title, menu_title')
    .eq('segment_id', segmentId)
    .maybeSingle();

  // Idempotent: one row per (teacher, segment). A teacher who changes her mind updates it.
  const { data: existing } = await supabase
    .from(TABLE).select('id, useful')
    .eq('user_id', user.id).eq('lp612_segment_id', segmentId)
    .maybeSingle();

  let feedbackId;
  if (existing) {
    if (existing.useful !== useful) {
      await supabase.from(TABLE).update({ useful }).eq('id', existing.id);
    }
    feedbackId = existing.id;
    logEvent('lp612.feedback.retapped', { segmentId, userId: user.id, useful, feedbackId });
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from(TABLE)
      .insert({
        user_id: user.id,
        // Deliberately absent: `lesson_plan_id`. A 6-12 lesson is not a lesson_plans row, and the
        // column is nullable precisely so a lane like this one can leave it alone.
        lp612_segment_id: segmentId,
        lp_variant: variantFor(docLang),
        useful,
        grade: segment ? segment.grade : null,
        subject: segment ? segment.subject : null,
        chapter_number: segment ? segment.chapter_number : null,
        topic: segment ? (segment.subtopic_title || segment.menu_title) : null,
        // The lane has no voicenote, so the delivered artefact is the PDF alone. Named honestly
        // rather than left NULL: the column's CHECK offers exactly these two states.
        trigger_mode: 'after_pdf_only',
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      logToFile('LP 6-12 feedback: insert failed', {
        segmentId, userId: user.id, useful,
        error: (insertError && insertError.message) || 'insert returned no row',
      });
      logEvent('lp612.feedback.insert_failed', {
        segmentId, userId: user.id, useful,
        error: (insertError && insertError.message) || 'insert returned no row',
      });
      // The orphan sentinel, as in the K-5 lane: she is still asked why, and the answer is at
      // least captured as an event rather than lost because a write failed.
      feedbackId = '__orphan__';
    } else {
      feedbackId = inserted.id;
      logEvent('lp612.feedback.recorded', {
        segmentId, userId: user.id, useful, lang: docLang, feedbackId,
        variant: variantFor(docLang),
      });
    }
  }

  // 👍 → Q2. The thank-you it replaces was the end of the survey, and it is why
  // `used_in_class` is set on a third of grades 1-5 rows and on NONE of this lane's. The prompt is
  // itself the acknowledgement; sending `lp612FeedbackThanks` as well would be two notifications
  // for one tap, and the string stays in the catalog for the K-5-style ack it still names.
  if (useful) {
    const asked = await WhatsAppService.sendInteractiveButtons(phone, {
      body: resolveUx('lp612UsedAsk', { language: voice }),
      buttons: [
        { id: `lp612_used_taught_${segmentId}`, title: resolveUx('lp612UsedTaught', { language: voice }) },
        { id: `lp612_used_planned_${segmentId}`, title: resolveUx('lp612UsedPlanned', { language: voice }) },
        { id: `lp612_used_not_yet_${segmentId}`, title: resolveUx('lp612UsedNotYet', { language: voice }) },
      ],
    });
    logEvent('lp612.usage.prompt_sent', {
      segmentId, userId: user.id, feedbackId, voice, ok: asked !== false,
    });
    return true;
  }

  // 👎 only. A thumbs-down with no reason says a lesson is bad and nothing about which part.
  try {
    await redisService.set(
      REDIS_REASON_KEY(user.id),
      { feedbackId, segmentId, polarity: 'disliked', promptedAt: Date.now() },
      REASON_WINDOW_SECS,
    );
  } catch (err) {
    logToFile('LP 6-12 feedback: could not arm the reason window', { segmentId, error: err.message });
  }
  await WhatsAppService.sendMessage(phone, resolveUx('lp612FeedbackAskReason', { language: voice }));
  return true;
}

// ─── 3b. did she teach it? ──────────────────────────────────────────────────

/**
 * Handle a `lp612_used_(taught|planned|not_yet)_<segment_id>` reply (bd-b708h).
 *
 * The UPDATE is keyed on BOTH `user_id` and `lp612_segment_id`. The K-5 handler keys on
 * `lesson_plan_id` alone, which is safe there because a lesson plan belongs to one teacher; here
 * a segment is a shared corpus row that hundreds of teachers rate, so a filter on the segment
 * alone would stamp one teacher's answer onto every row for that lesson.
 *
 * Deliberately forgiving, exactly as the K-5 handler is: a tap we cannot store still gets a
 * thank-you. She has done her part, and a button that answers with silence teaches her that
 * answering is pointless — which costs more signal than the one row we just failed to write.
 *
 * @returns {Promise<boolean>} true iff this handler owned the id
 */
async function handleUsageButton(buttonId, phone) {
  const match = USAGE_RX.exec(buttonId || '');
  if (!match) return false;

  const usedInClass = match[1];
  const segmentId = match[2];

  const { data: user, error: userError } = await _userByPhone(phone);
  if (userError || !user) {
    logToFile('LP 6-12 usage: phone → user lookup failed', { phone, error: userError && userError.message });
    logEvent('lp612.usage.unattributable', { segmentId, phone, usedInClass });
    await WhatsAppService.sendMessage(phone, resolveUx('lp612UsedThanks', { language: clampLanguage(null) }));
    return true;
  }
  const voice = clampLanguage(user.preferred_language);

  const { error } = await supabase
    .from(TABLE)
    .update({ used_in_class: usedInClass })
    .eq('user_id', user.id)
    .eq('lp612_segment_id', segmentId);

  if (error) {
    logToFile('LP 6-12 usage: UPDATE failed', { segmentId, userId: user.id, error: error.message });
    logEvent('lp612.usage.update_failed', { segmentId, userId: user.id, usedInClass, error: error.message });
  } else {
    logEvent('lp612.usage.recorded', { segmentId, userId: user.id, usedInClass });
  }

  await WhatsAppService.sendMessage(phone, resolveUx('lp612UsedThanks', { language: voice }));
  return true;
}

// ─── 4. the reason ──────────────────────────────────────────────────────────

/**
 * Consume the next inbound text as the reason if her window is open. Called from
 * text-message.handler BEFORE any routing.
 *
 * @returns {Promise<boolean>} true if consumed (the caller must return early)
 */
async function consumeReasonIfPending(userId, phone, text) {
  if (!userId || !text || !String(text).trim()) return false;

  let pending;
  try {
    pending = await redisService.get(REDIS_REASON_KEY(userId));
  } catch (err) {
    logToFile('LP 6-12 feedback: Redis read failed (reason consumer)', { error: err.message });
    return false;
  }
  if (!pending || !pending.feedbackId) return false;

  // A slash command is intent, not an answer. Left for the router, and the window left ARMED —
  // she typed `/menu` on her way to answering, not instead of it.
  if (String(text).trim().startsWith('/')) return false;

  // Cleared first: a failed UPDATE below must not trap her in a window that eats every message.
  try { await redisService.delete(REDIS_REASON_KEY(userId)); } catch (_) { /* non-fatal */ }

  // The REASON's own language, independent of her UI: she may answer an Urdu prompt in English.
  const reasonLanguage = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(text) ? 'ur' : 'en';
  const reasonText = String(text).trim().slice(0, 2000);
  const voice = await _voiceOf(userId, reasonLanguage);

  if (pending.feedbackId === '__orphan__') {
    logEvent('lp612.feedback.reason_orphaned', {
      userId, segmentId: pending.segmentId || null, reasonLanguage, reasonText,
    });
    await WhatsAppService.sendMessage(phone, resolveUx('lp612FeedbackReasonThanks', { language: voice }));
    return true;
  }

  const { error } = await supabase
    .from(TABLE)
    .update({
      reason_text: reasonText,
      reason_received_at: new Date().toISOString(),
      reason_language: reasonLanguage,
      reason_polarity: 'disliked',
    })
    .eq('id', pending.feedbackId);

  if (error) {
    logToFile('LP 6-12 feedback: reason UPDATE failed', {
      feedbackId: pending.feedbackId, error: error.message,
    });
    return false;
  }

  logEvent('lp612.feedback.reason_received', {
    userId, segmentId: pending.segmentId || null, feedbackId: pending.feedbackId,
    reasonLanguage, reasonLength: reasonText.length,
  });
  await WhatsAppService.sendMessage(phone, resolveUx('lp612FeedbackReasonThanks', { language: voice }));
  return true;
}
module.exports = {
  handleFeedbackButton,
  handleUsageButton,
  consumeReasonIfPending,
};
