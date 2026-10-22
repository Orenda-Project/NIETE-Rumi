/**
 * Child test — the day key with a grade (switch sa_all_grades): one list per coach per school per GRADE per day,
 *   day:<coachUserId>:<schoolId>:<YYYY-MM-DD>:g<N>   N = 1..5
 * A key without `:g<N>` is today's key and parses exactly as before (no grade field).
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../L3/helpers/fake-supabase');
const { buildRoster } = require('../L3/helpers/roster');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const draw = require('../../../bot/shared/services/child-test/draw');
const { visitKeyFor, parseVisitKey, isVisitKey } = require('../../../bot/shared/services/child-test/draw/visit-key');

const NOW = new Date('2026-10-05T06:00:00Z'); // 11:00 PKT, 5 Oct
const COACH = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '22222222-2222-4222-8222-222222222222';
const DAY_KEY = `day:${COACH}:${SCHOOL}:2026-10-05`;

beforeEach(() => { process.env.CHILD_TEST_DRAW_SECRET = 'test-secret'; });

describe('the day key with a grade', () => {
  test('visitKeyFor with a grade 1–5 appends :g<N>; without one it is today\'s key', () => {
    expect(visitKeyFor({ coachUserId: COACH, schoolId: SCHOOL, now: NOW, grade: 1 })).toBe(`${DAY_KEY}:g1`);
    expect(visitKeyFor({ coachUserId: COACH, schoolId: SCHOOL, now: NOW, grade: 4 })).toBe(`${DAY_KEY}:g4`);
    expect(visitKeyFor({ coachUserId: COACH, schoolId: SCHOOL, now: NOW })).toBe(DAY_KEY);
    expect(visitKeyFor({ coachUserId: COACH, schoolId: SCHOOL, now: NOW, grade: 6 })).toBeNull();
  });

  test('parseVisitKey reads the grade back; the old key parses as before', () => {
    expect(parseVisitKey(`${DAY_KEY}:g2`)).toEqual({ kind: 'day', coachUserId: COACH, schoolId: SCHOOL, date: '2026-10-05', grade: 2 });
    expect(parseVisitKey(DAY_KEY)).toEqual({ kind: 'day', coachUserId: COACH, schoolId: SCHOOL, date: '2026-10-05' });
    expect(isVisitKey(`${DAY_KEY}:g6`)).toBe(false);
    expect(isVisitKey(`${DAY_KEY}:g`)).toBe(false);
  });

  test('two grades on one day are two lists; the key\'s grade is the grade drawn', async () => {
    mockFake = createFakeSupabase(
      buildRoster({ schoolId: SCHOOL, coachId: COACH, classes: [{ id: 'g1a', grade: 1, section: 'A', size: 20 }, { id: 'g4a', grade: 4, section: 'A', size: 20 }] }),
      { unique: CHILD_TEST_UNIQUE },
    );
    const g1 = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitKey: `${DAY_KEY}:g1`, allGrades: true, grade: 1, now: NOW });
    const g4 = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitKey: `${DAY_KEY}:g4`, allGrades: true, grade: 4, now: NOW });
    expect([g1.ok, g1.grade, g4.ok, g4.grade]).toEqual([true, 1, true, 4]);
    const again = await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitKey: `${DAY_KEY}:g1`, allGrades: true, grade: 1, now: NOW });
    expect(again.reused).toBe(true);
    expect(again.children.map((k) => k.drawId)).toEqual(g1.children.map((k) => k.drawId));
  });

  test('a key naming one grade does not draw another', async () => {
    mockFake = createFakeSupabase(
      buildRoster({ schoolId: SCHOOL, coachId: COACH, classes: [{ id: 'g1a', grade: 1, section: 'A', size: 20 }] }),
      { unique: CHILD_TEST_UNIQUE },
    );
    expect(await draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, visitKey: `${DAY_KEY}:g1`, allGrades: true, grade: 2, now: NOW }))
      .toEqual({ ok: false, reason: 'bad_visit_key' });
  });
});

describe('the database accepts what the draw writes (migration V1.7.3)', () => {
  const fs = require('fs'); // eslint-disable-line global-require
  const path = require('path'); // eslint-disable-line global-require
  const sql = fs.readFileSync(path.join(__dirname, '../../../infrastructure/supabase/migrations/V1.7.3__child_test_all_grades.sql'), 'utf8');
  const checks = [...sql.matchAll(/ADD CONSTRAINT (child_test_\w+_visit_key_format) CHECK \(visit_key IS NULL OR visit_key ~\s*'([^']+)'\)/g)];

  test('both visit-key checks accept every key visitKeyFor builds, with and without a grade, and refuse :g6', () => {
    expect(checks.map((m) => m[1]).sort()).toEqual(['child_test_draws_visit_key_format', 'child_test_sessions_visit_key_format']);
    for (const [, , re] of checks) {
      const ok = new RegExp(re);
      for (const g of [undefined, 1, 2, 3, 4, 5]) expect(ok.test(visitKeyFor({ coachUserId: COACH, schoolId: SCHOOL, now: NOW, grade: g }))).toBe(true);
      expect(ok.test(`${DAY_KEY}:g6`)).toBe(false);
      expect(ok.test(`sa:${COACH}:2026-10-05`)).toBe(true);
    }
  });

  test('both grade checks allow 1–5', () => {
    expect(sql).toMatch(/child_test_draws_grade_check CHECK \(grade BETWEEN 1 AND 5\)/);
    expect(sql).toMatch(/child_test_sessions_grade_check CHECK \(grade BETWEEN 1 AND 5\)/);
  });
});
