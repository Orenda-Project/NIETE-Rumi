/**
 * The signed-in user's own school name, for the portal's My account page.
 *
 * Order:
 *   1. users.school_id → schools.name — the link every school-scoped query in
 *      this service uses (the leader patch reads the school's name the same way);
 *   2. the legacy users.school_name text;
 *   3. null — the page shows nothing in its place.
 *
 * Never throws: the school is a nicety on a page, and the dashboard response
 * that carries it must not fail because of it.
 *
 * @param {{from: Function}} db  the dashboard's supabase client
 * @param {object|null} user     a users row
 * @returns {Promise<string|null>}
 */
async function resolveUserSchoolName(db, user) {
  const legacy = clean(user && user.school_name);
  if (!user || !user.school_id) return legacy;
  try {
    const { data, error } = await db
      .from('schools')
      .select('name')
      .eq('id', user.school_id)
      .maybeSingle();
    if (error) return legacy;
    return clean(data && data.name) || legacy;
  } catch (_err) {
    return legacy;
  }
}

function clean(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

module.exports = { resolveUserSchoolName };
