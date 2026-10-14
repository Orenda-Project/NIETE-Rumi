/**
 * Master switch for the v10 coaching test (bd-v0toag): app_settings.ab_v10_enabled.
 *
 * Everything the test adds checks this first, so with it off teachers get exactly what
 * they get today. Fail closed: no row, a value other than true, or a read error is off.
 * Same pattern as lp-ab-ch310.service.js.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const FLAG_KEY = 'ab_v10_enabled';
const FLAG_TTL_MS = 30 * 1000;
let flagCache = null; // { at, on }

function isOn(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* keep the raw string */ }
  }
  if (v === true) return true;
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}

async function v10Enabled(now = Date.now()) {
  if (flagCache && now - flagCache.at < FLAG_TTL_MS) return flagCache.on;
  try {
    const { data, error } = await supabase
      .from('app_settings').select('key,value').eq('key', FLAG_KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    flagCache = { at: now, on: Boolean(data && isOn(data.value)) };
    return flagCache.on;
  } catch (err) {
    // Fail closed, and do not cache the failure.
    logToFile('v10 test: switch lookup failed — treating as off', { error: err.message });
    return false;
  }
}

function _resetCache() { flagCache = null; }

module.exports = { FLAG_KEY, v10Enabled, _resetCache };
