'use strict';
/**
 * bd-w0zbbe (queue #147) — a coach holding that names no school is not one of her schools in the coach app.
 *
 * Production, 16 Nov: 5 of 678 leader_schools rows carry no school_id and match no school by EMIS — the August test
 * fixtures 'test:9001' (Test School Alpha) and 'test:9002' (Test School Beta), held by three coaches. The bot already
 * drops them (patch-resolver: "a holding that cannot name its school is not a holding"), and a portal booking can
 * resolve no teacher there; but My schools, New visit and Home still showed both as schools with 0 teachers, so a
 * coach testing the portal on the Rumi QA test schools saw two empty schools she could do nothing with.
 *
 * Now the coach app's school list carries only holdings that name a school (school_id, or a school whose EMIS key is
 * the holding's key — a holding written before school_id existed). A no-EMIS school (GB, Rumi QA) has a school_id and
 * stays (bd-97daxo.22).
 */

const SVC = require('../../dashboard/services/coach-v2.service');

const ME = 'coach-1';
const HOLDINGS = [
  { school_ext_id: 'niete:285', school_name: 'IMS (I-V) AIOU Colony', emis: '285', names_a_school: true },
  { school_ext_id: 'niete:gb-test-middle-rumi-qa', school_name: 'GB Test Middle (Rumi QA)', emis: null, names_a_school: true },
  { school_ext_id: 'test:9001', school_name: 'Test School Alpha', emis: '9001', names_a_school: false },
  { school_ext_id: 'test:9002', school_name: 'Test School Beta', emis: '9002', names_a_school: false },
];
const PATCH = [
  { teacher_ext_id: '920000000001', name: 'Teacher One', phone: '920000000001', school_ext_id: 'niete:285', role: 'teacher',
    rumi_user_id: 'u-1', coaching_sessions: 0, observations: 0, training_modules: 0, last_analysis_data: null, school_name: 'IMS (I-V) AIOU Colony' },
];
const query = async (sql) => {
  if (/FROM leader_schools lsch/.test(sql)) return { rows: PATCH };
  if (/FROM leader_schools/.test(sql)) return { rows: HOLDINGS };
  return { rows: [] };
};

describe('the coach app lists only holdings that name a school', () => {
  test('the holdings query says, per holding, whether it names a school', () => {
    expect(SVC.SQL.LEADER_SCHOOLS).toMatch(/school_id IS NOT NULL/);
    expect(SVC.SQL.LEADER_SCHOOLS).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM schools/);
    expect(SVC.SQL.LEADER_SCHOOLS).toMatch(/AS names_a_school/);
  });

  test('My schools / New visit: Test School Alpha and Beta are gone; the EMIS and no-EMIS schools stay', async () => {
    const out = await SVC.getCoachPeople(query, ME, { today: '2026-11-16' });
    expect(out.schools.map((s) => s.schoolExtId)).toEqual(['niete:285', 'niete:gb-test-middle-rumi-qa']);
  });

  test('Home counts 2 schools, not 4', async () => {
    const out = await SVC.getCoachHome(query, ME, { today: '2026-11-16' });
    expect(out.counts.schools).toBe(2);
  });

  test('a holdings row without the flag (an older reader) is kept, never dropped', async () => {
    const plain = async (sql) => (/FROM leader_schools lsch/.test(sql) ? { rows: PATCH }
      : /FROM leader_schools/.test(sql) ? { rows: [{ school_ext_id: 'niete:285', school_name: 'IMS', emis: '285' }] } : { rows: [] });
    const out = await SVC.getCoachPeople(plain, ME, { today: '2026-11-16' });
    expect(out.schools).toHaveLength(1);
  });
});
