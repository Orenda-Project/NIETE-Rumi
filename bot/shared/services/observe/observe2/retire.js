'use strict';
/**
 * Retiring /observe2 (operator, 12 Nov 2026: "let the users know perhaps that observe2 experiment has ended, opening
 * regular observe").
 *
 *   app_settings.observe2_retired    'off' | 'on'     default OFF (no row, an unknown value, or a failed read)
 *
 * The value has the shape of the other coach switches (coaching/fico-rubric-switch.js, coaching/obs612-switch.js) and
 * is looked up the same way: "user:<users.id>", the user's region, its organization ("ict"), then "*".
 *
 *   "on"                                   every coach
 *   {"user:<uuid>": "on"}                  one account only (a test account first)
 *   {"*": "on", "user:<uuid>": "off"}      everyone, except an account kept on /observe2 (a tester)
 *
 * ON for a user:
 *   - /observe2 (and every variant the slash-command canonicaliser maps to it) sends one line saying the trial has
 *     ended, to a school leader only, and the text handler then runs the /observe door itself with "/observe", so
 *     they get exactly what /observe opens for them;
 *   - a recording that comes with no form waiting is no longer held as a NEW /observe2 visit (observe2/hold.js).
 * A visit already started is untouched: its planner Start, period list, live form, seal, recording and check all
 * route by their own token or button id, never by the command, and /observe's worklist lists and resumes it.
 * OFF: /observe2 exactly as before. Flipping it needs no deploy (30 s cache).
 */

const supabase = require('../../../config/supabase');
const WhatsAppService = require('../../whatsapp.service');
const { logToFile } = require('../../../utils/logger');
const { cachedSwitch } = require('../../settings/switch-cache');
const { asMap, pickFor, regionOfUser } = require('../../coaching/fico-rubric-switch');
const { isSchoolLeader } = require('../observe-gate');
const { observeLang } = require('../observe-strings');
const { observe2Strings } = require('./strings');

const KEY = 'observe2_retired';
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
  log: (err) => logToFile('observe2 retire switch: settings lookup failed — /observe2 stays open', { error: err.message }, 'error'),
});

/**
 * Is /observe2 retired for this user? Never throws: false on any failure.
 * @param {{userId?: string, region?: string|null, organization?: string}} who  region omitted → read from users
 */
async function isRetired(who = {}, now = Date.now()) {
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
 * For the text handler's /observe2 door. Retired for this user → the notice (school leaders only: a teacher never had
 * /observe2 and gets only what /observe answers them) and true, so the caller runs /observe. Not retired → false and
 * nothing sent: /observe2 as before. A notice that fails to send is logged and still returns true; /observe opens.
 * @returns {Promise<boolean>}
 */
async function announceIfRetired(user, from) {
  const who = user && user.id ? { userId: user.id, ...(user.region !== undefined ? { region: user.region } : {}) } : {};
  if (!(await isRetired(who))) return false;
  logToFile('🔭 /observe2 retired: opening /observe', { tk: ref(user && user.id) });
  if (!user || !isSchoolLeader(user)) return true;
  try {
    await WhatsAppService.sendMessage(from, observe2Strings(observeLang(user)).retired_notice);
  } catch (err) {
    logToFile('❌ /observe2 retired: the notice did not send (opening /observe anyway)', { tk: ref(user.id), error: err.message }, 'error');
  }
  return true;
}

// A log line carries the user's pseudonymous key, never the raw id (tests/setup/log-raw-ids.test.js). No key → null.
function ref(userId) {
  try { return require('../../quiz/web-quiz-kid').tk(userId); } catch (_) { return null; }
}

function _resetCache() { cache.reset(); }

module.exports = { KEY, VALUES, OFF, isRetired, announceIfRetired, _resetCache };
