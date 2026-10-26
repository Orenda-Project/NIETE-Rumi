'use strict';
/**
 * bd-sex15q.13 — the COACHIP scope service (SPEC v2 §1, API.md §4), against a real Postgres with the repo's own
 * users / schools / leader_schools tables and the insights schema. Fictional rows only.
 *
 *   coachScope   the coach's real schools (leader_schools by school_id or by 'niete:'||emis; not name_match_quality
 *                'test'; region one of the six; not is_probable_test; name not 'NIETE%') and their live, non-test teachers
 *   rmScope      the sector's real schools, the live non-test coaches holding them, the RDF roster's coaches, teachers,
 *                schools no coach holds
 *   inScope      the session's teacher's CURRENT school (E7) is one of the coach's
 *   circleAllows the moment is in this sector's circle for the current Karachi week
 */
const { startPg, hasPostgres } = require('./helpers/pg-harness');
const seed = require('./helpers/seed');
const { createCoachipCodes } = require('../../dashboard/services/coachip-codes.service');
const { createCoachipScope } = require('../../dashboard/services/coachip-scope.service');

const run = hasPostgres() ? describe : describe.skip;
const { fid } = seed;
const CA = fid('coach', 1);
const CB = fid('coach', 2);
const CT = fid('coach', 3);           // a test account coach
const RM = fid('rm', 1);
const NOW = new Date('2026-10-26T06:00:00Z');   // Monday 26 Oct 2026, 11:00 PKT

run('coachip scope service (Postgres)', () => {
  let pg; let codes; let scope;
  beforeAll(async () => { pg = await startPg(); }, 180000);
  afterAll(async () => { if (pg) await pg.close(); });

  async function world() {
    const q = pg.query;
    for (const [id, n] of [[CA, 1], [CB, 2], [RM, 3]]) await seed.user(q, { id, role: 'coach' }); // RMs are coach-role users
    await seed.user(q, { id: CT, role: 'coach', isTest: true });
    // Urban-I: S1, S2 held by A (S2 by its niete: ext id only), S3 held by B, S4 held by nobody,
    // S5 a probable-test school held by A, S6 a 'NIETE…' school held by A, S7 held by A with name_match_quality 'test'.
    // Tarnol: S8 held by A (A spans two sectors; the RM of Urban-I must not see it).
    await seed.school(q, { id: fid('school', 1), n: 1 });
    await seed.school(q, { id: fid('school', 2), n: 2, emis: '9002' });
    await seed.school(q, { id: fid('school', 3), n: 3 });
    await seed.school(q, { id: fid('school', 4), n: 4 });
    await seed.school(q, { id: fid('school', 5), n: 5, isTest: true });
    await seed.school(q, { id: fid('school', 6), n: 6, name: 'NIETE Fictional Lab School' });
    await seed.school(q, { id: fid('school', 7), n: 7 });
    await seed.school(q, { id: fid('school', 8), n: 8, region: 'Tarnol' });
    await seed.school(q, { id: fid('school', 9), n: 9, region: 'Lahore' });
    await seed.holds(q, { coachId: CA, schoolId: fid('school', 1) });
    await seed.holds(q, { coachId: CA, extId: 'niete:9002' });
    await seed.holds(q, { coachId: CB, schoolId: fid('school', 3) });
    await seed.holds(q, { coachId: CA, schoolId: fid('school', 5) });
    await seed.holds(q, { coachId: CA, schoolId: fid('school', 6) });
    await seed.holds(q, { coachId: CA, schoolId: fid('school', 7), quality: 'test' });
    await seed.holds(q, { coachId: CA, schoolId: fid('school', 8) });
    await seed.holds(q, { coachId: CA, schoolId: fid('school', 9) });
    await seed.holds(q, { coachId: CT, schoolId: fid('school', 4) });  // a test coach holding S4 does not make S4 held
    // teachers: S1 three live (one test, one deleted, one principal besides), S2 one, S3 two, S8 one, S5 one
    let t = 0;
    const teacher = async (schoolN, extra = {}) => { t += 1; await seed.user(q, { id: fid('teacher', t), schoolId: fid('school', schoolN), ...extra }); return fid('teacher', t); };
    await teacher(1); await teacher(1); await teacher(1);
    await teacher(1, { isTest: true }); await teacher(1, { deleted: true }); await teacher(1, { role: 'principal' });
    await teacher(2);
    await teacher(3); await teacher(3);
    await teacher(8);
    await teacher(5);
    await seed.setting(q, 'analytics_rdf_coaches', { coaches: [
      { name: 'Fictional Coach A', sector: 'Urban-I', userIds: [CA] },
      { name: 'Fictional Coach B', sector: 'Urban-I', userIds: [CB] },
      { name: 'Fictional Coach X', sector: 'Urban-I', userIds: [fid('coach', 9)] },
      { name: 'Fictional Coach T', sector: 'Tarnol', userIds: [fid('coach', 8)] },
    ] });
  }

  beforeEach(async () => {
    await pg.truncate();
    await world();
    codes = createCoachipCodes({ query: pg.query, secret: seed.SECRET });
    scope = createCoachipScope({ query: pg.query, codes, now: () => NOW });
  });

  test('coachScope: real schools only, by school_id or niete:emis; live non-test teachers', async () => {
    const a = await scope.coachScope(CA);
    expect(a.schoolIds.sort()).toEqual([fid('school', 1), fid('school', 2), fid('school', 8)].sort());
    expect(a.schoolCount).toBe(3);
    expect(a.teacherCount).toBe(5);                                  // S1 three + S2 one + S8 one
    expect(a.teacherKeys).toHaveLength(5);
    expect(a.teacherKeys.every((k) => /^[0-9a-f]{16}$/.test(k))).toBe(true);
    expect(a.teacherKeys).toContain(codes.teacherKey(fid('teacher', 1)));
    expect(a.teacherSchool.get(codes.teacherKey(fid('teacher', 7)))).toBe(fid('school', 2));
  });

  test('coach A never sees coach B\'s school; a coach with no real school has no scope', async () => {
    const a = await scope.coachScope(CA);
    const b = await scope.coachScope(CB);
    expect(a.schoolIds).not.toContain(fid('school', 3));
    expect(b.schoolIds).toEqual([fid('school', 3)]);
    expect(b.teacherCount).toBe(2);
    await seed.user(pg.query, { id: fid('coach', 4), role: 'coach' });
    await seed.holds(pg.query, { coachId: fid('coach', 4), schoolId: fid('school', 5) });   // only a test school
    expect(await scope.coachScope(fid('coach', 4))).toBeNull();
    expect(await scope.coachScope(fid('coach', 5))).toBeNull();                          // holds nothing
  });

  test('the scope carries no users.id of a teacher', async () => {
    const a = await scope.coachScope(CA);
    const json = JSON.stringify({ ...a, teacherSchool: [...a.teacherSchool] });
    for (let i = 1; i <= 11; i += 1) expect(json).not.toContain(fid('teacher', i));
  });

  test('rmScope: the sector\'s real schools, its live coaches, the roster, teachers, unassigned schools', async () => {
    const r = await scope.rmScope(RM, 'Urban-I');
    expect(r.sector).toBe('Urban-I');
    expect(r.schoolIds.sort()).toEqual([1, 2, 3, 4, 7].map((n) => fid('school', n)).sort());   // S7's test LINK does not make the school test
    expect(r.coachUserIds.sort()).toEqual([CA, CB].sort());          // the test coach is not a coach here
    expect(r.rosterCoachUserIds.sort()).toEqual([CA, CB, fid('coach', 9)].sort());
    expect(r.teacherCount).toBe(6);                                   // S1 3, S2 1, S3 2
    expect(r.unassignedSchoolCount).toBe(2);                          // S4 (only a test coach) and S7 (only a 'test' link)
    expect(await scope.rmScope(RM, 'Lahore')).toBeNull();
    expect(await scope.rmScope(RM, null)).toBeNull();
  });

  test('inScope: the session teacher\'s CURRENT school (E7)', async () => {
    const a = await scope.coachScope(CA);
    const s1 = fid('session', 1);
    await pg.query('INSERT INTO coaching_sessions (id, user_id) VALUES ($1, $2)', [s1, fid('teacher', 1)]);
    expect(await scope.inScope(a, s1)).toBe(true);
    await pg.query('UPDATE users SET school_id = $1 WHERE id = $2', [fid('school', 3), fid('teacher', 1)]);   // moved to B's school
    expect(await scope.inScope(a, s1)).toBe(false);
    expect(await scope.inScope(await scope.coachScope(CB), s1)).toBe(true);
    expect(await scope.inScope(a, fid('session', 99))).toBe(false);
    expect(await scope.inScope(null, s1)).toBe(false);
  });

  test('circleAllows: only this sector\'s circle for the current Karachi week', async () => {
    const r = await scope.rmScope(RM, 'Urban-I');
    const q = pg.query;
    const sess = fid('session', 2);
    await q('INSERT INTO coaching_sessions (id, user_id) VALUES ($1, $2)', [sess, fid('teacher', 1)]);
    const { moment, jobRunId } = await seedMoment(q, sess);
    await q(`INSERT INTO coachip_circle_items (sector, week_start, coach_user_id, moment_id, job_run_id) VALUES ('Urban-I', '2026-10-26', $1, $2, $3)`, [CA, moment, jobRunId]);
    expect(await scope.circleAllows(r, moment)).toBe(true);
    expect(await scope.circleAllows({ ...r, sector: 'Tarnol' }, moment)).toBe(false);
    await q("UPDATE coachip_circle_items SET week_start = '2026-10-19'");
    expect(await scope.circleAllows(r, moment)).toBe(false);          // last week's circle is closed
    expect(await scope.circleAllows(null, moment)).toBe(false);
  });

  /** The minimum rows coachip_moments needs (its FKs): a weakness, a job run, a fact, then the moment. */
  async function seedMoment(q, sessionId) {
    await q(`INSERT INTO coachip_weaknesses (w_id, primary_source, pedagogical_weight, is_s1_eligible, is_s7, is_cause_line, short_name_en, short_name_ur, library_version)
             VALUES ('W-IP', 'lp_fidelity', 0.9, true, false, false, 'No independent practice', 'خود مشق نہیں ہوئی', '1.0') ON CONFLICT (w_id) DO NOTHING`);
    const jr = await q(`INSERT INTO coachip_job_runs (run_date, pipeline_version, env_ref, started_at, status)
                        VALUES ('2026-10-26', 'coachip-1.0.0', 'olvritwoqujtjvwfulbh', now(), 'ok') RETURNING id`);
    const jobRunId = jr.rows[0].id;
    const fact = await q(`INSERT INTO coachip_session_facts (session_id, teacher_key, school_id, sector, recorded_at, is_observed, job_run_id,
                            grader_model, framework_version, pipeline_version, input_hash, status, is_mismatch, is_unusable, is_duplicate,
                            is_lp_linked, computed_at)
                          VALUES ($1, $2, $3, 'Urban-I', '2026-10-20T05:00:00Z', false, $4, 'google/gemini-3.8-flash', 'lp_fidelity',
                            'coachip-1.0.0', $5, 'ok', false, false, false, true, now()) RETURNING id`,
    [sessionId, codes.teacherKey(fid('teacher', 1)), fid('school', 1), jobRunId, 'a'.repeat(64)]);
    const m = await q(`INSERT INTO coachip_moments (fact_id, session_id, w_id, kind, from_s, to_s, confidence, gloss_status)
                       VALUES ($1, $2, 'W-IP', 'missing', 1100, 1130, 'high', 'pending') RETURNING id`, [fact.rows[0].id, sessionId]);
    return { moment: m.rows[0].id, jobRunId };
  }
});
