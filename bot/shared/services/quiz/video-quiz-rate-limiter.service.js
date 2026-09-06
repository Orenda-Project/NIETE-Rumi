'use strict';
/**
 * bd-2666 — per-recipient sliding-window self-throttle for video-quiz sends.
 *
 * video-quiz-sender.service.js paces sends with GAP_TEXT_MS/GAP_MEDIA_MS
 * (700ms/1200ms), but that pacing is tuned only for WhatsApp message
 * ORDERING (per that file's own comment) — never for Meta's per-
 * (business,consumer)-pair rate limit. A single question can send 5-16
 * messages at that pace, 4-5x faster than the ~10/min unofficial ceiling BSP
 * community sources (Twilio, Wati, DoubleTick, Heltar) report for error
 * 131056 ("(Business Account, Consumer Account) pair rate limit hit").
 *
 * Ported from the main bot (bd-2666 + bd-2681) — NIETE never had a proactive
 * throttle at all, so this file didn't exist here before. Constants and
 * comments carried over verbatim; only the paths were re-verified against
 * this fork's layout (identical: shared/services/cache/railway-redis.service,
 * shared/utils/logger — both present unchanged).
 *
 * This module is the PROACTIVE half: wait until there is room in a rolling
 * per-phone window BEFORE sending, so the flow slows down ahead of the limit
 * instead of reacting after it.
 *
 * Empirical basis for the constants (main bot's Axiom `digital-coach-logs`,
 * Aug 6-12 2026 incident, bd-2666): recipients who eventually hit 131056 had
 * received a median of 31 messages in the 5 minutes before their first
 * rejection — vs. a median of only 9 in the prior 60 seconds, which is NOT
 * itself alarming. The 5-minute window is what was actually predictive in
 * the real data, so WINDOW_MS models that instead of an arbitrary 60s guess.
 * MAX_SENDS_PER_WINDOW sits comfortably under the median-31-in-5-min figure
 * that preceded real rejections — a safety margin, not a claim about Meta's
 * exact (unpublished) threshold.
 *
 * Storage shape: railway-redis.service.js (required as `../cache/
 * railway-redis.service` — the actual Redis wrapper this codebase uses, not
 * a `redis.service.js` that doesn't exist) exposes a JSON-object KV wrapper
 * with a TTL (`get(key)` / `set(key, value, ttlSeconds)`), the same contract
 * video-quiz.service.js already relies on for STATE_KEY/OFFER_KEY. It has no
 * documented raw ZSET client, so the window is stored as a plain JSON array
 * of millisecond timestamps under one key per phone, read-modify-write on
 * every check.
 *
 * This module knows nothing about WhatsApp, quiz state, or message kinds —
 * just "given a phone, wait until it's safe to send, then record the send."
 */

const redisService = require('../cache/railway-redis.service');
// bd-2681 — this module emitted ZERO telemetry, so "is the throttle actually
// engaging, and how often/how long" could only be reconstructed indirectly
// (correlating separate failure logs against DB timestamps). Logging the
// wait decision directly makes that answerable straight from Axiom.
const { logToFile } = require('../../utils/logger');
// A 3.5-minute per-question wait on a real session was only findable by reading
// raw bot logs — logToFile above has no structured event. video_quiz.throttle_wait
// (below) makes a real stall visible to the log backend without grepping line by
// line.
const { logEvent } = require('../../utils/structured-logger');

const stripPlus = (p) => (p && p.startsWith('+') ? p.slice(1) : p);

// 5 minutes — the window that was actually predictive in the real incident
// data (median 31 sends in the prior 5 min preceded a 131056), not a 60s guess.
const WINDOW_MS = 5 * 60 * 1000;

// Re-costed after a real 8-question transcript quiz stalled for 3+ minutes per
// verdict from question 5 on: at
// 20, a question that cost 4 sends (the "Question n of N" chrome text, the
// card image, the letter buttons, the verdict) filled the window by question
// 5, and the only way out was waiting for the oldest send to age out.
//
// The real per-recipient budget for one child's fastest possible 8-question
// transcript-quiz run, counted from the code (not guessed), assuming the
// one-message-per-question change (a parallel edit, not this file) that
// collapses a question to 2 sends — one message carrying the question, one
// carrying the verdict:
//   1  video-quiz.service.js startSession's vqHereWeGo opener
//   16 8 questions x 2 (question message, verdict message)
//   1  video-quiz-scorecard.service.js sendScorecard (the caption rides on
//      the image, so it's one message, not two)
//   1  finish()'s video_solo OR share_link offer — video-quiz-share.service.js
//      offerShare, or video-quiz-invite.service.js offerInvite (the two are
//      mutually exclusive branches of the same finish(), never both). The
//      OTHER share_link send, video-quiz-invite.service.js notifyInviter,
//      goes to the INVITER's phone (`inviterStudent.phone`), not this
//      recipient's — a different (business, consumer) pair with its own,
//      separate window, so it does NOT count against this budget.
//   = 19 sends, with zero margin at the old cap of 20 — 20 is not a safety
// margin any more, it is a stall waiting to happen the moment a session adds
// one more send anywhere in that chain.
//
// 24 leaves that budget actual headroom while staying comfortably under the
// median-31-in-5-min figure that preceded real 131056 rejections (still a
// safety margin, not a claim about Meta's exact unpublished threshold). The
// one-message-per-question change is what makes 24 enough: the constant here
// and the per-question send cost are one budget, not two separate numbers —
// a future change that adds a send per question (or per opener, or per
// scorecard) has to come back to this comment and this constant.
const MAX_SENDS_PER_WINDOW = 24;

// A wait below this is normal pacing noise (the window was merely near full).
// Above it, a child was made to notice — this is what actually surfaces the
// 174s-213s stalls from the staging incident above.
const THROTTLE_WAIT_LOG_THRESHOLD_MS = 5000;

// TTL comfortably longer than the window, so a phone that stops sending mid-
// quiz doesn't leave a key hanging around forever — it just expires.
const KEY_TTL_SECS = Math.ceil(WINDOW_MS / 1000) + 60;

// Cap on each individual wait iteration. A caller stuck at budget doesn't
// block in one multi-minute sleep — it re-checks periodically, which keeps
// the wait responsive (and keeps this module testable with fake timers
// instead of a single opaque sleep).
const MAX_SLEEP_ITERATION_MS = 2000;

const rateKey = (phone) => `videoquiz:${stripPlus(phone)}:sendrate`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── process-wide outbound bucket ──────────────────────────────────────────
// The per-recipient window above protects one child. A CLASS tapping a
// forwarded link together is 30 children × 3 messages per question, and
// Meta's throughput limit (#130429) is per business, not per pair. This is
// a plain token bucket: OUTBOUND_MAX_MPS sends per second across the whole
// process, refilled continuously. Default 40, well under the smallest tier.
// Read at call time so an env change on Railway takes effect on restart
// without a code change.
let _bucket = { tokens: null, at: 0 };
function outboundMaxPerSecond() {
  const n = parseInt(process.env.OUTBOUND_MAX_MPS || '40', 10);
  return Number.isFinite(n) && n > 0 ? n : 40;
}
async function takeGlobalToken() {
  const max = outboundMaxPerSecond();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    if (_bucket.tokens === null) _bucket = { tokens: max, at: now };
    const refill = ((now - _bucket.at) / 1000) * max;
    _bucket.tokens = Math.min(max, _bucket.tokens + refill);
    _bucket.at = now;
    if (_bucket.tokens >= 1) {
      _bucket.tokens -= 1;
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(Math.ceil(((1 - _bucket.tokens) / max) * 1000));
  }
}
function resetGlobalBucket() { _bucket = { tokens: null, at: 0 }; }

/**
 * Load this phone's send timestamps, pruned to the current window.
 * @param {string} phone
 * @param {number} now
 * @returns {Promise<number[]>}
 */
async function loadWindow(phone, now) {
  const raw = await redisService.get(rateKey(phone));
  const timestamps = Array.isArray(raw) ? raw : [];
  return timestamps.filter((ts) => typeof ts === 'number' && now - ts < WINDOW_MS);
}

async function saveWindow(phone, timestamps) {
  await redisService.set(rateKey(phone), timestamps, KEY_TTL_SECS);
}

/**
 * Wait until it is safe to send another video-quiz message to `phone`, then
 * record that a send is about to happen. Callers await this immediately
 * before EVERY dispatch — text, audio, image, buttons, list, flow all count
 * equally, since Meta's per-recipient limit doesn't care about message kind.
 *
 * @param {string} phone
 * @returns {Promise<void>}
 */
async function throttle(phone) {
  await takeGlobalToken();
  const waitStart = Date.now();
  let iterations = 0;
  // The size of the window WHILE IT WAS FULL. Reading it at the iteration that
  // succeeded would report the count after room appeared, which is always below
  // the cap and says nothing about how full it got.
  let fullWindowCount = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    const pruned = await loadWindow(phone, now);

    if (pruned.length < MAX_SENDS_PER_WINDOW) {
      pruned.push(now);
      // eslint-disable-next-line no-await-in-loop
      await saveWindow(phone, pruned);
      // Only a call that actually made the caller wait is worth an event —
      // this is "a child was made to wait", not "a send happened". Emitting
      // on every ordinary send would bury the rare, actionable case in noise.
      // Measured, not accumulated from the sleeps we asked for: a loaded
      // event loop and a slow Redis both add real time a child feels and a
      // sum of intended sleeps does not show.
      const waitedMs = Date.now() - waitStart;
      if (waitedMs > THROTTLE_WAIT_LOG_THRESHOLD_MS) {
        logEvent('video_quiz.throttle_wait', {
          ms: waitedMs,
          phoneTail: phone ? String(phone).slice(-4) : phone,
          windowCount: fullWindowCount,
          maxPerWindow: MAX_SENDS_PER_WINDOW,
          iterations,
        });
      }
      return;
    }

    // Room frees up once the OLDEST send in the window ages past WINDOW_MS.
    // Re-check after waiting rather than trusting a single wait to be
    // enough — Redis being briefly unavailable, or another process writing
    // in between, can otherwise strand the caller.
    fullWindowCount = pruned.length;
    const oldest = pruned[0];
    const waitMs = Math.max(1, oldest + WINDOW_MS - now);
    const sleepMs = Math.min(waitMs, MAX_SLEEP_ITERATION_MS);
    logToFile('⏳ video-quiz rate-limiter: window full, waiting', {
      phone: phone ? phone.slice(-4) : phone,
      windowSize: pruned.length,
      maxPerWindow: MAX_SENDS_PER_WINDOW,
      sleepMs,
    });
    // eslint-disable-next-line no-await-in-loop
    await sleep(sleepMs);
    iterations += 1;
  }
}

module.exports = {
  throttle,
  takeGlobalToken,
  resetGlobalBucket,
  outboundMaxPerSecond,
  WINDOW_MS,
  MAX_SENDS_PER_WINDOW,
  KEY_TTL_SECS,
  MAX_SLEEP_ITERATION_MS,
  THROTTLE_WAIT_LOG_THRESHOLD_MS,
};
