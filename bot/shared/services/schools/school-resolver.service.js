/**
 * Read a user's school through the `users.school_id` → `schools` FK.
 *
 * Before this, school was free text on `users.school_name`: 4,603 rows holding
 * 522 distinct spellings of 465 real schools ('IMSG(VI-X) G7/2' vs
 * 'IMSG (VI-X) G-7/2'). `schools` is now populated from fde_production (465 rows,
 * EMIS-keyed) and 8,797 users are linked, so the FK is the source of truth.
 *
 * The legacy text column is still read as a FALLBACK and is NOT dropped yet —
 * dashboard access-scoping filters on `school_name_lower` inside the mv_* views,
 * and registration still writes free text. That removal is tracked separately.
 *
 * Nothing here is on a critical path: a failed school lookup returns null rather
 * than throwing, because no teacher-facing reply should fail over a display name.
 */

'use strict';

const supabase = require('../../config/supabase');

const SCHOOL_COLUMNS = 'id, name, region, emis, is_probable_test';

/**
 * @param {string} userId users.id (uuid)
 * @returns {Promise<?{id:?string, name:string, region:?string, emis:?string,
 *                     is_probable_test:boolean, source:'fk'|'legacy_text'}>}
 */
async function resolveUserSchool(userId) {
  if (!userId) return null;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, school_id, school_name')
      .eq('id', userId)
      .maybeSingle();

    if (error || !user) return null;

    if (user.school_id) {
      const { data: school } = await supabase
        .from('schools')
        .select(SCHOOL_COLUMNS)
        .eq('id', user.school_id)
        .maybeSingle();

      if (school) {
        return {
          id: school.id,
          name: school.name,
          region: school.region || null,
          emis: school.emis || null,
          is_probable_test: Boolean(school.is_probable_test),
          source: 'fk',
        };
      }
    }

    // Legacy path: the 484 linked-nowhere users who still have free text.
    const legacy = (user.school_name || '').trim();
    if (!legacy) return null;

    return {
      id: null,
      name: legacy,
      region: null,
      emis: null,
      is_probable_test: false,
      source: 'legacy_text',
    };
  } catch (_err) {
    return null;
  }
}

/**
 * Look up a school by its government EMIS id — the stable identifier across
 * both databases (460 of 465 schools have one, verified unique).
 */
async function findSchoolByEmis(emis) {
  const key = emis === null || emis === undefined ? '' : String(emis).trim();
  if (!key) return null;

  try {
    const { data, error } = await supabase
      .from('schools')
      .select(SCHOOL_COLUMNS)
      .eq('emis', key)
      .maybeSingle();

    return error ? null : data || null;
  } catch (_err) {
    return null;
  }
}

module.exports = { resolveUserSchool, findSchoolByEmis, SCHOOL_COLUMNS };
