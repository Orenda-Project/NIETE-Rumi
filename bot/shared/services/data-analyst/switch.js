'use strict';
/**
 * Who may use the data analyst on WhatsApp: app_settings `data_analyst_whatsapp`, a JSON LIST.
 *
 * Each entry names one person and the address their questions are asked as on the data team's MCP
 * (its audit trail and its domain check, engine/access.py on their side):
 *   "<users.id>"                          asked as DATA_MCP_USER_EMAIL (the operator, at first)
 *   {"id": "<users.id>", "email": "<a>"}  asked as that address (a later admin with their own)
 *
 * Stricter than the principal-app switch on purpose: `true` / "true" is OFF. "Everyone" on a data
 * tool is not something a single typed value should be able to turn on. No row, a malformed value, a
 * failed read, or a bare id with no configured address is OFF. Never throws.
 *
 * The row is read at most once a minute (one read for everyone, not one per message): every text
 * message from every teacher passes this door while the feature is configured.
 *
 * The feature itself is presence-gated (feature-availability FEATURE_GATES.data_analyst): with no
 * DATA_MCP_URL, DATA_MCP_USER_EMAIL or ANTHROPIC_API_KEY, nothing here is read at all.
 */

const { isFeatureRunnable } = require('../../config/feature-availability');

const DATA_ANALYST_KEY = 'data_analyst_whatsapp';
const CACHE_MS = 60 * 1000;

let cache = null; // { at, value }

function isConfigured(env = process.env) {
  return isFeatureRunnable('data_analyst', env);
}

function parse(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return null; }
  }
  return Array.isArray(v) ? v : null;
}

const looksLikeEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/**
 * The identity a stored switch value gives userId, or null when it does not name them. Pure.
 * @returns {{userId: string, email: string}|null}
 */
function identityFor(value, userId, env = process.env) {
  if (!userId) return null;
  const list = parse(value);
  if (!list) return null;
  for (const entry of list) {
    if (typeof entry === 'string' && entry === userId) {
      const email = String(env.DATA_MCP_USER_EMAIL || '').trim();
      return looksLikeEmail(email) ? { userId, email } : null;
    }
    if (entry && typeof entry === 'object' && entry.id === userId) {
      return looksLikeEmail(entry.email) ? { userId, email: entry.email.trim() } : null;
    }
  }
  return null;
}

async function readSwitch(supabase, now) {
  const t = now();
  if (cache && t - cache.at < CACHE_MS) return cache.value;
  let value = null;
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', DATA_ANALYST_KEY).maybeSingle();
    value = error || !data ? null : data.value;
  } catch (_) {
    value = null;
  }
  cache = { at: t, value };
  return value;
}

/**
 * @param {object} supabase
 * @param {string|null} userId users.id
 * @param {{env?: object, now?: () => number}} [opts]
 * @returns {Promise<{userId: string, email: string}|null>}
 */
async function dataAnalystIdentity(supabase, userId, { env = process.env, now = Date.now } = {}) {
  if (!userId) return null;
  const value = await readSwitch(supabase, now);
  return identityFor(value, userId, env);
}

function _resetCache() { cache = null; }

module.exports = { DATA_ANALYST_KEY, isConfigured, identityFor, dataAnalystIdentity, _resetCache };
