'use strict';
/**
 * bd-ra8xu.42 — FICO17 v6 reaches coach visits for grades 1-5 only (operator 11 Nov ~18:05: "for primary, both HITL
 * and DC is FICO v6 … for 6-12, the rubric is the FDE one for HITL"). With the coach switch on v6, a visit to a
 * PRIMARY-only teacher is stamped v6; a teacher of grades 6-12, of unknown level, or no teacher bound stays on
 * today's rubric (/observe2 v5, /observe V3). Both tools.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

let mockUsers = {};
let mockSwitch = null;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const q = { _t: table, _id: null };
    q.select = () => q;
    q.eq = (col, v) => { if (col === 'id') q._id = v; return q; };
    q.in = () => q;
    q.maybeSingle = async () => ({ data: q._t === 'users' ? (mockUsers[q._id] || null) : null, error: null });
    q.then = (res) => res({ data: q._t === 'app_settings' && mockSwitch ? [{ key: 'fico_coach_rubric', value: mockSwitch }] : [], error: null });
    return q;
  },
}));

const Grade = require('../../bot/shared/services/coaching/fico-visit-grade');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');
const { visitRubric } = require('../../bot/shared/services/observe/observe2/rubric');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');

beforeEach(() => {
  mockUsers = {
    prim: { id: 'prim', teacher_level: ['PRIMARY'] },
    mixed: { id: 'mixed', teacher_level: ['PRIMARY', 'MIDDLE'] },
    high: { id: 'high', teacher_level: ['HIGH'] },
    primhigh: { id: 'primhigh', teacher_level: ['PRIMARY', 'HIGH'] },
    midhigh: { id: 'midhigh', teacher_level: ['MIDDLE', 'HIGH'] },
    none: { id: 'none', teacher_level: null },
  };
  mockSwitch = JSON.stringify({ '*': 'v6' });
  Switch._resetCache();
  process.env.OBSERVE_FRAMEWORK = 'fico';
  process.env.OBSERVE_FICO17_V6_READY = 'true';
});
afterAll(() => { delete process.env.OBSERVE_FICO17_V6_READY; });

describe('who counts as a FICO-grade visit (grades 1-5 or 9-12; never 6-8)', () => {
  test.each([
    // bd-ra8xu.40 (operator 12 Nov ~11:00): grades 9-12 follow the FICO switch too; only 6-8 (MIDDLE) is FDE's.
    [['PRIMARY'], true], [['HIGH'], true], [['PRIMARY', 'HIGH'], true],
    [['PRIMARY', 'MIDDLE'], false], [['MIDDLE', 'HIGH'], false], [['MIDDLE'], false], [null, false], [[], false],
  ])('teacher_level %j → %s', (lv, want) => {
    expect(Grade.isPrimaryOnly({ teacher_level: lv })).toBe(want);
  });
  test('no teacher id, or no row, is not a grades 1-5 visit', async () => {
    expect(await Grade.isPrimaryVisit(null)).toBe(false);
    expect(await Grade.isPrimaryVisit('ghost')).toBe(false);
  });
});

describe('/observe2: the switch on v6 stamps only grades 1-5 visits', () => {
  test.each([['prim', 'fico17_v6'], ['high', 'fico17_v6'], ['primhigh', 'fico17_v6'], ['mixed', 'fico-ict-17-2026-09'], ['midhigh', 'fico-ict-17-2026-09'], ['none', 'fico-ict-17-2026-09'], [null, 'fico-ict-17-2026-09']])(
    'teacher %s → %s', async (teacher, want) => {
      const r = await visitRubric({ observerUserId: 'coach-1', region: 'Sihala', teacherUserId: teacher });
      expect(r.rubricVersion).toBe(want);
    },
  );
  test('switch off: v5 for a primary teacher too, as today', async () => {
    mockSwitch = null; Switch._resetCache();
    expect((await visitRubric({ observerUserId: 'coach-1', region: 'Sihala', teacherUserId: 'prim' })).rubricVersion).toBe('fico-ict-17-2026-09');
  });
});

describe('/observe: the switch on v6 (and the readiness flag) stamps only grades 1-5 visits', () => {
  test.each([['prim', 'fico17_v6'], ['high', 'fico17_v6'], ['primhigh', 'fico17_v6'], ['mixed', null], ['midhigh', null], ['none', null], [null, null]])(
    'teacher %s → %s', async (teacher, want) => {
      expect(await O6.decideVisitFramework({ userId: 'coach-1', region: 'Sihala', teacherUserId: teacher })).toBe(want);
    },
  );
  test('readiness flag off: V3 for a primary teacher too', async () => {
    delete process.env.OBSERVE_FICO17_V6_READY;
    expect(await O6.decideVisitFramework({ userId: 'coach-1', region: 'Sihala', teacherUserId: 'prim' })).toBeNull();
  });
});
