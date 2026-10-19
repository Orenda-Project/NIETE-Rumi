'use strict';
/**
 * Live moves (bd-v0toag.31): one single-use Soniox key per lesson, good for an hour of streaming, behind the
 * 5-stream cap. A full cap answers 'cap' without calling Soniox; a failed mint gives the slot back.
 */
const { mintTempKey, WS_URL, MODEL } = require('../../quiz/web-quiz-soniox-live');
const { createStreamCap } = require('./stream-cap');
const { logToFile } = require('../../../utils/logger');

const LESSON_SECONDS = 3600;
const defaultCap = createStreamCap();

/** → { ok:true, api_key, expires_at, ws, model } | { ok:false, reason:'cap'|'mint' } — never logs a key. */
async function mintLessonKey({ liveId, userId }, deps = {}) {
  const cap = deps.cap || defaultCap;
  const mint = deps.mint || mintTempKey;
  const log = deps.log || logToFile;
  const now = (deps.now || Date.now)();

  if (!cap.acquire(liveId, now)) {
    log('live_moves.key.refused', { userId, liveId, reason: 'cap', live: cap.size(now) });
    return { ok: false, reason: 'cap' };
  }
  const r = await mint(liveId, {}, { singleUse: true, sessionSeconds: LESSON_SECONDS });
  if (!r || !r.ok) {
    cap.release(liveId);
    log('live_moves.key.refused', { userId, liveId, reason: 'mint', live: cap.size(now) });
    return { ok: false, reason: 'mint' };
  }
  log('live_moves.key.minted', { userId, liveId, reason: null, live: cap.size(now) });
  return { ok: true, api_key: r.api_key, expires_at: r.expires_at, ws: WS_URL, model: MODEL };
}

module.exports = { mintLessonKey, defaultCap, LESSON_SECONDS };
