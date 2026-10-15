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

/** A new code for this child → 'JUGNU-XXXXX', or null. One retry on a collision. */
async function mint(canonicalId, deviceRef = null, now = new Date()) {
  if (!canonicalId) return null;
  const minted = new Date(now);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const code = randomCode();
    try {
      const { error } = await supabase.from(TABLE).insert({
        code, canonical_id: String(canonicalId), device_ref: deviceRef ? String(deviceRef).slice(0, 64) : null,
        minted_at: minted.toISOString(), expires_at: new Date(minted.getTime() + TTL_MS).toISOString(),
      });
      if (!error) return code;
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

module.exports = { mint, get, markUsed, parseCode, randomCode, CODE_RX, OUTCOMES, ALPHABET, TTL_MS, TABLE };
