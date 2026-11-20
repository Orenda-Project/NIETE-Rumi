'use strict';
/**
 * bd-ra8xu.60 — Observation Notes for coach visits (/observe on FICO17 v6, WhatsApp and the portal).
 *
 *   app_settings.observation_notes    'off' | 'on'    default OFF (no row, unknown value, failed read)
 *
 * The value has the shape of obs612_coach / fico_coach_rubric and is looked up the same way ("user:<users.id>", the
 * role keys, the user's region, its organization, then "*"):
 *
 *   {"user:<uuid>": "on"}     the named test accounts (sandbox walk), or a pilot cohort of coaches
 *   {"role:coach": "on"}      every coach
 *   "on"                      everyone
 *
 * ON for a coach (keyed on the OBSERVER, never the teacher), on a v6 visit: after the recording arrives Rumi offers the
 * Observation Notes Flow; the portal Record and Check and send screens show a notes box; the review shows the notes on
 * each section intro; and, once there are notes and the blind analysis, the informed DC scoring is stored beside it
 * (analysis_data.dc_informed). Notes already saved are always shown, whatever the switch says now.
 * Flipping it needs no deploy (30 s cache). Undo: delete the row, or set the account to "off".
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { cachedSwitch } = require('../settings/switch-cache');
const { asMap, pickFor, regionOfUser } = require('../coaching/fico-rubric-switch');

const KEY = 'observation_notes';
const VALUES = ['off', 'on'];
const OFF = 'off';
const TTL_MS = 30 * 1000;

const cache = cachedSwitch({
  ttlMs: TTL_MS,
  off: () => ({}),
  read: async () => {
    const { data, error } = await supabase.from('app_settings').select('key,value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || [])[0];
    return asMap(row ? row.value : undefined);
  },
  log: (err) => logToFile('observation-notes switch: settings lookup failed — treating as off', { error: err.message }, 'error'),
});

/**
 * Are Observation Notes on for this coach? Never throws: false on any failure.
 * @param {string} userId  the coach (observer_user_id)
 */
async function isOn(userId, now = Date.now()) {
  if (!userId) return false;
  try {
    const map = await cache.get(now);
    if (!Object.keys(map).length) return false; // default: off for everyone, no region lookup
    const region = await regionOfUser(userId);
    return (await pickFor(map, { userId, region }, VALUES, OFF)) === 'on';
  } catch (_) {
    return false;
  }
}

function _resetCache() { cache.reset(); }

module.exports = { KEY, VALUES, OFF, isOn, _resetCache };
