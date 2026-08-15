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

const stripPlus = (p) => (p && p.startsWith('+') ? p.slice(1) : p);

// 5 minutes — the window that was actually predictive in the real incident
// data (median 31 sends in the prior 5 min preceded a 131056), not a 60s guess.
const WINDOW_MS = 5 * 60 * 1000;

// Comfortably under the median-31-in-5-min figure that preceded real
// rejections. A safety margin, not a claim about Meta's exact (unpublished)
// per-recipient threshold — Meta does not publish one.
const MAX_SENDS_PER_WINDOW = 20;

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
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    const pruned = await loadWindow(phone, now);

    if (pruned.length < MAX_SENDS_PER_WINDOW) {
      pruned.push(now);
      // eslint-disable-next-line no-await-in-loop
      await saveWindow(phone, pruned);
      return;
    }

    // Room frees up once the OLDEST send in the window ages past WINDOW_MS.
    // Re-check after waiting rather than trusting a single wait to be
    // enough — Redis being briefly unavailable, or another process writing
    // in between, can otherwise strand the caller.
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
  }
}

module.exports = {
  throttle,
  WINDOW_MS,
  MAX_SENDS_PER_WINDOW,
  KEY_TTL_SECS,
  MAX_SLEEP_ITERATION_MS,
};
