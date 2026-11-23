'use strict';
/**
 * Queue #191 — the coach FICO switches are no longer a gate for coaches. Operator, 19 Nov ~17:40: "since we want to
 * have it live for all the coaches, lets just remove the feature flag. it should be live for all of them no matter if
 * we added their thingy or not."
 *
 * So for anyone whose users.role is 'coach':
 *   - fico_coach_rubric answers 'v6' whatever its rows say (no row, no key for her, even an explicit 'current');
 *   - obs612_coach answers 'on' the same way, so the coach is asked the lesson's class and a grade 6-8 lesson goes to
 *     FDE's tool. GB keeps its rule: a GB visit is never FDE (fde-region), so a GB coach is never asked the class.
 * Everyone else (principals, teachers, the Digital Coach on self-recordings) still reads the switches exactly as
 * before. The region rules stay: ICT v6 for grades 1-5 and 9-12, FDE for 6-8; GB v6 at every grade.
 *
 * The real chain is run: the switch → /observe's v6 decision → the class question.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/region-registry', () => ({
  organizationForRegion: jest.fn((client, region) => Promise.resolve(
    ({ ict: 'niete', sihala: 'niete', 'gilgit-baltistan': 'moawin' })[String(region || '').toLowerCase()] || null,
  )),
}));

let mockSettings = {};
let mockUsers = {};
let mockUsersFail = false;
const mockUserReads = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const q = { _t: table, _id: null, _keys: null, _cols: '', _filters: [] };
    q.select = (cols) => { q._cols = cols || ''; return q; };
    q.eq = (col, v) => { q._filters.push([col, v]); if (col === 'id') q._id = v; if (col === 'key') q._keys = [v]; return q; };
    q.in = (col, v) => { if (col === 'key') q._keys = v; return q; };
    q.maybeSingle = async () => {
      if (q._t !== 'users') return { data: null, error: null };
      mockUserReads.push([q._id, q._cols]);
      if (mockUsersFail) return { data: null, error: { message: 'users read failed' } };
      return { data: mockUsers[q._id] || null, error: null };
    };
    q.then = (res, rej) => {
      if (q._t === 'app_settings') {
        const rows = (q._keys || []).filter((k) => mockSettings[k] !== undefined).map((k) => ({ key: k, value: mockSettings[k] }));
        return Promise.resolve({ data: rows, error: null }).then(res, rej);
      }
      if (q._t === 'users' && q._id) return Promise.resolve({ data: mockUsers[q._id] ? [mockUsers[q._id]] : [], error: null }).then(res, rej);
      return Promise.resolve({ data: [], error: null }).then(res, rej);
    };
    return q;
  },
}));

const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');
const Obs612Switch = require('../../bot/shared/services/coaching/obs612-switch');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');
const Visit = require('../../bot/shared/services/observe/obs612/visit');

const NEW_COACH = 'aaaaaaaa-0000-4000-8000-0000000000c1'; // in no switch row (a new account)
const OFF_COACH = 'aaaaaaaa-0000-4000-8000-0000000000c2'; // an explicit 'current' / 'off' row
const GB_COACH = 'aaaaaaaa-0000-4000-8000-0000000000c3';
const PRINCIPAL = 'bbbbbbbb-0000-4000-8000-0000000000b1';
const TEACHER = 'cccccccc-0000-4000-8000-00000000000a';

// Today's prod shape: explicit ids (none of the ones above), plus the principal role key.
const PROD_COACH_MAP = () => JSON.stringify({ 'user:dddddddd-0000-4000-8000-000000000001': 'v6', 'role:principal': 'v6', [`user:${OFF_COACH}`]: 'current' });
const PROD_OBS612_MAP = () => JSON.stringify({ 'user:dddddddd-0000-4000-8000-000000000001': 'on', 'role:principal': 'on', 'role:principal@gb': 'off', [`user:${OFF_COACH}`]: 'off' });

beforeEach(() => {
  Switch._resetCache();
  Obs612Switch._resetCache();
  mockSettings = { fico_coach_rubric: PROD_COACH_MAP(), obs612_coach: PROD_OBS612_MAP() };
  mockUsersFail = false;
  mockUserReads.length = 0;
  mockUsers = {
    [NEW_COACH]: { id: NEW_COACH, role: 'coach', region: 'ICT', source: null, school_id: null },
    [OFF_COACH]: { id: OFF_COACH, role: ' Coach ', region: 'ICT', source: null, school_id: null },
    [GB_COACH]: { id: GB_COACH, role: 'coach', region: 'Gilgit-Baltistan', source: null, school_id: null },
    [PRINCIPAL]: { id: PRINCIPAL, role: 'principal', region: 'ICT' },
    [TEACHER]: { id: TEACHER, role: 'teacher', region: 'ICT', teacher_level: ['PRIMARY'] },
    prim: { id: 'prim', teacher_level: ['PRIMARY'] },
  };
  process.env.OBSERVE_FRAMEWORK = 'fico';
  process.env.OBSERVE_FICO17_V6_READY = 'true';
});
afterAll(() => { delete process.env.OBSERVE_FICO17_V6_READY; });

describe('fico_coach_rubric: every coach is v6, whatever the rows say', () => {
  test('a coach in no row (a new account) is v6', async () => {
    await expect(Switch.coachRubric({ userId: NEW_COACH, region: 'ICT' })).resolves.toBe('v6');
  });

  test('a coach with an explicit "current" row is v6 too', async () => {
    await expect(Switch.coachRubric({ userId: OFF_COACH, region: 'ICT' })).resolves.toBe('v6');
  });

  test('a coach is v6 with no fico_coach_rubric row at all', async () => {
    delete mockSettings.fico_coach_rubric;
    await expect(Switch.coachRubric({ userId: NEW_COACH, region: 'ICT' })).resolves.toBe('v6');
    await expect(Switch.coachRubric({ userId: NEW_COACH, role: 'coach' })).resolves.toBe('v6');
  });

  test('a role the caller passes decides with no read', async () => {
    await expect(Switch.coachRubric({ userId: NEW_COACH, role: 'coach', region: 'ICT' })).resolves.toBe('v6');
    expect(mockUserReads).toEqual([]);
  });

  test('teachers and principals still follow the rows', async () => {
    await expect(Switch.coachRubric({ userId: TEACHER, region: 'ICT' })).resolves.toBe('current');
    await expect(Switch.coachRubric({ userId: PRINCIPAL, region: 'ICT' })).resolves.toBe('v6');
    mockSettings.fico_coach_rubric = JSON.stringify({});
    Switch._resetCache();
    await expect(Switch.coachRubric({ userId: PRINCIPAL, region: 'ICT' })).resolves.toBe('current');
  });

  test('a role that cannot be read is not taken for a coach (the rows decide, as before)', async () => {
    mockUsersFail = true;
    await expect(Switch.coachRubric({ userId: NEW_COACH, region: 'ICT' })).resolves.toBe('current');
  });

  test('the Digital Coach switch (self-recordings) is untouched', async () => {
    await expect(Switch.dcRubric({ userId: NEW_COACH, role: 'coach', region: 'ICT' })).resolves.toBe('v3');
  });
});

describe('obs612_coach: every coach gets FDE\'s class question, GB aside', () => {
  test('a coach in no row, and one with an explicit "off" row, are on', async () => {
    await expect(Obs612Switch.isOn({ userId: NEW_COACH, region: 'ICT' })).resolves.toBe(true);
    await expect(Obs612Switch.isOn({ userId: OFF_COACH, region: 'ICT' })).resolves.toBe(true);
  });

  test('on with no obs612_coach row at all', async () => {
    delete mockSettings.obs612_coach;
    await expect(Obs612Switch.isOn({ userId: NEW_COACH, region: 'ICT' })).resolves.toBe(true);
  });

  test('a teacher stays off; a principal follows the rows', async () => {
    await expect(Obs612Switch.isOn({ userId: TEACHER, region: 'ICT' })).resolves.toBe(false);
    await expect(Obs612Switch.isOn({ userId: PRINCIPAL, region: 'ICT' })).resolves.toBe(true);
  });

  test('the class question: asked of an ICT coach in no row, never of a GB coach', async () => {
    await expect(Visit.asksClass({ id: NEW_COACH, role: 'coach', region: 'ICT' })).resolves.toBe(true);
    await expect(Visit.asksClass({ id: GB_COACH, role: 'coach', region: 'Gilgit-Baltistan' })).resolves.toBe(false);
    await expect(Visit.asksClass({ id: TEACHER, role: 'teacher', region: 'ICT' })).resolves.toBe(false);
  });
});

describe('the real chain: a new coach\'s /observe visit is stamped FICO17 v6', () => {
  test('grades 1-5 teacher → fico17_v6, with the coach in no row', async () => {
    await expect(O6.decideVisitFramework({ userId: NEW_COACH, region: 'ICT', teacherUserId: 'prim' })).resolves.toBe('fico17_v6');
    await expect(O6.decideVisitFramework({ userId: OFF_COACH, region: 'ICT', teacherUserId: 'prim' })).resolves.toBe('fico17_v6');
  });

  test('a named grades 1-5 lesson → fico17_v6', async () => {
    await expect(O6.decideVisitFramework({ userId: NEW_COACH, region: 'ICT', lessonIsPrimary: true })).resolves.toBe('fico17_v6');
  });

  test('/observe2 visitRubric: a new coach\'s grades 1-5 visit is v6, even with no fico_coach_rubric row', async () => {
    delete mockSettings.fico_coach_rubric;
    const { rubricForNewVisit } = require('../../bot/shared/services/observe/observe2/rubric');
    await expect(rubricForNewVisit({ observerUserId: NEW_COACH, region: 'ICT', teacherUserId: 'prim' })).resolves.toBe('fico17_v6');
  });
});
