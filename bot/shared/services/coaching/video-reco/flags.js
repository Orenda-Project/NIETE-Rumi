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

/**
 * "Proven chapters" mode (COS ruling 20261023T185329): the seg ids a pick may land on, comma-separated
 * ('50-s2,51-s1,51-s3,95-s3', the daily.sql :allowlist string). Unset or blank = null = every chapter (today).
 */
function videoRecoAllowlist(env = process.env) {
  const raw = String(env.VIDEO_RECO_ALLOWLIST || '').trim();
  return raw ? new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)) : null;
}

/**
 * Reason mode (COS ruling 20261024T044233 §1a): 'card' = the reason is never a moment the model cites — the card frame or
 * silence, and no model call. Unset or anything else = null = today.
 */
function videoRecoReason(env = process.env) {
  return String(env.VIDEO_RECO_REASON || '').trim().toLowerCase() === 'card' ? 'card' : null;
}

/**
 * The clip card on the /cr report page (COS ruling 20261026T155431 R7r): only an explicit off (false/0/off) removes it, so
 * the clip shows in the same places in every v10 arm during the A/B. Unset or anything else = true = today.
 */
function videoRecoCrCard(env = process.env) {
  return !['false', '0', 'off'].includes(String(env.VIDEO_RECO_CR_CARD || '').trim().toLowerCase());
}

/**
 * The separate WhatsApp clip message after the report (send.js), COS ruling 20261028T151950 §1: off unless explicitly on
 * (true/1). Off = the clip opens from a link in the report's own caption (caption-link.js) and the strip points at it.
 */
function videoRecoWaMessage(env = process.env) {
  return on(env.VIDEO_RECO_WA_MESSAGE);
}

module.exports = { videoRecoEnabled, videoRecoAbEnabled, videoRecoMode, videoRecoAllowlist, videoRecoReason, videoRecoCrCard, videoRecoWaMessage };
