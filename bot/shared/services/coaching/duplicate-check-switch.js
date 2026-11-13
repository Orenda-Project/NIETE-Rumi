'use strict';
/**
 * bd-r98hph — test accounts skip the "already analysed" recording check.
 *
 * A coach observation recording is analysed once (HITL row 185): the same bytes sent again are refused, for the
 * classroom recording (transcription-processor → audio-hash-cache findPriorLeaderObservation) and for the debrief
 * (observe-debrief _refuseIfAlreadyAnalysed). /observe, /observe2 and the coach portal upload all go through those
 * two checks. That rule is right for coaches; it stops a tester, who sends the same lesson again to try a new rubric.
 *
 *   app_settings.skip_recording_duplicate_check    'off' | 'on'    default OFF (no row, unknown value, failed read)
 *
 * The value has the shape of obs612_coach / fico_coach_rubric and is looked up the same way ("user:<users.id>",
 * the user's region, its organization, then "*"):
 *
 *   {"user:<uuid>": "on", "user:<uuid>": "on"}    the named test accounts only (the intended use)
 *
 * ON for a coach: both checks are skipped and the recording is analysed again. The hash is still stamped, so
 * nothing about the data changes; only the refusal does. Keyed on the COACH (observer), never the teacher.
 * Flipping it needs no deploy (30 s cache). Undo: delete the row, or set the account to "off".
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { cachedSwitch } = require('../settings/switch-cache');
const { asMap, pickFor, regionOfUser } = require('./fico-rubric-switch');

const KEY = 'skip_recording_duplicate_check';
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
  log: (err) => logToFile('duplicate-check switch: settings lookup failed — keeping the check', { error: err.message }, 'error'),
});

/**
 * Does this account skip the recording duplicate check? Never throws: false (keep the check) on any failure.
 * @param {string} userId  the coach (observer_user_id)
 */
async function skipsCheck(userId, now = Date.now()) {
  if (!userId) return false;
  try {
    const map = await cache.get(now);
    if (!Object.keys(map).length) return false; // default: everyone is checked, no region lookup
    const region = await regionOfUser(userId);
    return (await pickFor(map, { userId, region }, VALUES, OFF)) === 'on';
  } catch (_) {
    return false;
  }
}

function _resetCache() { cache.reset(); }

module.exports = { KEY, VALUES, OFF, skipsCheck, _resetCache };
