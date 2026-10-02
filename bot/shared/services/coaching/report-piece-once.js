'use strict';
/**
 * Meta bill cut NC5 (N1-13) — each coaching report piece goes out ONCE per session.
 *
 * Measured on production (7 days to 30 Sep 2026): 1.6–1.9% of sessions got the
 * hero report image, the voice debrief or the commit prompt twice, and 4.5% of
 * reflective questions were asked twice — the same job ran twice for one session
 * (a redelivered or re-queued job), and every send in it went out again.
 *
 * The guard sits at the SEND, keyed by the session (+ piece): a Redis SET NX
 * taken immediately before the send. Whoever takes it sends; a second run finds
 * it taken and skips that one send. Rules:
 *   - a send that FAILS gives the claim back (`release`), so a retry can still
 *     deliver the piece — a claim must never turn a failure into a silent loss;
 *   - Redis down / erroring → the claim reports "taken by us" (fail OPEN): a rare
 *     double send beats a report that never arrives. railway-redis.setNX already
 *     behaves this way; the try/catch below covers a client without setNX.
 *
 * Load: one SET NX per piece per report (six keys per session, 24 h TTL —
 * 'step4' and 'survey' added by FX1, bd-w2daa.22).
 */

const { logToFile } = require('../../utils/logger');

const PIECE_TTL_SECONDS = 24 * 60 * 60;
const keyOf = (sessionId, piece) => `coaching:sent:${sessionId}:${piece}`;

function redis() {
  return require('../cache/railway-redis.service');
}

/**
 * @param {string} sessionId
 * @param {string} piece  e.g. 'step4', 'hero_report', 'voice_debrief', 'survey', 'commit_prompt', 'refl_q_1'
 * @returns {Promise<boolean>} true = this run sends it
 */
async function claimPiece(sessionId, piece) {
  if (!sessionId || !piece) return true;
  try {
    const ok = await redis().setNX(keyOf(sessionId, piece), new Date().toISOString(), PIECE_TTL_SECONDS);
    if (ok === false) {
      logToFile('🔁 Report piece already sent for this session — skipping the duplicate send', { coachingSessionId: sessionId, piece });
      return false;
    }
    return true;
  } catch (err) {
    logToFile('⚠️ report-piece claim unavailable — sending (fail open)', { coachingSessionId: sessionId, piece, error: err.message }, 'warn');
    return true;
  }
}

/** Give a claim back after a send that did not go out. Never throws. */
async function releasePiece(sessionId, piece) {
  if (!sessionId || !piece) return;
  try {
    await redis().delete(keyOf(sessionId, piece));
  } catch (err) {
    logToFile('⚠️ report-piece claim could not be released', { coachingSessionId: sessionId, piece, error: err.message }, 'warn');
  }
}

module.exports = { claimPiece, releasePiece, PIECE_TTL_SECONDS, keyOf };
