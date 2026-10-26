'use strict';
/**
 * bd-sex15q.13 — fictional rows for the COACHIP route tests (contracts/FIXTURES.md v2 rules: fake v4 UUIDs
 * 00000000-0000-4000-8000-KKNNNNNNNNNN, schools "Govt. Primary School Fictional-NN", no person's name, phone or place;
 * the only real literal is a sector name). Every helper takes the harness's query and returns the ids it wrote.
 */
const KIND = { school: '01', code: '02', session: '03', moment: '04', step: '05', note: '06', coach: '07', visit: '08', rm: '09', teacher: '0b', fact: '0c' };
/** fid('school', 3) → 00000000-0000-4000-8000-010000000003 */
const fid = (kind, n) => `00000000-0000-4000-8000-${KIND[kind]}${String(n).padStart(10, '0')}`;
const SECRET = 'coachip-test-secret-0123456789abcdef0123456789abcdef';   // fixture secret, never a real one

async function user(q, { id, role = 'teacher', schoolId = null, lang = 'en', isTest = false, deleted = false, name = null }) {
  await q(
    `INSERT INTO users (id, phone_number, name, role, school_id, preferred_language, is_test_user, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, `fixture-${id.slice(-6)}`, name, role, schoolId, lang, isTest, deleted ? new Date() : null],
  );
  return id;
}
async function school(q, { id, n, region = 'Urban-I', isTest = false, name = null, emis = null }) {
  await q('INSERT INTO schools (id, name, region, is_probable_test, emis) VALUES ($1, $2, $3, $4, $5)',
    [id, name || `Govt. Primary School Fictional-${String(n).padStart(2, '0')}`, region, isTest, emis]);
  return id;
}
async function holds(q, { coachId, schoolId = null, extId = null, quality = null, name = 'Fictional' }) {
  await q(`INSERT INTO leader_schools (leader_user_id, source, school_ext_id, school_name, name_match_quality, school_id)
           VALUES ($1, 'niete_ict', $2, $3, $4, $5)`, [coachId, extId || `niete:${(schoolId || 'x').slice(-4)}`, name, quality, schoolId]);
}
async function setting(q, key, value) {
  await q('INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]);
}

module.exports = { fid, KIND, SECRET, user, school, holds, setting };
