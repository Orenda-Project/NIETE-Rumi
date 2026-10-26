'use strict';

/**
 * Practice schools only (app_settings child_test_practice_only, default OFF). ON, a coach who is not on the pilot list
 * (CHILD_TEST_COACH_IDS) gets the coach app's Learning assessment in their practice (is_probable_test) schools only:
 * the school list holds only those, and a list, an outcome or a session anywhere else is not_found. Pilot coaches are
 * unchanged; the coach-recorded handlers and WhatsApp /egra stay closed to a practice coach; any failure is off.
 */

jest.mock('../../shared/services/child-test/app/practice-only-switch', () => ({
  KEY: 'child_test_practice_only',
  on: jest.fn(async () => true),
  enabled: async (deps = {}) => deps.practiceSwitch === true,
}));

const gate = require('../../shared/services/child-test/conversation/gate');
const switchMod = require('../../shared/services/child-test/app/practice-only-switch');
const app = require('../../shared/services/child-test/app/app-api.service');
const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const PILOT = 'aaaaaaaa-0000-4000-8000-000000000009';
const REAL = 'bbbbbbbb-0000-4000-8000-000000000002';
const PRACTICE = 'cccccccc-0000-4000-8000-000000000003';
const SESSION = 'dddddddd-0000-4000-8000-000000000004';
const NOW = new Date('2026-10-26T05:00:00Z');

function chain(data) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
    then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
  };
  return q;
}

const TABLES = {
  leader_schools: [{ school_id: REAL, school_name: 'Real School' }, { school_id: PRACTICE, school_name: 'SIM — Practice School' }],
  schools: [{ id: REAL, name: 'Real School' }, { id: PRACTICE, name: 'SIM — Practice School' }],
  observation_field_forms: [],
};

function world({ pilot = false, practice = new Set([PRACTICE]), sessionSchool = PRACTICE } = {}) {
  const calls = { todaysList: [], practice: 0 };
  const LIST = { ok: true, cycleId: 'ICT-2026-Q4', grade: 3, gradeFallback: false, reused: false, children: [], alternates: [] };
  const deps = {
    enabled: async () => pilot,
    practice: async () => { calls.practice += 1; if (practice instanceof Error) throw practice; return practice; },
    supabase: { from: (t) => chain(TABLES[t] || []) },
    store: {
      listSessionsForVisit: async () => ({ ok: true, sessions: [] }),
      listVisitDraws: async () => ({ ok: true, draws: [] }),
      getSession: async () => ({ ok: true, session: { id: SESSION, coach_user_id: COACH, item_bank_version: 'sa-battery', school_id: sessionSchool } }),
    },
    saStore: { findByClient: async () => ({ ok: true }), statusOf: async () => ({ ok: true }) },
    draw: {
      todaysList: async (a) => { calls.todaysList.push(a); return LIST; },
      resolveVisitSchool: async () => ({ ok: false }),
    },
    now: () => NOW,
    log: () => {}, logError: () => {},
  };
  return { deps, calls };
}

describe('gate.isPracticeCoach', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });
  const coach = { id: COACH, role: 'coach', region: 'ICT' };
  beforeEach(() => { process.env.CHILD_TEST_ENABLED = 'true'; process.env.CHILD_TEST_COACH_IDS = PILOT; delete process.env.CHILD_TEST_REGIONS; });

  test('switch ON, a leader in ICT who is not on the pilot list: practice coach', () => {
    expect(gate.isPracticeCoach(coach, true)).toBe(true);
  });
  test('switch OFF (or anything but true): not', () => {
    expect(gate.isPracticeCoach(coach, false)).toBe(false);
    expect(gate.isPracticeCoach(coach, 'true')).toBe(false);
  });
  test('on the pilot list: not (the pilot path is unchanged)', () => {
    expect(gate.isPracticeCoach({ ...coach, id: PILOT }, true)).toBe(false);
  });
  test('pilot list empty (everyone already passes): not', () => {
    process.env.CHILD_TEST_COACH_IDS = '';
    expect(gate.isPracticeCoach(coach, true)).toBe(false);
  });
  test('child test disabled, a teacher, a region outside the list, no user: not', () => {
    expect(gate.isPracticeCoach({ ...coach, role: 'teacher' }, true)).toBe(false);
    expect(gate.isPracticeCoach({ ...coach, region: 'Punjab' }, true)).toBe(false);
    expect(gate.isPracticeCoach(null, true)).toBe(false);
    process.env.CHILD_TEST_ENABLED = 'false';
    expect(gate.isPracticeCoach(coach, true)).toBe(false);
  });
  test('WhatsApp /egra stays closed to a practice coach', () => {
    expect(gate.evaluateChildTestTrigger({ messageBody: '/egra', user: coach })).toEqual({ match: false });
  });
});

describe('practiceFor (the default practice check)', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; switchMod.on.mockImplementation(async () => true); });
  beforeEach(() => { process.env.CHILD_TEST_ENABLED = 'true'; process.env.CHILD_TEST_COACH_IDS = PILOT; delete process.env.CHILD_TEST_REGIONS; });
  const d = (schools) => ({
    supabase: { from: (t) => chain(t === 'users' ? [{ id: COACH, role: 'coach', region: 'ICT' }] : t === 'leader_schools' ? TABLES.leader_schools : schools) },
  });

  test('the coach\'s linked test schools only', async () => {
    const got = await app.__internals.practiceFor(COACH, d([{ id: PRACTICE }]));
    expect([...got]).toEqual([PRACTICE]);
  });
  test('no linked test school: null (off)', async () => {
    expect(await app.__internals.practiceFor(COACH, d([]))).toBeNull();
  });
  test('switch OFF: null, and nothing is read', async () => {
    switchMod.on.mockImplementation(async () => false);
    const from = jest.fn(() => chain([]));
    expect(await app.__internals.practiceFor(COACH, { supabase: { from } })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
  test('pilot coach: null', async () => {
    process.env.CHILD_TEST_COACH_IDS = `${PILOT},${COACH}`;
    expect(await app.__internals.practiceFor(COACH, d([{ id: PRACTICE }]))).toBeNull();
  });
});

describe('the Learning assessment for a practice coach', () => {
  test('the school list holds only the practice school', async () => {
    const { deps } = world();
    const out = await sa.listSchools({ userId: COACH }, deps);
    expect(out.status).toBe('ok');
    expect(out.schools.map((s) => s.schoolId)).toEqual([PRACTICE]);
  });

  test('a real school\'s list is not_found, before any draw', async () => {
    const { deps, calls } = world();
    expect(await sa.dayList({ userId: COACH, schoolId: REAL }, deps)).toEqual({ status: 'not_found' });
    expect(calls.todaysList).toEqual([]);
  });

  test('the practice school\'s list is drawn', async () => {
    const { deps, calls } = world();
    const out = await sa.dayList({ userId: COACH, schoolId: PRACTICE }, deps);
    expect(out.status).toBe('ok');
    expect(calls.todaysList[0]).toMatchObject({ schoolId: PRACTICE });
  });

  test('an outcome or an added child at a real school is not_found', async () => {
    const { deps } = world();
    expect(await sa.dayOutcome({ userId: COACH, schoolId: REAL, drawId: 'd-1', outcome: 'absent' }, deps)).toEqual({ status: 'not_found' });
    const added = await sa.addChild({ userId: COACH, schoolId: REAL, grade: 3, firstName: 'Ali', clientChildId: 'eeeeeeee-0000-4000-8000-000000000005' }, { ...deps, addChild: true, allGrades: true });
    expect(added.status).toBe('not_found');
  });

  test('a session at a real school is not_found', async () => {
    const { deps } = world({ sessionSchool: REAL });
    expect(await sa.saStatus({ userId: COACH, sessionId: SESSION }, deps)).toEqual({ status: 'not_found' });
  });

  test('no practice school, or the check fails: disabled (today)', async () => {
    expect(await sa.listSchools({ userId: COACH }, world({ practice: null }).deps)).toEqual({ status: 'disabled' });
    expect(await sa.listSchools({ userId: COACH }, world({ practice: new Set() }).deps)).toEqual({ status: 'disabled' });
    expect(await sa.listSchools({ userId: COACH }, world({ practice: new Error('db down') }).deps)).toEqual({ status: 'disabled' });
  });

  test('the coach-recorded test stays closed: the practice check is never asked', async () => {
    const { deps, calls } = world();
    expect(await app.listVisits({ userId: COACH }, deps)).toEqual({ status: 'disabled' });
    expect(calls.practice).toBe(0);
  });
});

describe('a pilot coach is unchanged', () => {
  test('every linked school, a real school\'s list drawn, and the practice check never asked', async () => {
    const { deps, calls } = world({ pilot: true });
    const out = await sa.listSchools({ userId: PILOT }, deps);
    expect(out.schools.map((s) => s.schoolId).sort()).toEqual([PRACTICE, REAL].sort());
    expect((await sa.dayList({ userId: PILOT, schoolId: REAL }, deps)).status).toBe('ok');
    expect(calls.practice).toBe(0);
  });
});
