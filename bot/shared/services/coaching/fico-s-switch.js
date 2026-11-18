'use strict';
/**
 * bd-31ziu8 — the switch for FICO-S v1.1 in coach and principal visits (WhatsApp /observe, /observe2, the portal).
 *
 *   app_settings.fico_s_coach    'off' | 'on'     default OFF (no row, an unknown value, or a failed read)
 *
 * Same shape and lookup as obs612_coach and the FICO rubric switches (coaching/fico-rubric-switch.js): "user:<users.id>",
 * the role keys ("role:principal", "role:coach@ict"), the user's region, its organization ("ict"), then "*".
 *
 *   {"user:<uuid>": "on"}                        one account (the operator's and Rifat's test accounts first)
 *   {"role:coach@ict": "on", "role:principal@ict": "on"}   every ICT coach and principal (the rollout)
 *
 * ON for an observer, on an ICT visit (coaching/fde-region.js fdeAllowed: never a GB visit, fail closed): each visit
 * asks the lesson's class, and a grade 6-12 lesson is observed on FICO-S v1.1 (operator 18 Nov ~14:30: "For 1 to 5,
 * remains the same FICO v6. For 6 onwards all the way to 12, it is going to be FICO-S v1.1"). It wins over obs612_coach
 * (FDE's grade 6-8 tools) and over the FICO coach switch for grades 9-12; grades 1-5 are not touched. OFF: everything
 * behaves exactly as before. Flipping it needs no deploy (30 s cache). A visit already started keeps the rubric it
 * was stamped with: an FDE form opened before the switch stays an FDE form.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { cachedSwitch } = require('../settings/switch-cache');
const { asMap, pickFor, regionOfUser } = require('./fico-rubric-switch');

const KEY = 'fico_s_coach';
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
  log: (err) => logToFile('fico-s switch: settings lookup failed — treating as off', { error: err.message }, 'error'),
});

/**
 * Is FICO-S on for this observer? Never throws: false on any failure.
 * @param {{userId?: string, role?: string, region?: string|null, organization?: string}} who
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

/**
 * Does this VISIT get FICO-S for a grade 6-12 lesson? The observer's switch, and an ICT visit (never GB). Never
 * throws: false on any failure.
 * @param {object} user  the observer's users row (id, region, role)
 * @param {{teacherUserId?: string|null, schoolExtId?: string|null, schoolId?: string|null}} [visit]
 */
async function forVisit(user, visit = {}) {
  if (!user || !user.id) return false;
  try {
    const on = await isOn({ userId: user.id, region: user.region, role: user.role });
    if (!on) return false;
    return await require('./fde-region').fdeAllowed({ observer: user, ...(visit || {}) });
  } catch (_) {
    return false;
  }
}

function _resetCache() { cache.reset(); }

module.exports = { KEY, VALUES, OFF, isOn, forVisit, _resetCache };
