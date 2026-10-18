'use strict';
/**
 * bd-v0toag.32 — the weekly usage report's own switch and its template approval list, in app_settings:
 *
 *   v10_weekly_report_enabled    true sends; anything else (or no row, or a read error) is off.
 *   v10_weekly_report_templates  JSON list of the template names Meta has APPROVED, e.g.
 *                                ["weekly_usage_v1","weekly_usage_quiet_v1"]. A name not on it is never
 *                                sent (skipped template_not_approved); there is no free-form fallback.
 *
 * Read the way ab_v10_enabled is read (coaching/ab-v10-switch.js): fail closed, 30 s cache. A failed read is
 * kept 30 s too (settings/switch-cache): the last good settings this process read, else off. The report ALSO needs ab_v10_enabled on — the group lookup returns no group without it.
 */

const supabase = require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');
const { cachedSwitch } = require('../../settings/switch-cache');

const FLAG_KEY = 'v10_weekly_report_enabled';
const TEMPLATES_KEY = 'v10_weekly_report_templates';
const TTL_MS = 30 * 1000;

function parse(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return v; }
}

function isOn(value) {
  const v = parse(value);
  if (v === true) return true;
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}

function names(value) {
  const v = parse(value);
  return Array.isArray(v) ? v.filter((n) => typeof n === 'string' && n.trim()) : [];
}

const cache = cachedSwitch({
  ttlMs: TTL_MS,
  off: () => ({ enabled: false, approved: [] }),
  read: async () => {
    const { data, error } = await supabase
      .from('app_settings').select('key,value').in('key', [FLAG_KEY, TEMPLATES_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const byKey = new Map((data || []).map((r) => [r.key, r.value]));
    return { enabled: isOn(byKey.get(FLAG_KEY)), approved: names(byKey.get(TEMPLATES_KEY)) };
  },
  // Fail closed: the last good settings, else off, for 30 s.
  log: (err) => logToFile('v10 weekly report: settings lookup failed — treating as off', { error: err.message }, 'error'),
});

/** @returns {Promise<{enabled:boolean, approved:string[]}>} */
async function reportSettings(now = Date.now()) {
  return cache.get(now);
}

function _resetCache() { cache.reset(); }

module.exports = { FLAG_KEY, TEMPLATES_KEY, reportSettings, _resetCache };
