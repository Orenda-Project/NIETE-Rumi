'use strict';
/**
 * GB schools rank in their own league (Amena, 23 Nov 2026, bd-97daxo.34.7): a GB viewer's
 * board holds GB schools only; an ICT viewer's board holds ICT schools, plus a GB school
 * counted only for its grade 6-10 quizzes (the same books as ICT). Pure rules, then the
 * board loaded through the in-memory Supabase.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const S = require('../../../shared/services/quiz/web-quiz-schools');
const L = require('../../../shared/services/quiz/web-quiz-league');

const NOW = Date.parse('2026-10-07T05:00:00Z');
const TODAY = '2026-10-06T19:00:00.000Z';
const GB = 'Gilgit-Baltistan';

describe('the league rules (pure)', () => {
  test('a GB school is one whose region is Gilgit-Baltistan, in any case or spacing', () => {
    expect(L.isGb({ region: GB })).toBe(true);
    expect(L.isGb({ region: ' gilgit-baltistan ' })).toBe(true);
    expect(L.isGb({ region: 'Urban-I' })).toBe(false);
    expect(L.isGb({ region: null })).toBe(false);
    expect(L.isGb(null)).toBe(false);
  });

  test('only a grade wholly inside 6-10 is comparable with ICT; unknown is not', () => {
    for (const g of ['6', '8', '10', '6-8', '9-10', 'Grade 7']) expect(L.comparableGrade(g)).toBe(true);
    for (const g of ['5', '3-5', '1-2', '11', '6-12', '10-12', '', null, undefined, 'all']) expect(L.comparableGrade(g)).toBe(false);
  });

  test("the viewer's league: GB from a GB school, else from a GB teacher with no school; ICT otherwise", () => {
    expect(L.leagueOf({ region: GB }, null)).toBe('gb');
    expect(L.leagueOf(null, GB)).toBe('gb');
    expect(L.leagueOf(undefined, 'Islamabad')).toBe('ict');
    expect(L.leagueOf({ region: 'Nilore' }, GB)).toBe('ict'); // the school decides when there is one
  });
});

describe('scoreSchools by league (pure)', () => {
  const schools = [
    { id: 'I1', name: 'ICT One', region: 'Nilore', is_active: true, is_probable_test: false },
    { id: 'I2', name: 'ICT Two', region: 'Urban-I', is_active: true, is_probable_test: false },
    { id: 'G1', name: 'GB One', region: GB, is_active: true, is_probable_test: false },
    { id: 'G2', name: 'GB Two', region: GB, is_active: true, is_probable_test: false },
  ];
  const p = (schoolId, kid, codeId, grade) => ({ schoolId, kid, codeId, pct: 100, at: '2026-10-05T05:00:00Z', grade });
  const plays = [
    p('I1', 'k1', 'c1', '4'),
    p('I2', 'k2', 'c2', '7'),
    p('G1', 'k3', 'c3', '3'),   // GB grade 3: GB league only
    p('G1', 'k4', 'c4', '8'),   // GB grade 8: also next to ICT
    p('G2', 'k5', 'c5', '2'),
  ];

  test('a GB viewer sees GB schools only, every grade they played', () => {
    const out = S.scoreSchools({ plays, schools, mySchoolId: 'G2', splitAt: TODAY });
    expect(out.rows.map((r) => [r.name, r.points])).toEqual([['GB One', 40], ['GB Two', 20]]);
    expect(out.zero_n).toBe(0);
    expect(out.mine).toEqual(expect.objectContaining({ name: 'GB Two', place: 2 }));
  });

  test('an ICT viewer sees ICT schools, and a GB school only for its grade 6-10 plays', () => {
    const out = S.scoreSchools({ plays, schools, mySchoolId: 'I1', splitAt: TODAY });
    expect(out.rows.map((r) => [r.name, r.points, r.kids])).toEqual([['GB One', 20, 1], ['ICT One', 20, 1], ['ICT Two', 20, 1]]);
    expect(out.rows.map((r) => r.name)).not.toContain('GB Two');
  });

  test('GB schools with no grade 6-10 plays are not listed as still to start on the ICT board', () => {
    const out = S.scoreSchools({ plays: [p('I1', 'k1', 'c1', '4')], schools, mySchoolId: 'I1', splitAt: TODAY });
    expect(out.zero_names).toEqual(['ICT Two']);
  });

  test('an explicit league wins (a GB teacher with no school sees the GB board)', () => {
    const out = S.scoreSchools({ plays, schools, mySchoolId: null, splitAt: TODAY, league: 'gb' });
    expect(out.rows.map((r) => r.name)).toEqual(['GB One', 'GB Two']);
    expect(out.mine).toBeNull();
  });
});

describe('the board by league (loaded through Supabase)', () => {
  const TI = '11111111-1111-4111-8111-111111111111';
  const TG = '11111111-1111-4111-8111-222222222222';
  const TN = '11111111-1111-4111-8111-333333333333';
  const future = '2099-12-31T00:00:00.000Z';
  const sess = (id, sc, quiz, kid) => ({
    id, share_code_id: sc, quiz_id: quiz, student_id: kid, mastery_percentage: 100, completed_at: '2026-10-05T05:00:00Z', status: 'completed', user_id: null,
  });
  beforeEach(() => {
    S._reset();
    process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'route-key';
    Object.assign(supabase, makeFake({
      schools: [
        { id: 'SI', name: 'ICT School', region: 'Nilore', is_active: true, is_probable_test: false },
        { id: 'SG', name: 'GB School', region: GB, is_active: true, is_probable_test: false },
      ],
      users: [{ id: TI, school_id: 'SI' }, { id: TG, school_id: 'SG', region: GB }, { id: TN, school_id: null, region: GB }],
      quizzes: [{ id: 'q4', grade: '4' }, { id: 'q3', grade: '3' }, { id: 'q8', grade: '6-8' }],
      quiz_share_codes: [
        { id: 'ci', code: 'ICTAA1', quiz_id: 'q4', teacher_user_id: TI, language: 'en', active: true, expires_at: future },
        { id: 'cg3', code: 'GBLOW1', quiz_id: 'q3', teacher_user_id: TG, language: 'ur', active: true, expires_at: future },
        { id: 'cg8', code: 'GBHIG1', quiz_id: 'q8', teacher_user_id: TG, language: 'ur', active: true, expires_at: future },
        { id: 'cn', code: 'GBNOS1', quiz_id: 'q3', teacher_user_id: TN, language: 'ur', active: true, expires_at: future },
      ],
      quiz_sessions: [sess('s1', 'ci', 'q4', 'k1'), sess('s2', 'cg3', 'q3', 'k2'), sess('s3', 'cg8', 'q8', 'k3')],
    }));
  });

  test('a GB child sees the GB league with all its plays; an ICT child sees GB only for grade 6-10', async () => {
    const gb = await S.board('GBLOW1', { now: NOW });
    expect(gb.rows.map((r) => [r.name, r.points, r.kids])).toEqual([['GB School', 40, 2]]);
    const ict = await S.board('ICTAA1', { now: NOW });
    expect(ict.rows.map((r) => [r.name, r.points, r.kids])).toEqual([['GB School', 20, 1], ['ICT School', 20, 1]]);
  });

  test("a GB teacher with no school: the child sees the GB league, never ICT schools", async () => {
    const b = await S.board('GBNOS1', { now: NOW });
    expect(b.rows.map((r) => r.name)).toEqual(['GB School']);
  });
});
