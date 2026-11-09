// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Why, target model, follow-up (bd-42mo0w, audit planned): docs/lesson-plan-data-model-debt.md
/**
 * Was this paper useful? How can we make it better? — the post-delivery assessment survey.
 *
 * Every other check on a paper measures the DOCUMENT (marks budget, layout, the reader pass). Only
 * the teacher can say whether it was worth printing, and only she knows what would make the next
 * one better. This asks her both.
 *
 * SHAPE is borrowed from the lesson-plan surveys (`lp612-feedback.*`) step for step — schedule 30s
 * after delivery, two buttons, a row on the tap, a 10-minute Redis window that captures her next
 * message — so "what is our thumbs-up rate" has one answer across lanes. ONE DIFFERENCE, by
 * design: the "how can we make it better?" ask goes out after EITHER tap, not only after 👎. A
 * teacher who liked the paper still knows what is missing from it.
 *
 * STORAGE is `lp_feedback` (schema-first, no new table): the row carries `assessment_paper_id`
 * (V1.9.4) instead of a lesson id, `lp_variant` = `assessment_<lang>` as the lane discriminator,
 * and grade/subject/chapter snapshotted from the request so a query needs no join.
 *
 * BUTTON IDS: `asmt_fb_(yes|no)_<paper uuid>`, dispatched in `whatsapp-bot.js`. The language is
 * not carried: the tap reads her stored preference, which is what she is spoken to in.
 *
 * ONCE PER PAPER: a new version of the same paper (assessment-revision) does not re-ask, and a
 * paper she already rated is skipped.
 */

const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { tk: tkOf } = require('../quiz/web-quiz-kid');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');

const FEEDBACK_DELAY_MS = 30 * 1000;
const REASON_WINDOW_SECS = 600;
const REDIS_REASON_KEY = (userId) => `assessment_feedback_pending:${userId}`;
const BUTTON_RX = /^asmt_fb_(yes|no)_([0-9a-f-]{36})$/i;
const ORPHAN = '__orphan__';

const variantFor = (lang) => `assessment_${clampLanguage(lang)}`;

async function _voiceOf(userId) {
  try {
    const { data } = await supabase
      .from('users').select('preferred_language').eq('id', userId).maybeSingle();
    return clampLanguage(data && data.preferred_language);
  } catch (_) {
    return clampLanguage(null);
  }
}

// A helper, not inline: the column-completeness guard attributes columns to the nearest literal
// `.from('…')`, and an inline users read beside the lp_feedback writes confuses it.
async function _userByPhone(phone) {
  return supabase
    .from('users').select('id, preferred_language').eq('phone_number', phone).maybeSingle();
}

/** What the paper covered, for the row's snapshot. Never throws; nulls when unknown. */
async function _paperContext(paperId) {
  try {
    const { data: paper } = await supabase
      .from('assessment_papers').select('request_id').eq('id', paperId).maybeSingle();
    if (!paper || !paper.request_id) return {};
    const { data: req } = await supabase
      .from('assessment_requests').select('grade_code, subject_code, chapter_number')
      .eq('id', paper.request_id).maybeSingle();
    if (!req) return {};
    const grade = parseInt(String(req.grade_code).replace(/\D/g, ''), 10);
    return {
      grade: Number.isFinite(grade) ? grade : null,
      subject: req.subject_code || null,
      chapter_number: req.chapter_number ?? null,
    };
  } catch (_) {
    return {};
  }
}

// The 🙏 reaction helper is not on every tier yet; where it is missing, the thanks goes as a text.
const _deps = { loadAck: () => require('../coaching/ack-reaction') };

async function _thank(phone, messageId, userId) {
  const text = async () => resolveUx('assessmentFeedbackReasonThanks', { language: await _voiceOf(userId) });
  let ack = null;
  try { ack = _deps.loadAck(); } catch (err) { if (err.code !== 'MODULE_NOT_FOUND') throw err; }
  if (!ack) return WhatsAppService.sendMessage(phone, await text());
  return ack.reactOrSay({ to: phone, messageId, emoji: '🙏', what: 'assessment_reason', text });
}

// ─── 1. schedule ────────────────────────────────────────────────────────────

/**
 * Non-blocking; called by the orchestrator once the paper and key are in her chat. The timer is
 * unref'd: losing a prompt to a restart is cheaper than a worker that will not exit.
 */
function scheduleAssessmentFeedback(opts) {
  const { paperId, userId, phone, delayMs = FEEDBACK_DELAY_MS } = opts || {};
  if (!paperId || !userId || !phone) {
    logToFile('[assessment] feedback not scheduled, missing field', { paperId, tk: tkOf(userId), hasPhone: !!phone });
    return;
  }
  logEvent('assessment.feedback.scheduled', { paperId, tk: tkOf(userId), delayMs });
  const timer = setTimeout(() => {
    module.exports.sendAssessmentFeedbackPrompt({ paperId, userId, phone }).catch((err) => {
      logToFile('[assessment] feedback prompt threw', { paperId, tk: tkOf(userId), error: err.message });
    });
  }, delayMs);
  if (timer.unref) timer.unref();
}

// ─── 2. send ────────────────────────────────────────────────────────────────

async function sendAssessmentFeedbackPrompt({ paperId, userId, phone }) {
  const voice = await _voiceOf(userId);
  // A failed read falls through and asks: asked twice is a smaller harm than never asked.
  try {
    const { data: already } = await supabase
      .from('lp_feedback').select('id')
      .eq('user_id', userId).eq('assessment_paper_id', paperId)
      .limit(1).maybeSingle();
    if (already) {
      logEvent('assessment.feedback.prompt_skipped', { paperId, tk: tkOf(userId), reason: 'already_answered' });
      return;
    }
  } catch (err) {
    logToFile('[assessment] feedback: existing-verdict check failed, asking anyway', { paperId, error: err.message });
  }

  const ok = await WhatsAppService.sendInteractiveButtons(phone, {
    body: resolveUx('assessmentFeedbackAsk', { language: voice }),
    buttons: [
      { id: `asmt_fb_yes_${paperId}`, title: resolveUx('assessmentFeedbackYes', { language: voice }) },
      { id: `asmt_fb_no_${paperId}`, title: resolveUx('assessmentFeedbackNo', { language: voice }) },
    ],
  });
  logEvent('assessment.feedback.prompt_sent', { paperId, tk: tkOf(userId), voice, ok: ok !== false });
}

// ─── 3. the tap ─────────────────────────────────────────────────────────────

/** @returns {Promise<boolean>} true iff this handler owned the id */
async function handleAssessmentFeedbackButton(buttonId, phone) {
  const match = BUTTON_RX.exec(buttonId || '');
  if (!match) return false;
  const useful = match[1].toLowerCase() === 'yes';
  const paperId = match[2];

  const { data: user, error: userError } = await _userByPhone(phone);
  if (userError || !user) {
    logEvent('assessment.feedback.unattributable', { paperId, useful });
    return true;
  }
  const voice = clampLanguage(user.preferred_language);
  const ctx = await _paperContext(paperId);

  const { data: existing } = await supabase
    .from('lp_feedback').select('id, useful')
    .eq('user_id', user.id).eq('assessment_paper_id', paperId)
    .limit(1).maybeSingle();

  let feedbackId;
  if (existing) {
    if (existing.useful !== useful) {
      await supabase.from('lp_feedback').update({ useful }).eq('id', existing.id);
    }
    feedbackId = existing.id;
    logEvent('assessment.feedback.retapped', { paperId, tk: tkOf(user.id), useful, feedbackId });
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('lp_feedback')
      .insert({
        user_id: user.id,
        assessment_paper_id: paperId,
        lp_variant: variantFor(voice),
        useful,
        grade: ctx.grade ?? null,
        subject: ctx.subject ?? null,
        chapter_number: ctx.chapter_number ?? null,
        // The delivered artefact is a document; the CHECK offers exactly this state for it.
        trigger_mode: 'after_pdf_only',
      })
      .select('id')
      .single();
    if (insertError || !inserted) {
      const error = (insertError && insertError.message) || 'insert returned no row';
      logToFile('[assessment] feedback insert failed', { paperId, tk: tkOf(user.id), error });
      logEvent('assessment.feedback.insert_failed', { paperId, tk: tkOf(user.id), useful, error });
      feedbackId = ORPHAN; // she is still asked; her answer is kept as an event
    } else {
      feedbackId = inserted.id;
      logEvent('assessment.feedback.recorded', { paperId, tk: tkOf(user.id), useful, feedbackId });
    }
  }

  try {
    await redisService.set(
      REDIS_REASON_KEY(user.id),
      { feedbackId, paperId, polarity: useful ? 'liked' : 'disliked', promptedAt: Date.now() },
      REASON_WINDOW_SECS,
    );
  } catch (err) {
    logToFile('[assessment] feedback: could not arm the improve window', { paperId, error: err.message });
  }
  await WhatsAppService.sendMessage(phone, resolveUx('assessmentFeedbackAskImprove', { language: voice }));
  return true;
}

// ─── 4. how to make it better ───────────────────────────────────────────────

/**
 * Consume her next text as the improvement idea if the window is open. Called from
 * text-message.handler before routing. @returns {Promise<boolean>} true if consumed.
 */
async function consumeReasonIfPending(userId, phone, text, opts = {}) {
  const messageId = opts && opts.messageId;
  if (!userId || !text || !String(text).trim()) return false;

  let pending;
  try {
    pending = await redisService.get(REDIS_REASON_KEY(userId));
  } catch (err) {
    logToFile('[assessment] feedback: Redis read failed', { error: err.message });
    return false;
  }
  if (!pending || !pending.feedbackId) return false;
  // A slash command is intent, not an answer; the window stays armed.
  if (String(text).trim().startsWith('/')) return false;

  // Cleared first: a failed UPDATE must not trap her in a window that eats every message.
  try { await redisService.delete(REDIS_REASON_KEY(userId)); } catch (_) { /* non-fatal */ }

  const reasonLanguage = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(text) ? 'ur' : 'en';
  const reasonText = String(text).trim().slice(0, 2000);
  const polarity = pending.polarity === 'liked' || pending.polarity === 'disliked' ? pending.polarity : 'unknown';

  if (pending.feedbackId === ORPHAN) {
    logEvent('assessment.feedback.reason_orphaned', {
      tk: tkOf(userId), paperId: pending.paperId || null, reasonLanguage, reasonText, polarity,
    });
    await _thank(phone, messageId, userId);
    return true;
  }

  const { error } = await supabase
    .from('lp_feedback')
    .update({
      reason_text: reasonText,
      reason_received_at: new Date().toISOString(),
      reason_language: reasonLanguage,
      reason_polarity: polarity,
    })
    .eq('id', pending.feedbackId);
  if (error) {
    logToFile('[assessment] feedback reason UPDATE failed', { feedbackId: pending.feedbackId, error: error.message });
    return false;
  }
  logEvent('assessment.feedback.reason_received', {
    tk: tkOf(userId), paperId: pending.paperId || null, feedbackId: pending.feedbackId,
    reasonLanguage, reasonLength: reasonText.length, polarity,
  });
  await _thank(phone, messageId, userId);
  return true;
}

module.exports = {
  scheduleAssessmentFeedback,
  sendAssessmentFeedbackPrompt,
  handleAssessmentFeedbackButton,
  consumeReasonIfPending,
  FEEDBACK_DELAY_MS,
  REASON_WINDOW_SECS,
  REDIS_REASON_KEY,
  BUTTON_RX,
  _deps,
};
