'use strict';
/**
 * bd-bmc9a0.2 — ICT IAB Experience View row 32: a lesson recorded in the teacher app (IAB) that she never reflected on
 * reaches her chat 24 hours later, with "You did not reflect on this lesson, but here is your feedback report."
 *
 *   dc_iab_unreflected_report_24h   true (or "true") ON; anything else, no row, or a read error is OFF.
 *
 * OFF is exactly today: every lesson waiting on its reflection is auto-completed at 12 hours with the generic line.
 * ON changes only the teacher's own portal lessons (portal-coaching.service isPortalTeacherSession); WhatsApp-recorded
 * lessons and a coach's observations keep 12 hours. Read by the stale-session sweep (bot/workers/stale-session.worker.js),
 * which runs in the sqs-worker; the row is one answer for every service, so there is no env var to set twice.
 *
 * Read the way the weekly report's switch is (coaching/weekly-report/switch.js): fail closed, 30 s cache, one read per
 * TTL during an outage.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { cachedSwitch } = require('../settings/switch-cache');

const KEY = 'dc_iab_unreflected_report_24h';
const TTL_MS = 30 * 1000;

function isOn(value) {
  if (value === true) return true;
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

const cache = cachedSwitch({
  ttlMs: TTL_MS,
  off: false,
  read: async () => {
    const { data, error } = await supabase.from('app_settings').select('key,value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    return (data || []).some((r) => r && r.key === KEY && isOn(r.value));
  },
  log: (err) => logToFile('IAB 24-hour report switch: settings lookup failed — treating as off', { error: err.message }, 'error'),
});

/** @returns {Promise<boolean>} */
async function on(now = Date.now()) {
  return cache.get(now);
}

function _resetCache() { cache.reset(); }

module.exports = { KEY, on, isOn, _resetCache };
