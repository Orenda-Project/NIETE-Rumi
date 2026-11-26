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
 *
 * Queue #184 — app_settings.fico_s_dc  'off' | 'on'   default OFF, same keys and lookup. ON (and fico_s_coach on) for an
 * observer: a FICO 6-12 visit that has a recording goes to the Digital Coach as a FICO17 v6 HITL visit does (operator
 * 19 Nov: "all HITL go to DC"): the recording, the photos and the plan are analysed with the FICO 6-12 prompt
 * (frameworks/fico-s-framework.js), the form comes pre-filled for the observer to check, starred indicators (E3) are the
 * observer's alone, and the debrief follows v6's. Decided once per visit, at its start (obs612/fico-s-dc.js REASON).
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { cachedSwitch } = require('../settings/switch-cache');
const { asMap, pickFor, regionOfUser } = require('./fico-rubric-switch');

const KEY = 'fico_s_coach';
const DC_KEY = 'fico_s_dc';
const VALUES = ['off', 'on'];
const OFF = 'off';
const TTL_MS = 30 * 1000;

function switchCache(key) {
  return cachedSwitch({
    ttlMs: TTL_MS,
    off: () => ({}),
    read: async () => {
      const { data, error } = await supabase.from('app_settings').select('key,value').eq('key', key);
      if (error) throw new Error(error.message || 'app_settings read failed');
      const row = (data || [])[0];
      return asMap(row ? row.value : undefined);
    },
    log: (err) => logToFile(`fico-s switch: ${key} lookup failed — treating as off`, { error: err.message }, 'error'),
  });
}
const cache = switchCache(KEY);
const dcCache = switchCache(DC_KEY);

async function onIn(c, who, now) {
  try {
    const map = await c.get(now);
    if (!Object.keys(map).length) return false; // default off: no region lookup
    const w = { ...who };
    if (w.region === undefined) w.region = await regionOfUser(w.userId);
    return (await pickFor(map, w, VALUES, OFF)) === 'on';
  } catch (_) {
    return false;
  }
}

/**
 * Is FICO-S on for this observer? Never throws: false on any failure.
 * @param {{userId?: string, role?: string, region?: string|null, organization?: string}} who
 */
async function isOn(who = {}, now = Date.now()) { return onIn(cache, who, now); }

/** Queue #184: is the Digital Coach on for this observer's FICO 6-12 visits (fico_s_dc)? Never throws. */
async function isDcOn(who = {}, now = Date.now()) { return onIn(dcCache, who, now); }

/**
 * Does this VISIT get FICO-S for a grade 6-12 lesson? bd-dsu5mq.2 (operator 26 Nov ~21:40): the VISIT'S SCHOOL decides
 * ICT vs GB, never the observer's profile users.region. The switch is looked up for who the observer is (users.id, role)
 * at where the visit is (coaching/fde-region.js visitPlace / switchWho): a GB visit, or one whose place cannot be read,
 * never gets FICO-S. Never throws: false on any failure.
 * @param {object} user  the observer's users row (id, role)
 * @param {{teacherUserId?: string|null, schoolExtId?: string|null, schoolId?: string|null}} [visit]
 */
async function forVisit(user, visit = {}) {
  if (!user || !user.id) return false;
  try {
    const FR = require('./fde-region');
    const place = await FR.visitPlace({ observer: user, ...(visit || {}) });
    if (place.side === 'gb' || place.side === 'error') return false;
    return await isOn(FR.switchWho(user, place));
  } catch (_) {
    return false;
  }
}

/**
 * Queue #184: does this FICO 6-12 VISIT go to the Digital Coach? fico_s_dc and fico_s_coach, both looked up at the
 * visit's place (bd-dsu5mq.2), never a GB visit. Never throws: false on any failure.
 */
async function dcForVisit(user, visit = {}) {
  if (!user || !user.id) return false;
  try {
    const FR = require('./fde-region');
    const place = await FR.visitPlace({ observer: user, ...(visit || {}) });
    if (place.side === 'gb' || place.side === 'error') return false;
    const who = FR.switchWho(user, place);
    return (await isDcOn(who)) && (await isOn(who));
  } catch (_) {
    return false;
  }
}

function _resetCache() { cache.reset(); dcCache.reset(); }

module.exports = { KEY, DC_KEY, VALUES, OFF, isOn, isDcOn, forVisit, dcForVisit, _resetCache };
