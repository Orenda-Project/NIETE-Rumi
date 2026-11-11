'use strict';
/**
 * bd-pni007 — the switch for FDE's grade 6-12 observation tools in coach visits (/observe and /observe2).
 *
 *   app_settings.obs612_coach    'off' | 'on'     default OFF (no row, an unknown value, or a failed read)
 *
 * The value has the same shape as the FICO rubric switches (coaching/fico-rubric-switch.js), and is looked up the
 * same way: "user:<users.id>", the user's region, its organization ("ict" = every region FDE owns), then "*".
 *
 *   "on"                              every coach
 *   {"user:<uuid>": "on"}             one account only (the operator's test account)
 *   {"ict": "on"}                     every NIETE (ICT) coach
 *
 * ON for a coach: each visit asks the lesson's class (and, for grades 6-12, its subject). A grade 6-12 lesson is
 * observed on FDE's tool for that class and subject; a grade 1-5 lesson stays on FICO, decided by the FICO coach
 * switch exactly as today. OFF: nothing is asked and both tools behave exactly as before. Flipping it needs no
 * deploy (30 s cache). A visit already started keeps the rubric it was stamped with.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { cachedSwitch } = require('../settings/switch-cache');
const { asMap, pickFor, regionOfUser } = require('./fico-rubric-switch');

const KEY = 'obs612_coach';
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
  log: (err) => logToFile('obs612 switch: settings lookup failed — treating as off', { error: err.message }, 'error'),
});

/**
 * Is FDE's grade 6-12 tool on for this coach? Never throws: false on any failure.
 * @param {{userId?: string, region?: string|null, organization?: string}} who  region omitted → read from users
 */
async function isOn(who = {}, now = Date.now()) {
  try {
    const map = await cache.get(now);
    if (!Object.keys(map).length) return false; // default off: no region lookup
    const w = { ...who };
    if (w.region === undefined) w.region = await regionOfUser(w.userId);
    return (await pickFor(map, w, VALUES, OFF)) === 'on';
  } catch (_) {
    return false;
  }
}

function _resetCache() { cache.reset(); }

module.exports = { KEY, VALUES, OFF, isOn, _resetCache };
