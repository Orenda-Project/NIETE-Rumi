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
 * WHERE THE REST OF IT LIVES (bd-2dpco). The survey outgrew 300 lines, and the split is by
 * lifecycle stage so the seam sits where a reader already puts one:
 *
 *   - THIS FILE — when to ask, and asking. `scheduleFeedbackPrompt` + `sendFeedbackPrompt`.
 *   - `lp612-feedback-taps.service.js` — what a tap records, and the reason window.
 *   - `lp612-feedback.shared.js` — table names, delays, the button grammar, the two shared reads.
 *
 * The two senders stay together on purpose: `scheduleFeedbackPrompt` fires
 * `module.exports.sendFeedbackPrompt`, and that indirection only survives while both sides name
 * the same module object. This file re-exports the tap handlers so every existing consumer —
 * `whatsapp-bot.js`, `text-message.handler.js`, `lp612-serving.service.js` and the suites that
 * `jest.mock` this path — keeps the single import it already has.
 */

const supabase = require('../config/supabase');
const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../config/ux-strings');
const {
  TABLE, FEEDBACK_DELAY_MS, REASON_WINDOW_SECS, REDIS_REASON_KEY,
  BUTTON_RX, USAGE_RX, variantFor, _voiceOf,
} = require('./lp612-feedback.shared');
const taps = require('./lp612-feedback-taps.service');

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
module.exports = {
  scheduleFeedbackPrompt,
  sendFeedbackPrompt,
  // Re-exported so this path stays the survey's ONE public door — see the header.
  handleFeedbackButton: taps.handleFeedbackButton,
  handleUsageButton: taps.handleUsageButton,
  consumeReasonIfPending: taps.consumeReasonIfPending,
  // exported for tests:
  FEEDBACK_DELAY_MS,
  REASON_WINDOW_SECS,
  REDIS_REASON_KEY,
  BUTTON_RX,
  USAGE_RX,
  variantFor,
};
