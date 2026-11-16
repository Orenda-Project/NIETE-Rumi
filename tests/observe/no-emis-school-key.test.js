/**
 * A school with no EMIS still has a key to book and record a visit under.
 *
 * observation_schedules.school_ext_id is NOT NULL. Every writer used to build that key as 'niete:' + the school's
 * EMIS, which is NULL for a school with no EMIS (the GB community schools, the Rumi QA test schools). The portal's
 * "Schedule a visit" then failed with `null value in column "school_ext_id" ... violates not-null constraint`, shown
 * to the coach as the error text. WhatsApp's "which teacher did you observe?" record built the same NULL.
 *
 * The rule, one for every writer, the one the WhatsApp visit Flow already follows: 'niete:' + EMIS, else the key of the
 * coach's leader_schools holding for that school (a school with no EMIS is keyed by its name there). In SQL it is
 * COALESCE('niete:' || s.emis, ls.school_ext_id), as the portal's patch list (leader-patch) already reads it.
 *
 * A school with an EMIS keeps exactly the key it had.
 */
const { createSchedule } = require('../../dashboard/services/leader-schedule-write.service');
const { createFakeSupabase } = require('../observe2/helpers/fake-supabase');

// Fixture phones are built at run time, never written out as literals.
const phone = (n) => ['92', '300', String(n).padStart(7, '0')].join('');

// ── the shared rule ──────────────────────────────────────────────────────────

describe('patch-resolver schoolKeyOf: EMIS first, else the holding key', () => {
  const { schoolKeyOf, toLeaderSourceRow } = require('../../bot/shared/services/observe/patch-resolver.service');

  test('a school with an EMIS is keyed niete:<EMIS>, whatever the holding says', () => {
    expect(schoolKeyOf({ emis: '509', schoolExtId: 'niete:something-else' })).toBe('niete:509');
  });

  test('a school with no EMIS takes the holding key', () => {
    expect(schoolKeyOf({ emis: null, schoolExtId: 'niete:gb-test-middle-rumi-qa' })).toBe('niete:gb-test-middle-rumi-qa');
    expect(schoolKeyOf({ emis: '', schoolExtId: 'niete:gb-test-middle-rumi-qa' })).toBe('niete:gb-test-middle-rumi-qa');
  });

  test('neither: null, never the string "niete:null"', () => {
    expect(schoolKeyOf({ emis: null, schoolExtId: null })).toBeNull();
    expect(schoolKeyOf({})).toBeNull();
    expect(schoolKeyOf(null)).toBeNull();
  });

  test('the WhatsApp visit Flow rows read the same rule (unchanged)', () => {
    expect(toLeaderSourceRow({ phone: phone(1), emis: '509' }).school_ext_id).toBe('niete:509');
    expect(toLeaderSourceRow({ phone: phone(1), emis: null, schoolExtId: 'niete:gb-hoto' }).school_ext_id).toBe('niete:gb-hoto');
  });
});

// ── the portal: Schedule a visit ─────────────────────────────────────────────

describe('portal createSchedule at a school with no EMIS', () => {
  const LEADER = 'leader-1';
  const TODAY = '2026-11-16';

  function makeQuery(patchRow) {
    const calls = [];
    const fn = jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/leader_schools/i.test(sql)) return { rows: patchRow ? [patchRow] : [] };
      if (/^\s*select/i.test(sql) && /observation_schedules/i.test(sql)) return { rows: [] };
      return { rows: [{ id: 'sched-new' }] };
    });
    fn.calls = calls;
    return fn;
  }
  const inserts = (q) => q.calls.filter((c) => /INSERT INTO observation_schedules/i.test(c.sql));

  test('the patch query keys the school by its EMIS, else by the coach\'s holding', async () => {
    const q = makeQuery({ teacher_user_id: 'u-1', teacher_ext_id: phone(2), teacher_name: 'A', school_ext_id: 'niete:509', school_name: 'S' });
    await createSchedule(q, LEADER, { teacherExtId: phone(2), date: '2026-11-20', slot: '09:00' }, { today: TODAY });
    const patchSql = q.calls.find((c) => /leader_schools/i.test(c.sql)).sql;
    expect(patchSql).toMatch(/COALESCE\(\s*'niete:'\s*\|\|\s*s\.emis\s*,\s*ls\.school_ext_id\s*\)\s+AS\s+school_ext_id/i);
    expect(patchSql).not.toMatch(/^\s*'niete:'\s*\|\|\s*s\.emis\s+AS\s+school_ext_id/im);
  });

  test('a teacher at a no-EMIS school is booked under the holding key', async () => {
    const q = makeQuery({
      teacher_user_id: 'u-2', teacher_ext_id: phone(3), teacher_name: 'GB Test Teacher',
      school_ext_id: 'niete:gb-test-middle-rumi-qa', school_name: 'GB Test Middle (Rumi QA)',
    });
    const out = await createSchedule(q, LEADER, { teacherExtId: phone(3), date: '2026-11-20', slot: '09:00' }, { today: TODAY });
    expect(out).toMatchObject({ id: 'sched-new', updated: false });
    const [ins] = inserts(q);
    expect(ins.params[1]).toBe('niete:gb-test-middle-rumi-qa');
  });

  test('a school with an EMIS books exactly as before', async () => {
    const q = makeQuery({ teacher_user_id: 'u-3', teacher_ext_id: phone(4), teacher_name: 'B', school_ext_id: 'niete:509', school_name: 'IMSG' });
    await createSchedule(q, LEADER, { teacherExtId: phone(4), date: '2026-11-20', slot: '09:00' }, { today: TODAY });
    expect(inserts(q)[0].params.slice(0, 3)).toEqual([LEADER, 'niete:509', phone(4)]);
  });

  test('no key at all: a plain refusal, nothing written (not the database\'s not-null error)', async () => {
    const q = makeQuery({ teacher_user_id: 'u-4', teacher_ext_id: phone(5), teacher_name: 'C', school_ext_id: null, school_name: 'No Key School' });
    await expect(createSchedule(q, LEADER, { teacherExtId: phone(5), date: '2026-11-20', slot: '09:00' }, { today: TODAY }))
      .rejects.toThrow(/school/i);
    expect(inserts(q)).toEqual([]);
    expect(q.calls.some((c) => /observation_schedules/i.test(c.sql))).toBe(false);
  });
});

// ── WhatsApp: "which teacher did you observe?" ──────────────────────────────

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));
const mockRedis = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn((k) => Promise.resolve(mockRedis.has(k) ? JSON.parse(mockRedis.get(k)) : null)),
  setexWithCeiling: jest.fn((k, ttl, v) => { mockRedis.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return Promise.resolve(true); }),
  delete: jest.fn((k) => { mockRedis.delete(k); return Promise.resolve(true); }),
}));

describe('WhatsApp observe-who records the observed teacher at a school with no EMIS', () => {
  const ObserveWho = require('../../bot/shared/services/observe/observe-who.service');
  const WhatsApp = require('../../bot/shared/services/whatsapp.service');
  const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'en', phone_number: phone(9) };

  function seed({ emis, holdingKey }) {
    mockDb = createFakeSupabase({
      leader_schools: [{ leader_user_id: 'coach-1', school_ext_id: holdingKey, school_id: 'school-1', school_name: 'S', emis }],
      schools: [{ id: 'school-1', name: 'GB Test Middle (Rumi QA)', emis }],
      users: [COACH, { id: 't-1', phone_number: phone(11), name: 'Rukhsana Kausar', role: 'teacher', school_id: 'school-1' }],
      coaching_sessions: [{ id: 'sess-1', observer_user_id: 'coach-1', user_id: 'coach-1', observation_type: 'leader_observation', status: 'confirmed', debrief_status: 'pending', created_at: new Date().toISOString() }],
      observation_field_forms: [],
      observation_schedules: [],
    });
  }
  const schedules = () => mockDb.__tables.observation_schedules;

  beforeEach(() => { jest.clearAllMocks(); mockRedis.clear(); });

  test.each([
    ['no EMIS: the holding key', null, 'niete:gb-test-middle-rumi-qa', 'niete:gb-test-middle-rumi-qa'],
    ['an EMIS: niete:<EMIS>, unchanged', '9001', 'niete:9001', 'niete:9001'],
  ])('typed name, one match (%s)', async (_label, emis, holdingKey, expected) => {
    seed({ emis, holdingKey });
    mockRedis.set('observe:who-typed:coach-1', JSON.stringify({ sessionId: 'sess-1', attempts: 0 }));
    expect(await ObserveWho.handleTypedTeacherName(COACH, COACH.phone_number, 'Rukhsana Kausar')).toBe(true);
    expect(schedules()).toHaveLength(1);
    expect(schedules()[0]).toMatchObject({ session_id: 'sess-1', status: 'done', teacher_user_id: 't-1', school_ext_id: expected });
  });

  test('asked from the list, then picked: the stash carries the holding key and the record is written', async () => {
    seed({ emis: null, holdingKey: 'niete:gb-test-middle-rumi-qa' });
    await ObserveWho.maybeAskObservedTeacher(COACH, COACH.phone_number, 'sess-1');
    const payload = WhatsApp.sendInteractiveMessage.mock.calls.map((c) => c[1]).find(Boolean);
    expect(payload).toBeTruthy();
    const rowIds = JSON.stringify(payload).match(/observe_who_sess-1_[^"\\]+/g) || [];
    const pick = rowIds.find((id) => !/_other$/.test(id));
    expect(pick).toBeTruthy();
    expect(await ObserveWho.handleObservedTeacherPick(COACH, COACH.phone_number, pick)).toBe(true);
    expect(schedules()).toHaveLength(1);
    expect(schedules()[0].school_ext_id).toBe('niete:gb-test-middle-rumi-qa');
  });
});
