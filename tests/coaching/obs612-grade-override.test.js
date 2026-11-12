'use strict';
/**
 * bd-pni007 — when the coach names the lesson's class (obs612_coach on), a grades 1-5 answer decides FICO's grades
 * 1-5 gate (bd-ra8xu.42) instead of the teacher's profile: a mixed-level or unprofiled teacher's primary lesson gets
 * v6 when the coach switch says v6. Absent (switch off, no answer): the profile decides, exactly as before.
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

const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');
// sandbox and staging: visitRubric ({rubricVersion, shadow}); main: the older rubricForNewVisit (the stamp alone).
const R = require('../../bot/shared/services/observe/observe2/rubric');
const visitRubric = R.visitRubric || (async (w) => ({ rubricVersion: await R.rubricForNewVisit(w), shadow: false }));
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');

beforeEach(() => {
  mockUsers = { mixed: { id: 'mixed', teacher_level: ['PRIMARY', 'MIDDLE'] }, prim: { id: 'prim', teacher_level: ['PRIMARY'] } };
  mockSwitch = JSON.stringify({ '*': 'v6' });
  Switch._resetCache();
  process.env.OBSERVE_FRAMEWORK = 'fico';
  process.env.OBSERVE_FICO17_V6_READY = 'true';
});
afterAll(() => { delete process.env.OBSERVE_FICO17_V6_READY; });

test('/observe2: a named grades 1-5 lesson is v6 whatever the profile; unnamed, the profile decides', async () => {
  expect((await visitRubric({ observerUserId: 'c', region: 'sihala', teacherUserId: 'mixed', lessonIsPrimary: true })).rubricVersion).toBe('fico17_v6');
  expect((await visitRubric({ observerUserId: 'c', region: 'sihala', teacherUserId: null, lessonIsPrimary: true })).rubricVersion).toBe('fico17_v6');
  expect((await visitRubric({ observerUserId: 'c', region: 'sihala', teacherUserId: 'mixed' })).rubricVersion).toBe('fico-ict-17-2026-09');
  expect((await visitRubric({ observerUserId: 'c', region: 'sihala', teacherUserId: 'prim' })).rubricVersion).toBe('fico17_v6');
});

test('/observe: the same', async () => {
  expect(await O6.decideVisitFramework({ userId: 'c', region: 'sihala', teacherUserId: 'mixed', lessonIsPrimary: true })).toBe('fico17_v6');
  expect(await O6.decideVisitFramework({ userId: 'c', region: 'sihala', teacherUserId: 'mixed' })).toBeNull();
});

test('the coach switch still rules: off, a named primary lesson stays on today\'s rubric', async () => {
  mockSwitch = null; Switch._resetCache();
  expect((await visitRubric({ observerUserId: 'c', region: 'sihala', teacherUserId: 'prim', lessonIsPrimary: true })).rubricVersion).toBe('fico-ict-17-2026-09');
  expect(await O6.decideVisitFramework({ userId: 'c', region: 'sihala', teacherUserId: 'prim', lessonIsPrimary: true })).toBeNull();
});
