'use strict';

/**
 * The region a child-test draw row is stamped with (child_test_draws.region): the programme of the SCHOOL the child is
 * drawn at, so one programme's results are never counted as another's. The school's own region (schools.region, read
 * through the store) is named by the region registry (region_features: the organization that owns each region):
 *
 *   an ICT sector (organization niete)     'ict', the value every draw carried before, so no ICT row changes
 *   another programme's region             its registry key (Gilgit-Baltistan: 'gilgit-baltistan')
 *   no school row, a blank region, a region the registry does not list, or a read that fails   'ict'
 *
 * Never throws: a child is never refused for the label on their row. A failed read is logged at 'warn' (it falls back
 * to 'ict', so it must not be silent). Ids only in the logs.
 */

const store = require('../store');
const Registry = require('../../region-registry');
const { logToFile } = require('../../../utils/logger');

const ICT = 'ict';
const ICT_ORGANIZATION = 'niete';
// Gilgit-Baltistan's registry key (region_features.region, organization moawin)
const GB = 'gilgit-baltistan';

/**
 * A region value (schools.region, users.region) → its programme as the registry names it: 'ict' for an ICT sector,
 * the registry key otherwise ('gilgit-baltistan'), 'ict' for a blank or unlisted value. Throws when the registry
 * cannot be read (the callers below turn that into 'ict' and a warn).
 */
async function programmeOf(value) {
  const key = Registry.regionKey(value);
  if (!key) return ICT;
  // eslint-disable-next-line global-require
  const rows = await Registry.listRegions(require('../../../config/supabase'));
  const row = rows.find((r) => Registry.regionKey(r.region) === key || Registry.regionKey(r.display_name) === key);
  if (!row || row.organization === ICT_ORGANIZATION) return ICT;
  return Registry.regionKey(row.region) || ICT;
}

/**
 * @param {string} schoolId
 * @returns {Promise<string>} the value for child_test_draws.region
 */
async function regionForSchool(schoolId) {
  if (!schoolId) return ICT;
  try {
    const got = await store.getSchoolsByIds([schoolId]);
    if (!got || !got.ok) throw new Error((got && got.error) || 'school read failed');
    const school = (got.schools || []).find((s) => s && s.id === schoolId);
    return await programmeOf(school && school.region);
  } catch (err) {
    logToFile('[child-test] draw region unreadable; stamping ict', { schoolId, error: err && err.message }, 'warn');
    return ICT;
  }
}

/** A region value's programme (programmeOf), 'ict' when the registry cannot be read (logged at warn). Never throws. */
async function regionOfValue(value) {
  try {
    return await programmeOf(value);
  } catch (err) {
    logToFile('[child-test] region registry unreadable; reading ict', { error: err && err.message }, 'warn');
    return ICT;
  }
}

/** Is this a Gilgit-Baltistan school (regionForSchool, so an unreadable region is no)? Never throws. */
async function isGilgitBaltistan(schoolId) {
  return (await regionForSchool(schoolId)) === GB;
}

module.exports = { regionForSchool, regionOfValue, isGilgitBaltistan, ICT, GB };
