'use strict';
/**
 * bd-97daxo.30 — the days of the week a region's schools teach, for the visit Flow's date pickers.
 *
 * Gilgit-Baltistan schools teach Monday to Saturday (Ali Ahmed, GB, 12 Nov: "GB school days are Mon - Sat"); every
 * other region this deployment serves teaches Monday to Friday. The values are Meta's CalendarPicker include-days
 * names. A region key is users.region / schools.region lowercased, with '_' read as '-' (one self-registered
 * principal on prod is 'gilgit_baltistan').
 *
 * Which region: the visit's SCHOOL (the coach's holding → schools.region), else the coach's own users.region. Any
 * failed or empty read is Monday to Friday, what every coach had before this change: never a refusal.
 */

// Read per call: the visit-Flow handler requires this module, and its suites stub services, not the DB client
// (shared/config/supabase exits the process when it loads without credentials).
const db = () => require('../../config/supabase');
const { regionKey } = require('../region-registry');
const { logToFile } = require('../../utils/logger');

const MON_FRI = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
const MON_SAT = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

/** Regions whose week is not Monday to Friday, keyed as normalise() spells them. */
const SCHOOL_WEEK = Object.freeze({
  'gilgit-baltistan': MON_SAT,
});

const normalise = (region) => regionKey(region).replace(/_/g, '-');

/** The school week of a region value, as a fresh array (a caller may not change the shared one). */
function schoolWeekForRegion(region) {
  return [...(SCHOOL_WEEK[normalise(region)] || MON_FRI)];
}

async function _schoolRegion(leaderUserId, schoolExtId) {
  if (!schoolExtId) return null;
  const { data: holdings, error } = await db()
    .from('leader_schools').select('school_id').eq('leader_user_id', leaderUserId).eq('school_ext_id', schoolExtId);
  if (error) throw new Error(error.message);
  const schoolId = ((holdings || []).find((h) => h && h.school_id) || {}).school_id;
  if (!schoolId) return null;
  const { data: school, error: e2 } = await db().from('schools').select('region').eq('id', schoolId).maybeSingle();
  if (e2) throw new Error(e2.message);
  return (school && school.region) || null;
}

async function _coachRegion(leaderUserId) {
  const { data, error } = await db().from('users').select('region').eq('id', leaderUserId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data && data.region) || null;
}

/** The school week for a visit by this coach at this school (her holding's school_ext_id). Never throws. */
async function schoolWeekFor(leaderUserId, schoolExtId) {
  try {
    const region = (await _schoolRegion(leaderUserId, schoolExtId)) || (await _coachRegion(leaderUserId));
    return schoolWeekForRegion(region);
  } catch (err) {
    logToFile('school-week: region read failed, Monday to Friday', { leaderUserId, schoolExtId, error: err.message });
    return schoolWeekForRegion(null);
  }
}

module.exports = { schoolWeekForRegion, schoolWeekFor, MON_FRI, MON_SAT };
