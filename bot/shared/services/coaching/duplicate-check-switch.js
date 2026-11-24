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
 *
 * bd-ce6xwt — every TEST ACCOUNT (users.is_test_user = true) skips both checks too, with no row (the operator,
 * 24 Nov 2026: test accounts are allowed duplicate recordings). The switch stays for an account not marked test.
 * "off" under a test account's OWN id ("user:<uuid>": "off") keeps the check for it, so the refusal itself can still
 * be tried; "off" for a region, organization or "*" does not. A failed users read keeps the check.
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

/** bd-ce6xwt — is users.is_test_user true for this id? False on no row or a failed read (the check stays). */
async function isTestUser(userId) {
  try {
    const { data, error } = await supabase.from('users').select('is_test_user').eq('id', userId).maybeSingle();
    if (error) return false;
    return Boolean(data && data.is_test_user === true);
  } catch (_) {
    return false;
  }
}

/**
 * Does this account skip the recording duplicate check? Never throws: false (keep the check) on any failure.
 * @param {string} userId  the coach (observer_user_id)
 */
async function skipsCheck(userId, now = Date.now()) {
  if (!userId) return false;
  try {
    const map = await cache.get(now);
    // bd-ce6xwt: "off" under this account's own id keeps the check, even for a test account.
    if (map[`user:${String(userId).trim().toLowerCase()}`] === OFF) return false;
    if (await isTestUser(userId)) return true;
    if (!Object.keys(map).length) return false; // default: everyone is checked, no region lookup
    const region = await regionOfUser(userId);
    return (await pickFor(map, { userId, region }, VALUES, OFF)) === 'on';
  } catch (_) {
    return false;
  }
}

function _resetCache() { cache.reset(); }

module.exports = { KEY, VALUES, OFF, skipsCheck, _resetCache };
