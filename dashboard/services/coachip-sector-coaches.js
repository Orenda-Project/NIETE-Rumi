'use strict';
/**
 * bd-sex15q.19: the sector's coaches, labelled. Lives on its own so the RM reads and the circle form in the listen reads
 * both use it without requiring each other (tests/setup/circular-deps.test.js).
 *
 * A coach's label is the coach's users.name when set (operator default B, SPEC §0.9: coaches are staff, not the
 * protected party) and otherwise the C-code: the coaches of the sector numbered C-01, C-02 … in the order of each
 * coach's first school by name (school-list order, never a rank, B9).
 */
const SCHOOL_JOIN = "(ls.school_id = s.id OR 'niete:' || s.emis = ls.school_ext_id)";

// ── the sector's coaches, labelled ─────────────────────────────────────────────────────────────────────────────────
/** → [{ coachUserId, label, schools: School[] (by name) }] in school-list order (first school's name, then id). */
async function sectorCoaches(q, rm) {
  if (!rm.coachUserIds.length || !rm.schoolIds.length) return [];
  const { rows } = await q(
    `SELECT DISTINCT ls.leader_user_id AS coach_user_id, s.id AS school_id, s.name AS school_name, u.name AS coach_name
       FROM leader_schools ls JOIN schools s ON ${SCHOOL_JOIN} JOIN users u ON u.id = ls.leader_user_id
      WHERE ls.leader_user_id = ANY($1::uuid[]) AND s.id = ANY($2::uuid[]) AND ls.name_match_quality IS DISTINCT FROM 'test'`,
    [rm.coachUserIds, rm.schoolIds],
  );
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.coach_user_id)) by.set(r.coach_user_id, { coachUserId: r.coach_user_id, name: r.coach_name, schools: [] });
    const c = by.get(r.coach_user_id);
    if (!c.schools.some((x) => x.school_id === r.school_id)) c.schools.push({ school_id: r.school_id, school_name: r.school_name });
  }
  const byName = (a, b) => (a.school_name < b.school_name ? -1 : a.school_name > b.school_name ? 1 : a.school_id < b.school_id ? -1 : 1);
  const list = [...by.values()];
  for (const c of list) c.schools.sort(byName);
  list.sort((a, b) => byName(a.schools[0], b.schools[0]) || (a.coachUserId < b.coachUserId ? -1 : 1));
  return list.map((c, i) => ({
    coachUserId: c.coachUserId,
    label: c.name && String(c.name).trim() ? String(c.name).trim() : `C-${String(i + 1).padStart(2, '0')}`,
    schools: c.schools,
  }));
}

module.exports = { sectorCoaches };
