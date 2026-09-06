/**
 * Did that 6-12 lesson actually help? — the post-delivery survey (bd-86ivw).
 *
 * WHY IT EXISTS. Everything else instrumenting this lane measures the DOCUMENT: the schema
 * validator, the canon lint, the render page caps, the timings. A lesson can pass all of them and
 * still be one no teacher would stand in front of a class with, and nothing in the pipeline can
 * tell the difference. This is the only signal that can.
 *
 * SHAPE, deliberately borrowed rather than invented. It mirrors `lp-feedback.service.js` (K-5) and
 * `student-video-feedback.service.js` step for step — schedule after delivery, two buttons, a row
 * on the tap, a 10-minute Redis window that captures the next message as the reason — because
 * three different survey lifecycles is how three different answers to "what is our thumbs-up rate"
 * come about.
 *
 * TWO THINGS IT DOES DIFFERENTLY, both deliberate:
 *
 *   1. EVERY teacher-facing string comes from the catalog (`resolveUx`). The two older services
 *      carry inline `language === 'ur' ? … : …` maps; that predates the catalog and the pre-push
 *      language gate, and copying it here would add three more offenders to a surface the repo is
 *      actively pulling in the other direction (root CLAUDE.md rule 20 — one writer, catalog copy,
 *      code-point caps).
 *   2. The lesson is identified by a TEXT segment id, not a `lesson_plans` UUID, because a 6-12
 *      lesson has no `lesson_plans` row. It is a (segment_id, lang, template_version) render. The
 *      row lands on `lp_feedback` all the same — see V1.3.5's header for what was ruled out.
 *
 * BUTTON IDS: `lp612_fb_(yes|no)_(en|ur)_<segment_id>`.
 *   - The prefix is distinct from `lp_feedback_` and `student_video_feedback_`, and is dispatched
 *     in `whatsapp-bot.js` beside them. An emitted prefix with no dispatcher is the orphan class
 *     the pre-merge checklist opens with: the teacher taps, an unknown id is logged, and the datum
 *     is gone with no error anywhere.
 *   - The DOCUMENT LANGUAGE rides in the id because a bot restart between the send and the tap
 *     loses any in-memory context, and `lp_variant` must be right. It is re-clamped on the way out
 *     of the id, never trusted.
 *   - Segment ids are `[A-Za-z0-9._-]`, so they are safe inside an id whose parts are underscore-
 *     separated: the segment is taken as EVERYTHING after the language, so an underscore inside it
 *     cannot split the parse.
 */

const supabase = require('../config/supabase');
const redisService = require('./cache/railway-redis.service');
const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../config/ux-strings');

const TABLE = 'lp_feedback';
const SEGMENTS = 'niete_lp612_segments';

/**
 * Long enough that she has opened the PDF, short enough that she is still on this task.
 * The same 30s the two sibling surveys use — a different number here would make the three
 * response rates incomparable for no reason.
 */
const FEEDBACK_DELAY_MS = 30 * 1000;
const REASON_WINDOW_SECS = 600;
const REDIS_REASON_KEY = (userId) => `lp612_feedback_pending:${userId}`;

/**
 * Anchored, and the segment is the REST of the string rather than one underscore-free token — a
 * real segment id is `grade_9_chemistry.c01.p007-008`, which is full of underscores.
 */
const BUTTON_RX = /^lp612_fb_(yes|no)_(en|ur)_(.+)$/;

/** The lane + document-language discriminator written into the existing `lp_variant` column. */
const variantFor = (lang) => `lp612_${clampLanguage(lang)}`;

/**
 * The language she is SPOKEN to in — her stored preference, not the document's language.
 * An Urdu-UI teacher who ordered an English physics plan is still asked in Urdu
 * (language-protocol invariant 4: the two territories are separate). Never throws.
 */
async function _voiceOf(userId, fallback) {
  try {
    const { data } = await supabase
      .from('users').select('preferred_language').eq('id', userId).maybeSingle();
    if (data && data.preferred_language) return clampLanguage(data.preferred_language);
  } catch (_) { /* fall through */ }
  return clampLanguage(fallback);
}

// ─── 1. schedule ────────────────────────────────────────────────────────────

/**
 * Non-blocking. Called from `deliverRender`, which is the ONE function both delivery paths run
 * through — the worker's per-waiter loop and the cache hit. Wiring it at the two call sites
 * instead is how they drift, and the cache hit is the path most teachers are on.
 *
 * The timer is detached and `unref`'d: it must never hold the worker process open, and losing a
 * prompt to a restart is a far cheaper failure than a job that will not exit.
 *
 * @param {object} opts
 * @param {string} opts.segmentId
 * @param {string} opts.userId
 * @param {string} opts.phone
 * @param {string} opts.lang     the DOCUMENT's language (what she received)
 * @param {number} [opts.delayMs]
 */
function scheduleFeedbackPrompt(opts) {
  const { segmentId, userId, phone, lang, delayMs = FEEDBACK_DELAY_MS } = opts || {};
  if (!segmentId || !userId || !phone) {
    logToFile('LP 6-12 feedback: prompt not scheduled, missing field', { segmentId, userId, phone });
    return;
  }

  logEvent('lp612.feedback.scheduled', {
    segmentId, userId, lang: clampLanguage(lang), delayMs,
  });

  const timer = setTimeout(() => {
    // Exported-object call, not the bare function: the delivery path spies on this module, and a
    // direct reference would bypass a test double AND make the two impossible to tell apart.
    module.exports.sendFeedbackPrompt({ segmentId, userId, phone, lang }).catch((err) => {
      logToFile('LP 6-12 feedback: prompt send threw', { segmentId, userId, error: err.message });
    });
  }, delayMs);
  if (timer.unref) timer.unref();
}

// ─── 2. send ────────────────────────────────────────────────────────────────

async function sendFeedbackPrompt({ segmentId, userId, phone, lang }) {
  const docLang = clampLanguage(lang);
  const voice = await _voiceOf(userId, lang);

  // ASK ONCE PER LESSON, PER TEACHER.
  //
  // A cache hit is a second's work, so she can re-tap the same subtopic freely and every one of
  // those is a delivery. Without this check she is surveyed again each time about a lesson she has
  // already rated — which is the fastest way to teach her to ignore the survey, and it costs us
  // the signal on every OTHER lesson too.
  //
  // It runs HERE, in the delayed callback, and not in `deliverRender`: the teacher waiting for her
  // PDF must not pay for a read that only matters thirty seconds later. The partial index on
  // (lp612_segment_id, created_at) covers it.
  //
  // A failed read falls through and asks. Being asked twice is a smaller harm than never being
  // asked because the database blinked.
  try {
    const { data: already } = await supabase
      .from(TABLE).select('id')
      .eq('user_id', userId).eq('lp612_segment_id', segmentId)
      .maybeSingle();
    if (already) {
      logEvent('lp612.feedback.prompt_skipped', { segmentId, userId, reason: 'already_answered' });
      return;
    }
  } catch (err) {
    logToFile('LP 6-12 feedback: could not check for an existing verdict, asking anyway', {
      segmentId, userId, error: err.message,
    });
  }

  const ok = await WhatsAppService.sendInteractiveButtons(phone, {
    body: resolveUx('lp612FeedbackAsk', { language: voice }),
    buttons: [
      { id: `lp612_fb_yes_${docLang}_${segmentId}`, title: resolveUx('lp612FeedbackYes', { language: voice }) },
      { id: `lp612_fb_no_${docLang}_${segmentId}`, title: resolveUx('lp612FeedbackNo', { language: voice }) },
    ],
  });

  logEvent('lp612.feedback.prompt_sent', { segmentId, userId, lang: docLang, voice, ok: ok !== false });
}

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

  const { data: user, error: userError } = await supabase
    .from('users').select('id, preferred_language').eq('phone_number', phone).maybeSingle();
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

  if (useful) {
    await WhatsAppService.sendMessage(phone, resolveUx('lp612FeedbackThanks', { language: voice }));
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
  scheduleFeedbackPrompt,
  sendFeedbackPrompt,
  handleFeedbackButton,
  consumeReasonIfPending,
  // exported for tests:
  FEEDBACK_DELAY_MS,
  REASON_WINDOW_SECS,
  REDIS_REASON_KEY,
  BUTTON_RX,
  variantFor,
};
