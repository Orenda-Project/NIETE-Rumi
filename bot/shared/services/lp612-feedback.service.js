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
 * RECEIPTS ARE THE REACTION (Meta bill cut NL1, bd-w2daa.9; FX1, bd-w2daa.22). A usage answer or
 * a typed reason gets a 🙏 reaction on her own message, not a text (every text is billed from
 * 1 Oct 2026; a reaction is free). It is OUR reaction: the webhook's 👍 on every inbound message
 * answers nothing in particular. `lp612UsedThanks` / `lp612FeedbackReasonThanks` are sent only
 * when the reaction cannot go out; anything that ASKS — the 👎 reason ask, Q2 — still goes.
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
const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../config/ux-strings');
const {
  TABLE, FEEDBACK_DELAY_MS, REASON_WINDOW_SECS, REDIS_REASON_KEY, BUTTON_RX, USAGE_RX,
  variantFor, _voiceOf,
} = require('./lp612-feedback.shared');
// The inbound half (bd-2dpco). Re-exported below so every existing `require` of this file keeps
// working and no call site moved.
const { handleFeedbackButton, handleUsageButton, consumeReasonIfPending } = require('./lp612-feedback-taps.service');

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
  const { segmentId, userId, phone, lang, renderId = null, delayMs = FEEDBACK_DELAY_MS } = opts || {};
  if (!segmentId || !userId || !phone) {
    logToFile('LP 6-12 feedback: prompt not scheduled, missing field', { segmentId, userId, phone });
    return;
  }

  // `renderId` is carried but never REQUIRED: a prompt that refused to schedule because an
  // id was absent would trade a teacher's verdict for a column, which is the wrong way round.
  logEvent('lp612.feedback.scheduled', {
    segmentId, userId, renderId, lang: clampLanguage(lang), delayMs,
  });

  const timer = setTimeout(() => {
    // Exported-object call, not the bare function: the delivery path spies on this module, and a
    // direct reference would bypass a test double AND make the two impossible to tell apart.
    module.exports.sendFeedbackPrompt({ segmentId, userId, phone, lang, renderId }).catch((err) => {
      logToFile('LP 6-12 feedback: prompt send threw', { segmentId, userId, error: err.message });
    });
  }, delayMs);
  if (timer.unref) timer.unref();
}

// ─── 2. send ────────────────────────────────────────────────────────────────

async function sendFeedbackPrompt({ segmentId, userId, phone, lang, renderId = null }) {
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

  // The tap arrives LATER as `lp612_fb_(yes|no)_(en|ur)_<segment_id>`, which carries no render
  // id — so the join from a verdict back to the artifact is made here, in Axiom, on
  // (segmentId, userId). A direct SQL join still needs a render column on `lp_feedback`. bd-jsong.
  logEvent('lp612.feedback.prompt_sent', {
    segmentId, userId, renderId, lang: docLang, voice, ok: ok !== false,
  });
}

module.exports = {
  scheduleFeedbackPrompt,
  sendFeedbackPrompt,
  handleFeedbackButton,
  handleUsageButton,
  consumeReasonIfPending,
  // exported for tests:
  FEEDBACK_DELAY_MS,
  REASON_WINDOW_SECS,
  REDIS_REASON_KEY,
  BUTTON_RX,
  USAGE_RX,
  variantFor,
};
