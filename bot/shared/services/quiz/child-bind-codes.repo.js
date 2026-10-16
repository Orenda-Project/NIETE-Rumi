'use strict';
/**
 * The single-use codes a family sends on WhatsApp to bind a phone to a child (table child_bind_codes).
 *
 * 'JUGNU-' + 5 of [A-Z2-9] without O and I (a code may be retyped by hand), crypto random, valid 1 hour.
 * `device_ref` is written for the audit only and never read to decide who a child is.
 * Supabase only; never throws.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const TABLE = 'child_bind_codes';
const PREFIX = 'JUGNU-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // [A-Z2-9] without O, I (0 and 1 are outside the range)
const CODE_LEN = 5;
const TTL_MS = 60 * 60 * 1000;
const REUSE_MARGIN_MS = 10 * 60 * 1000;   // a live code is handed out again only while it has at least this long left
const CODE_RX = /^JUGNU-([A-Z2-9]{5})$/i;
const OUTCOMES = Object.freeze(['bound', 'max_kids', 'max_phones', 'teacher_phone', 'code_expired', 'code_used', 'child_unknown']);

function randomCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i += 1) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return PREFIX + s;
}

/** The code in a WhatsApp message: its last whitespace token, when that whole token is a code; else null. */
function parseCode(text) {
  const toks = String(text || '').trim().split(/\s+/);
  const last = toks[toks.length - 1] || '';
  return CODE_RX.test(last) ? last.toUpperCase() : null;
}

/** The child's live code for this device (unspent, with ≥ 10 min left, same device_ref) → { code, expires_at, reused: true }, or null. */
async function liveFor(canonicalId, deviceRef, now) {
  if (!deviceRef) return null;
  const { data, error } = await supabase.from(TABLE).select('code, expires_at')
    .eq('canonical_id', String(canonicalId)).eq('device_ref', String(deviceRef)).is('used_at', null)
    .gt('expires_at', new Date(new Date(now).getTime() + REUSE_MARGIN_MS).toISOString())
    .order('minted_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message || 'read failed');
  return data && data[0] ? { code: data[0].code, expires_at: data[0].expires_at, reused: true } : null;
}

/**
 * A code for this child → { code: 'JUGNU-XXXXX', expires_at: <ISO> } (the shape the page's mint reads), or null.
 * Idempotent per child × device: a second ask from the device that minted a still-live code answers that SAME code
 * with `reused: true` (a double tap or a reopened card never shows a family two codes for one child) — but only while
 * the code has at least ten minutes left, so a family never gets a code that dies before they press Send.
 * The device_ref read here only de-duplicates the child's OWN live code for the SAME device; it never identifies a
 * child or trusts a phone (IDENTITY §3). Without a device_ref every ask mints. One retry on a collision.
 */
async function mint(canonicalId, deviceRef = null, now = new Date()) {
  if (!canonicalId) return null;
  const minted = new Date(now);
  const dev = deviceRef ? String(deviceRef).slice(0, 64) : null;
  try {
    const live = await liveFor(canonicalId, dev, minted);
    if (live) return live;
  } catch (err) {
    logToFile('⚠️ child bind codes: live-code read failed, minting a new one', { error: err.message });
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const code = randomCode();
    const expiresAt = new Date(minted.getTime() + TTL_MS).toISOString();
    try {
      const { error } = await supabase.from(TABLE).insert({
        code, canonical_id: String(canonicalId), device_ref: dev,
        minted_at: minted.toISOString(), expires_at: expiresAt,
      });
      if (!error) return { code, expires_at: expiresAt };
      if (error.code !== '23505') throw new Error(error.message || 'insert failed');
    } catch (err) {
      logToFile('⚠️ child bind codes: mint failed', { error: err.message });
      return null;
    }
  }
  logToFile('⚠️ child bind codes: mint collided twice');
  return null;
}

/** The code's row (case-insensitive), or null. */
async function get(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!CODE_RX.test(c)) return null;
  try {
    const { data, error } = await supabase.from(TABLE).select('code, canonical_id, minted_at, expires_at, used_at, outcome').eq('code', c).maybeSingle();
    if (error) throw new Error(error.message);
    return data || null;
  } catch (err) {
    logToFile('⚠️ child bind codes: read failed', { error: err.message });
    return null;
  }
}

/** Spend the code with its outcome → true when this call spent it (false: unknown, already spent, bad outcome, failed). */
async function markUsed(code, outcome, now = new Date()) {
  const c = String(code || '').trim().toUpperCase();
  if (!CODE_RX.test(c) || !OUTCOMES.includes(outcome)) return false;
  try {
    const { data, error } = await supabase.from(TABLE).update({ used_at: new Date(now).toISOString(), outcome })
      .eq('code', c).is('used_at', null).select('code');
    if (error) throw new Error(error.message);
    return Boolean(data && data.length);
  } catch (err) {
    logToFile('⚠️ child bind codes: spend failed', { error: err.message });
    return false;
  }
}

module.exports = { mint, get, markUsed, parseCode, randomCode, CODE_RX, OUTCOMES, ALPHABET, TTL_MS, REUSE_MARGIN_MS, TABLE };
