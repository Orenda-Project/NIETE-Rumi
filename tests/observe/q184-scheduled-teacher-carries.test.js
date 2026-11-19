/**
 * Queue #184 (bd-pkxzg9.1) — a scheduled visit carries the teacher it names, from Start through the recording.
 *
 * Prod, 19 Nov (Rifat, WhatsApp): she ran a visit she had booked in the portal, the bind at Start failed
 * ("❌ observe-visit: teacher bind FAILED — capture will run UNBOUND"), and after the recording Rumi asked
 * "who did you observe?" again. The booking named the coach herself as the teacher (a QA school where her number is
 * also a teacher's), and the roster read the bind uses drops the coach from her own patch (15 Sep: the picker must
 * not offer a coach herself). The booking is the coach's own explicit choice, made against her patch when she made
 * it (portal createSchedule / WhatsApp saveSchedule): when the roster cannot resolve the teacher of an UPCOMING
 * booking of hers, the bind falls back to that booking, so the capture is bound and nobody is asked twice.
 *
 * Real: the visit handler's bind and the schedule store. Mocked: the roster (resolveTeacher), the observe state, the
 * logger, and Supabase (filters emulated).
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  getState: jest.fn(() => Promise.resolve(null)),
  setState: jest.fn(() => Promise.resolve(true)),
  clearState: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/assignment/leader-source', () => ({
  resolveTeacher: jest.fn(() => Promise.resolve(null)),
}));

const COACH_ID = 'c0ac0000-0000-4000-8000-000000000001';
const OTHER_COACH = 'c0ac0000-0000-4000-8000-000000000002';
const COACH_PHONE = '923000000437';

const mockDb = {
  observation_schedules: [],
  users: [
    { id: COACH_ID, phone_number: COACH_PHONE, preferred_language: 'ur' },
  ],
};

// A thenable PostgREST stand-in: eq/in/neq filters applied literally, maybeSingle / limit honoured.
function mockTable(name) {
  const filters = [];
  let single = false;
  let lim = null;
  const q = {
    select: () => q,
    eq: (c, v) => { filters.push((r) => r[c] === v); return q; },
    in: (c, vs) => { filters.push((r) => vs.includes(r[c])); return q; },
    order: () => q,
    limit: (n) => { lim = n; return q; },
    maybeSingle: () => { single = true; return q; },
    then: (resolve) => {
      let rows = (mockDb[name] || []).filter((r) => filters.every((f) => f(r)));
      if (lim != null) rows = rows.slice(0, lim);
      resolve({ data: single ? (rows[0] || null) : rows, error: null });
    },
  };
  return q;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((name) => mockTable(name)) }));

const { logToFile } = require('../../bot/shared/utils/logger');
const ObserveState = require('../../bot/shared/services/observe/observe-state.service');
const VisitHandler = require('../../bot/shared/handlers/observe-visit-flow.handler');
const ScheduleStore = require('../../bot/shared/services/observe/observe-schedule.service');

const COACH = { id: COACH_ID, role: 'coach', preferred_language: 'en' };
const SCHOOL = 'niete:gb-test-middle-rumi-qa';
const START = { step: 'start', teacher_ext_id: COACH_PHONE, school_ext_id: SCHOOL };
const selfBooking = (over = {}) => ({
  id: 'e8f6638e', leader_user_id: COACH_ID, school_ext_id: SCHOOL, teacher_ext_id: COACH_PHONE,
  teacher_name: 'Rifat Yasmeen', school_name: 'GB Test Middle (Rumi QA)', teacher_user_id: COACH_ID,
  scheduled_for: '2026-12-11', scheduled_slot: '11:30', status: 'upcoming', ...over,
});
const boundOf = () => {
  const call = ObserveState.setState.mock.calls.find((c) => c[1] === 'awaiting_audio');
  return call ? call[2].boundTeacher : undefined;
};
const failedBindLogged = () => logToFile.mock.calls.some((c) => /teacher bind FAILED/.test(c[0]));

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.observation_schedules = [];
});

describe('a booked visit whose teacher the roster cannot resolve (prod 19 Nov)', () => {
  test('the booking naming the coach herself binds at Start: no failed bind, no re-ask after the recording', async () => {
    mockDb.observation_schedules = [selfBooking()];
    await VisitHandler.handle(COACH_ID, 'complete', 'BRIEF', START, COACH_ID, COACH);
    expect(boundOf()).toEqual(expect.objectContaining({
      teacher_ext_id: COACH_PHONE, teacher_name: 'Rifat Yasmeen', user_id: COACH_ID, school_ext_id: SCHOOL,
    }));
    expect(failedBindLogged()).toBe(false);
  });

  test("the booked teacher's language and phone come with the bind", async () => {
    mockDb.observation_schedules = [selfBooking()];
    await VisitHandler.handle(COACH_ID, 'complete', 'BRIEF', START, COACH_ID, COACH);
    expect(boundOf()).toEqual(expect.objectContaining({ phone_e164: COACH_PHONE, preferred_language: 'ur' }));
  });

  test('the booking still binds when Start carries a different school value for the same teacher', async () => {
    mockDb.observation_schedules = [selfBooking()];
    await VisitHandler.handle(COACH_ID, 'complete', 'BRIEF', { ...START, school_ext_id: 'niete:999' }, COACH_ID, COACH);
    expect(boundOf()).toEqual(expect.objectContaining({ teacher_ext_id: COACH_PHONE, user_id: COACH_ID }));
  });
});

describe('nothing else changes', () => {
  test('a visit that was done or cancelled is no booking: the bind fails as before', async () => {
    mockDb.observation_schedules = [selfBooking({ status: 'done' }), selfBooking({ id: 'x2', status: 'cancelled' })];
    await VisitHandler.handle(COACH_ID, 'complete', 'BRIEF', START, COACH_ID, COACH);
    expect(boundOf()).toBeNull();
    expect(failedBindLogged()).toBe(true);
  });

  test("another coach's booking of that teacher never binds this coach's recording", async () => {
    mockDb.observation_schedules = [selfBooking({ leader_user_id: OTHER_COACH })];
    await VisitHandler.handle(COACH_ID, 'complete', 'BRIEF', START, COACH_ID, COACH);
    expect(boundOf()).toBeNull();
    expect(failedBindLogged()).toBe(true);
  });

  test('a teacher the roster resolves binds from the roster, exactly as before', async () => {
    const LeaderSource = require('../../bot/shared/services/observe/assignment/leader-source');
    LeaderSource.resolveTeacher.mockResolvedValueOnce({ user_id: 'teacher-1', teacher_ext_id: 'tx1', teacher_name: 'Rabia', phone_e164: '923000000002' });
    mockDb.observation_schedules = [selfBooking({ teacher_ext_id: 'tx1', teacher_name: 'Someone Else', teacher_user_id: 'other' })];
    await VisitHandler.handle(COACH_ID, 'complete', 'BRIEF', { ...START, teacher_ext_id: 'tx1' }, COACH_ID, COACH);
    expect(boundOf()).toEqual(expect.objectContaining({ user_id: 'teacher-1', teacher_name: 'Rabia' }));
  });

  test('the store answers null on a miss and never throws on a failed read', async () => {
    await expect(ScheduleStore.scheduledTeacher(COACH_ID, 'nobody', SCHOOL)).resolves.toBeNull();
    const supabase = require('../../bot/shared/config/supabase');
    supabase.from.mockImplementationOnce(() => { throw new Error('db down'); });
    await expect(ScheduleStore.scheduledTeacher(COACH_ID, COACH_PHONE, SCHOOL)).resolves.toBeNull();
  });
});
