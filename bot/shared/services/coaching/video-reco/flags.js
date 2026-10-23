'use strict';
/**
 * The video recommendation's switches (bd-gzfdu9).
 *
 * Read at CALL time, never cached at import (uptake-loop-flags.js pattern): a
 * worker outlives any one env snapshot. Unset = off, and with VIDEO_RECO_ENABLED
 * off nothing the recommendation adds runs — no row, no LLM call, no message.
 */
function on(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

function videoRecoEnabled(env = process.env) {
  return on(env.VIDEO_RECO_ENABLED);
}

function videoRecoAbEnabled(env = process.env) {
  return on(env.VIDEO_RECO_AB_ENABLED);
}

/** 'shadow' = every row is stored as status 'shadow' and nothing reaches a teacher (r-ab's prod shadow week). */
function videoRecoMode(env = process.env) {
  return String(env.VIDEO_RECO_MODE || '').trim().toLowerCase() === 'shadow' ? 'shadow' : 'normal';
}

module.exports = { videoRecoEnabled, videoRecoAbEnabled, videoRecoMode };
