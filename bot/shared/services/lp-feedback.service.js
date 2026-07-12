/**
 * LP Feedback Service — post-delivery "Was this useful?" micro-survey.
 *
 * Ported from 02_Main Rumi Bot (2026-07-12) and trimmed to NIETE's scope:
 *   - Languages: English + Urdu only (parent bot also carries Swahili/Arabic/
 *     Sindhi/Punjabi; NIETE's first-wave audience is Pakistani teachers).
 *   - Trigger modes: `after_pdf_only` only. `after_voice_note` is reserved
 *     for when audio-LP ships (see docs/roadmap/audio-lp.md).
 *   - No `askReasonOnYes` opt-in — NIETE MVP asks for a reason only on 👎.
 *     Positive taps get a warm "thanks" and no further prompt.
 *   - No `handleComponentTap` — no voicenote-vs-LP comparison because there's
 *     no voicenote yet.
 *
 * Lifecycle (unchanged from parent):
 *   1. scheduleFeedbackPrompt(...) — called from every LP delivery path after
 *      WhatsAppService.sendDocument succeeds. Non-blocking; fires 30s later.
 *   2. sendFeedbackPrompt(...) — 2-button interactive message (👍 / 👎).
 *   3. handleFeedbackButton(...) — button router entry for
 *      `lp_feedback_yes_<uuid>` / `lp_feedback_no_<uuid>`. Inserts row.
 *   4. consumeReasonIfPending(...) — called from text-message.handler.js
 *      BEFORE any routing. If the Redis flag is set (10-min window after 👎),
 *      captures the next inbound text as reason_text.
 *
 * Design:
 *   - Detached setTimeout for the 30s delay. Lost on bot restart — acceptable
 *     at NIETE's initial scale. Upgrade to an SQS-delayed message if we see
 *     drop rate > 5%.
 *   - Redis flag with TTL 600s = 10-min reason-capture window.
 *   - Row inserted on button tap; reason_text UPDATEd on the SAME row.
 *   - Duplicate button taps (user changes their mind) update `useful` and
 *     re-arm the Redis flag.
 */

const supabase = require('../config/supabase');
const redisService = require('./cache/railway-redis.service');
const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');

// 30s post-delivery. Longer than that and the teacher may be onto the next task.
const FEEDBACK_DELAY_MS = 30 * 1000;
const REASON_WINDOW_SECS = 600;                 // 10-min reason-capture window
const REDIS_REASON_KEY = (userId) => `lp_feedback_pending:${userId}`;

// Matches lp_feedback_(yes|no)_<uuid>. UUID = 8-4-4-4-12 hex.
const BUTTON_RX = /^lp_feedback_(yes|no)_([0-9a-f-]{36})$/;

// ─── Localized strings ────────────────────────────────────────────────────
// Keep tight — 2 languages, 4 messages. If NIETE adds Sindhi/Punjabi/etc.
// later, extend by copying the parent bot's branches.

function _promptBody(language) {
  return language === 'ur'
    ? 'امید ہے یہ سبق کا منصوبہ آپ کی کلاس میں مدد کرے گا۔ کیا یہ مفید تھا؟'
    : "Hope that lesson plan helps for your class! Was it useful for planning?";
}

// WhatsApp button labels capped at 20 chars; emoji counts as ~2 chars.
function _promptButtons(language, lessonPlanId) {
  const yes = language === 'ur' ? '👍 ہاں' : '👍 Yes, useful';
  const no  = language === 'ur' ? '👎 نہیں' : '👎 Not really';
  return [
    { id: `lp_feedback_yes_${lessonPlanId}`, title: yes },
    { id: `lp_feedback_no_${lessonPlanId}`,  title: no  },
  ];
}

function _ackYes(language) {
  return language === 'ur'
    ? 'شکریہ — خوشی ہے یہ مفید تھی!'
    : 'Thanks — glad it helped!';
}

function _askReasonOnNo(language) {
  return language === 'ur'
    ? 'بتانے کا شکریہ۔ کیا چیز کام نہیں آئی؟ (ایک سطر کا جواب کافی ہے)'
    : "Thanks for letting us know. What didn't work? (one line is enough)";
}

function _finalAck(language) {
  return language === 'ur'
    ? 'سمجھ گئی، شکریہ — یہ ہمیں منصوبے بہتر بنانے میں مدد کرے گا۔'
    : 'Got it, thanks — this helps us improve the plans.';
}

/**
 * Resolve the language to use for feedback messages. Prefers the user's
 * stored `preferred_language`, falls back to the context language, then 'en'.
 * Never throws — logs on Supabase errors and falls through to the default.
 */
async function _resolveLanguage(userId, contextLanguage) {
  let lang = contextLanguage || 'en';
  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('preferred_language')
      .eq('id', userId)
      .maybeSingle();
    if (userRow?.preferred_language) lang = userRow.preferred_language;
  } catch (_) { /* fall through to context / default */ }
  // Normalize — anything not 'ur' is treated as English for our 2-language set.
  return lang === 'ur' ? 'ur' : 'en';
}

// ─── 1. Scheduler ─────────────────────────────────────────────────────────

/**
 * Schedule a feedback prompt to fire `delayMs` after LP delivery.
 * Non-blocking — returns immediately; setTimeout fires the prompt later.
 *
 * @param {Object} opts
 * @param {string} opts.lessonPlanId  UUID of the lesson_plans row just inserted
 * @param {string} opts.userId        Teacher's users.id (UUID)
 * @param {string} opts.phone         Teacher's phone number (for delivery)
 * @param {Object} [opts.context]     { grade, subject, chapterNumber, segmentNumber, topic, lpVariant, language }
 * @param {number} [opts.delayMs=30000]
 */
function scheduleFeedbackPrompt(opts) {
  const { lessonPlanId, userId, phone, context = {}, delayMs = FEEDBACK_DELAY_MS } = opts;

  if (!lessonPlanId || !userId || !phone) {
    logToFile('LP Feedback: scheduleFeedbackPrompt missing required field', {
      lessonPlanId, userId, phone,
    });
    return;
  }

  logToFile('LP Feedback: scheduled', {
    lessonPlanId, userId, phone, delayMs,
    grade: context.grade, subject: context.subject, topic: context.topic,
    lpVariant: context.lpVariant, language: context.language,
  });

  setTimeout(() => {
    sendFeedbackPrompt({ lessonPlanId, userId, phone, context }).catch((err) => {
      logToFile('LP Feedback: sendFeedbackPrompt threw', {
        error: err.message, lessonPlanId,
      });
    });
  }, delayMs).unref?.();
}

// ─── 2. Send prompt ───────────────────────────────────────────────────────

async function sendFeedbackPrompt({ lessonPlanId, userId, phone, context }) {
  const language = await _resolveLanguage(userId, context && context.language);
  const body = _promptBody(language);
  const buttons = _promptButtons(language, lessonPlanId);
  const ok = await WhatsAppService.sendInteractiveButtons(phone, { body, buttons });
  logToFile('LP Feedback: prompt sent', { lessonPlanId, userId, phone, language, ok });
}

// ─── 3. Button handler ────────────────────────────────────────────────────

/**
 * Handle a `lp_feedback_(yes|no)_<uuid>` button reply.
 * Called from whatsapp-bot.js button_reply router.
 *
 * @param {string} buttonId
 * @param {string} phone
 * @returns {Promise<boolean>} true if the buttonId matched + was handled
 */
async function handleFeedbackButton(buttonId, phone) {
  const match = BUTTON_RX.exec(buttonId || '');
  if (!match) return false;

  const useful = match[1] === 'yes';
  const lessonPlanId = match[2];

  // Look up the LP row to snapshot context onto the feedback row.
  // NIETE lesson_plans schema: id, user_id, topic, grade, subject, type,
  // gamma_url, pdf_url, content, created_at. Any missing fields on the row
  // become NULL on lp_feedback — that's fine, we still get the useful=yes/no.
  const { data: lp, error: lpError } = await supabase
    .from('lesson_plans')
    .select('id, user_id, topic, grade, subject, type, content')
    .eq('id', lessonPlanId)
    .maybeSingle();

  if (lpError || !lp) {
    logToFile('LP Feedback: button tap for unknown lesson_plan_id', {
      lessonPlanId, err: lpError?.message,
    });
    await WhatsAppService.sendMessage(phone, 'Thanks for the feedback!');
    return true;
  }

  // Snapshot chapter/segment/lp_variant/grade/subject from content JSONB when
  // present. NIETE's `storeLessonPlan` helper doesn't set grade/subject as
  // columns — the delivery paths stash them inside `content` for us to read
  // here. Fall back to the row columns for legacy rows / other writers.
  const meta = (lp.content && typeof lp.content === 'object') ? lp.content : {};
  const chapterNumber = meta.chapter_number ?? null;
  const segmentNumber = meta.segment_number ?? null;
  const lpVariant = meta.lp_variant ?? lp.type ?? null;
  const subjectVal = meta.subject ?? lp.subject ?? null;
  // grade: prefer meta.grade (int), else parse lp.grade varchar; leave null if neither.
  const rawGrade = meta.grade ?? lp.grade;
  const gradeInt = rawGrade != null
    ? (Number.isFinite(parseInt(rawGrade, 10)) ? parseInt(rawGrade, 10) : null)
    : null;

  const language = await _resolveLanguage(lp.user_id, meta.language);

  // Idempotency: check for an existing row for (user, lesson_plan)
  const { data: existing } = await supabase
    .from('lp_feedback')
    .select('id, useful')
    .eq('lesson_plan_id', lessonPlanId)
    .eq('user_id', lp.user_id)
    .maybeSingle();

  if (existing) {
    if (existing.useful !== useful) {
      await supabase.from('lp_feedback').update({ useful }).eq('id', existing.id);
    }
    logToFile('LP Feedback: duplicate tap', {
      lessonPlanId, userId: lp.user_id, useful, existingId: existing.id,
    });
    if (useful) {
      await WhatsAppService.sendMessage(phone, _ackYes(language));
    } else {
      await redisService.set(
        REDIS_REASON_KEY(lp.user_id),
        { lpFeedbackId: existing.id, polarity: 'disliked', promptedAt: Date.now() },
        REASON_WINDOW_SECS,
      );
      await WhatsAppService.sendMessage(phone, _askReasonOnNo(language));
    }
    return true;
  }

  // Insert the feedback row
  const { data: inserted, error: insertError } = await supabase
    .from('lp_feedback')
    .insert({
      user_id: lp.user_id,
      lesson_plan_id: lessonPlanId,
      useful,
      lp_variant: lpVariant,
      grade: gradeInt,
      subject: subjectVal,
      chapter_number: chapterNumber,
      segment_number: segmentNumber,
      topic: lp.topic,
      trigger_mode: meta.trigger_mode || 'after_pdf_only',
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    logToFile('LP Feedback: insert failed', {
      lessonPlanId, userId: lp.user_id, useful,
      error: insertError?.message || 'insert returned no row',
    });
    // Still ack. On 👎, prompt for a reason using an orphan sentinel so we
    // still capture it via a log event even if the DB write is broken.
    if (useful) {
      await WhatsAppService.sendMessage(phone, _ackYes(language));
    } else {
      await redisService.set(
        REDIS_REASON_KEY(lp.user_id),
        { lpFeedbackId: '__orphan__', lessonPlanId, promptedAt: Date.now() },
        REASON_WINDOW_SECS,
      );
      await WhatsAppService.sendMessage(phone, _askReasonOnNo(language));
    }
    return true;
  }

  logToFile('LP Feedback: button tapped', {
    lessonPlanId, userId: lp.user_id, useful, feedbackId: inserted.id,
  });

  if (useful) {
    // NIETE MVP: no askReasonOnYes opt-in. Just say thanks.
    await WhatsAppService.sendMessage(phone, _ackYes(language));
  } else {
    await redisService.set(
      REDIS_REASON_KEY(lp.user_id),
      { lpFeedbackId: inserted.id, polarity: 'disliked', promptedAt: Date.now() },
      REASON_WINDOW_SECS,
    );
    await WhatsAppService.sendMessage(phone, _askReasonOnNo(language));
  }
  return true;
}

// ─── 4. Reason-capture middleware ─────────────────────────────────────────

/**
 * If the Redis reason-flag is set for this user, consume the next inbound
 * text as the reason and short-circuit. Called from text-message.handler.js
 * BEFORE any intent detection.
 *
 * @param {string} userId  users.id (UUID)
 * @param {string} phone   sender phone
 * @param {string} text    inbound message text
 * @returns {Promise<boolean>} true if consumed (caller should return early)
 */
async function consumeReasonIfPending(userId, phone, text) {
  if (!userId || !text || !text.trim()) return false;

  let pending;
  try {
    pending = await redisService.get(REDIS_REASON_KEY(userId));
  } catch (err) {
    logToFile('LP Feedback: Redis get error', { error: err.message });
    return false;
  }
  if (!pending || !pending.lpFeedbackId) return false;

  // Slash commands are user intent, not feedback — let the router handle
  if (text.trim().startsWith('/')) {
    logToFile('LP Feedback: reason skipped (slash command)', {
      userId, feedbackId: pending.lpFeedbackId,
    });
    return false;
  }

  // Clear the flag first — a failed UPDATE below shouldn't trap the user
  try { await redisService.delete(REDIS_REASON_KEY(userId)); } catch (_) { /* non-fatal */ }

  // Cheap language heuristic for the reason itself (independent of user's
  // preferred_language — the reason text may be in a different language
  // than the UI).
  const hasUrduScript = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(text);
  const reasonLanguage = hasUrduScript ? 'ur' : 'en';
  const reasonTrimmed = text.trim().slice(0, 2000);

  if (pending.lpFeedbackId === '__orphan__') {
    logToFile('LP Feedback: reason received (orphan — insert had failed)', {
      userId, reasonLanguage, reasonLength: reasonTrimmed.length,
      reasonText: reasonTrimmed, lessonPlanId: pending.lessonPlanId || null,
    });
    const uiLang = await _resolveLanguage(userId, reasonLanguage);
    await WhatsAppService.sendMessage(phone, _finalAck(uiLang));
    return true;
  }

  const reasonPolarity =
    pending.polarity === 'liked' ? 'liked' :
    pending.polarity === 'disliked' ? 'disliked' :
    'disliked'; // NIETE MVP only prompts on 👎

  const { error: updateError } = await supabase
    .from('lp_feedback')
    .update({
      reason_text: reasonTrimmed,
      reason_received_at: new Date().toISOString(),
      reason_language: reasonLanguage,
      reason_polarity: reasonPolarity,
    })
    .eq('id', pending.lpFeedbackId);

  if (updateError) {
    logToFile('LP Feedback: reason UPDATE failed', {
      error: updateError.message, feedbackId: pending.lpFeedbackId,
    });
    return false;
  }

  logToFile('LP Feedback: reason received', {
    userId, feedbackId: pending.lpFeedbackId,
    reasonLanguage, reasonLength: reasonTrimmed.length,
  });
  const uiLang = await _resolveLanguage(userId, reasonLanguage);
  await WhatsAppService.sendMessage(phone, _finalAck(uiLang));
  return true;
}

module.exports = {
  scheduleFeedbackPrompt,
  sendFeedbackPrompt,
  handleFeedbackButton,
  consumeReasonIfPending,
  // exported for tests:
  FEEDBACK_DELAY_MS,
  REASON_WINDOW_SECS,
  REDIS_REASON_KEY,
  BUTTON_RX,
};
