'use strict';
/**
 * bd-ptl6x9.7 — the weak-skill Jugnu nudge's settings, in app_settings (seeded by V1.10.10):
 *
 *   weak_skill_jugnu_enabled    true sends; anything else (no row, a read error) is off.
 *   weak_skill_jugnu_templates  JSON list of the template names Meta has APPROVED. A name not on it is never sent;
 *                               there is no free-form fallback.
 *   weak_skill_jugnu_audience   'all' reaches every teacher with a Jugnu class list; anything else (the seed is
 *                               'test') reaches test accounts (users.is_test_user) only.
 *
 * Read like the weekly report's switch (coaching/weekly-report/switch.js): fail closed, 30 s cache.
 */

const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');
const { cachedSwitch } = require('../../settings/switch-cache');

const FLAG_KEY = 'weak_skill_jugnu_enabled';
const TEMPLATES_KEY = 'weak_skill_jugnu_templates';
const AUDIENCE_KEY = 'weak_skill_jugnu_audience';
const TTL_MS = 30 * 1000;

function parse(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return v; }
}
const word = (v) => { const p = parse(v); return typeof p === 'string' ? p.trim().toLowerCase() : p; };
const isOn = (v) => word(v) === true || word(v) === 'true';
const names = (v) => { const p = parse(v); return Array.isArray(p) ? p.filter((n) => typeof n === 'string' && n.trim()) : []; };

const OFF = () => ({ enabled: false, approved: [], testOnly: true });

const cache = cachedSwitch({
  ttlMs: TTL_MS,
  off: OFF,
  read: async () => {
    const { data, error } = await supabase
      .from('app_settings').select('key,value').in('key', [FLAG_KEY, TEMPLATES_KEY, AUDIENCE_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const byKey = new Map((data || []).map((r) => [r.key, r.value]));
    return {
      enabled: isOn(byKey.get(FLAG_KEY)),
      approved: names(byKey.get(TEMPLATES_KEY)),
      testOnly: word(byKey.get(AUDIENCE_KEY)) !== 'all',
    };
  },
  log: (err) => logToFile('weak-skill jugnu nudge: settings lookup failed — treating as off', { error: err.message }, 'error'),
});

/** @returns {Promise<{enabled:boolean, approved:string[], testOnly:boolean}>} */
function nudgeSettings(now = Date.now()) {
  return cache.get(now);
}

function _resetCache() { cache.reset(); }

module.exports = { FLAG_KEY, TEMPLATES_KEY, AUDIENCE_KEY, nudgeSettings, _resetCache };
