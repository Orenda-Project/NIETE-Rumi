'use strict';
/**
 * One tick of the twice-a-day teacher activity job (bot/shared/services/teacher-activity/teacher-activity-run.service.js),
 * with fakes at the edges: a fake replica (rpc + the region registry read), a fake Redis, a fake sleep.
 *   - off unless a replica is configured AND app_settings teacher_activity_slots names the slots (read on the replica);
 *   - runs only inside a slot's window, once per Pakistan date and slot (run marker), on one worker (claim);
 *   - refuses unless the server says it is a replica; never touches the primary;
 *   - teachers in batches, a pause between batches, one key per teacher (36 h) and the team key;
 *   - a failed batch keeps those teachers' previous values, no team key and no marker (the next tick retries);
 *   - logs counts only, never a user id or a name.
 */
let mockPrimaryTouched = 0;
jest.mock('../../bot/shared/config/supabase', () => new Proxy({}, { get: () => { mockPrimaryTouched += 1; throw new Error('primary touched'); } }));
const mockLogs = [];
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogs.push(a) }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogs.push(a),
  generateCorrelationId: () => 'corr-test',
  runWithCorrelation: (_id, fn) => fn(),
}));

const Run = require('../../bot/shared/services/teacher-activity/teacher-activity-run.service');
const Registry = require('../../bot/shared/services/region-registry');
const C = require('../../bot/shared/config/teacher-activity-contract');

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 19 Nov 2026 14:40 PKT = 09:40 UTC
const AT = (hhmm, date = '2026-11-19') => new Date(Date.parse(`${date}T${hhmm}:00+05:00`));
const SLOTS = { day: '14:30', night: '01:30' };
const REGIONS = [
  { region: 'sihala', organization: 'niete', display_name: 'Sihala', is_active: true, sort_order: 1 },
  { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', is_active: true, sort_order: 1 },
];
const tiles = { plans_opened: { now: 1, prev: 0 }, taught: { now: 0, prev: 0 }, coached: { now: 0, prev: 0 }, quizzes: { now: 0, prev: 0 }, exams: { now: 0, prev: 0 } };

function fakeRedis(seed = {}) {
  const store = { ...seed };
  return {
    store,
    sets: [],
    isAvailable: () => true,
    async setNX(k, v) { if (!(k in store)) store[k] = v; return true; },
    async get(k) { return k in store ? store[k] : null; },
    async set(k, v, ttl) { this.sets.push({ k, ttl }); store[k] = v; return true; },
  };
}

function fakeDb({ slots = SLOTS, replica = true, teachers, failBatch = -1 } = {}) {
  const calls = [];
  let batch = 0;
  const list = teachers || [
    { id: U(1), name: 'Test Teacherwala', school: 'Test School', region: 'Sihala', source: 'direct', level: ['PRIMARY'] },
    { id: U(2), name: 'Second Testwala', school: null, region: null, school_region: null, source: 'main_rumi_gb', level: null },
    { id: U(3), name: 'Third Testwala', school: 'X', region: 'nowhere', source: 'direct', level: ['HIGH'] },
  ];
  return {
    calls,
    from(table) {
      const q = { table, key: null };
      const b = {
        select: () => b,
        eq: (_c, v) => { q.key = v; return b; },
        maybeSingle: async () => { calls.push(['settings', q.key]); return { data: slots === null ? null : { value: slots }, error: null }; },
        then: (res, rej) => { calls.push(['registry']); return Promise.resolve({ data: REGIONS, error: null }).then(res, rej); },
      };
      return b;
    },
    async rpc(name, args) {
      calls.push([name, args && args.p_user_ids ? args.p_user_ids.length : undefined]);
      if (name === 'db_is_replica') return { data: replica, error: null };
      if (name === 'teacher_activity_teachers') return { data: list, error: null };
      if (name === 'teacher_activity_batch') {
        const n = batch; batch += 1;
        if (n === failBatch) return { data: null, error: { message: 'canceling statement due to statement timeout' } };
        return { data: args.p_user_ids.map((id) => ({ user_id: id, tiles, journey: [{ kind: 'plan_opened', at: AT('09:00').toISOString(), ref_id: 'grade_3_math_ch1_seg1', meta: { plan_kind: 'k5' } }], reports: [], latest: null })), error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

const deps = (over = {}) => ({ now: AT('14:40'), redis: fakeRedis(), db: fakeDb(), sleep: jest.fn(async () => {}), ...over });

beforeEach(() => { mockLogs.length = 0; mockPrimaryTouched = 0; Registry._clearCache(); });
afterEach(() => expect(mockPrimaryTouched).toBe(0));

describe('parseSlots / dueSlot', () => {
  test('a slot map of HH:MM times; anything else is off', () => {
    expect(Run.parseSlots(SLOTS)).toEqual({ day: 870, night: 90 });
    expect(Run.parseSlots(JSON.stringify({ night: '01:30' }))).toEqual({ night: 90 });
    // Sceptic pass: a slot after 22:30 would have its 90-minute window cut at midnight and be missed by the hourly tick.
    expect(Run.parseSlots({ day: '22:30' })).toEqual({ day: 1350 });
    for (const bad of [undefined, null, true, [], {}, { day: '25:00' }, { day: '2pm' }, { noon: '12:00' }, 'x', { night: '22:31' }, { night: '23:30' }]) {
      expect(Run.parseSlots(bad)).toBeNull();
    }
  });
  test('due from the slot time for 90 minutes', () => {
    const s = Run.parseSlots(SLOTS);
    expect(Run.dueSlot(AT('14:29'), s)).toBeNull();
    expect(Run.dueSlot(AT('14:30'), s)).toBe('day');
    expect(Run.dueSlot(AT('15:59'), s)).toBe('day');
    expect(Run.dueSlot(AT('16:00'), s)).toBeNull();
    expect(Run.dueSlot(AT('02:10'), s)).toBe('night');
  });
});

describe('run', () => {
  test('no replica configured → off, nothing read', async () => {
    const redis = fakeRedis();
    await expect(Run.run({ ...deps({ redis }), db: null })).resolves.toEqual({ outcome: 'off', reason: 'no_replica' });
    expect(redis.sets).toHaveLength(0);
  });

  test('no slots row → off after the replica check and one settings read on the replica', async () => {
    const db = fakeDb({ slots: null });
    await expect(Run.run(deps({ db }))).resolves.toEqual({ outcome: 'off', reason: 'no_slots' });
    expect(db.calls).toEqual([['db_is_replica', undefined], ['settings', 'teacher_activity_slots']]);
  });

  test('outside a slot window → not due, no claim', async () => {
    const redis = fakeRedis();
    await expect(Run.run(deps({ now: AT('12:00'), redis }))).resolves.toEqual({ outcome: 'not_due' });
    expect(Object.keys(redis.store)).toHaveLength(0);
  });

  test('another worker holds the tick → skipped', async () => {
    const redis = fakeRedis({ [Run.TICK_KEY]: 'someone-else' });
    const db = fakeDb();
    await expect(Run.run(deps({ redis, db }))).resolves.toMatchObject({ outcome: 'skipped', reason: 'other' });
    expect(db.calls.filter((c) => !['db_is_replica', 'settings'].includes(c[0]))).toHaveLength(0);
  });

  test('this slot already ran today → done, nothing counted', async () => {
    const redis = fakeRedis({ [C.runMarkerKey('2026-11-19', 'day')]: '1' });
    const db = fakeDb();
    await expect(Run.run(deps({ redis, db }))).resolves.toEqual({ outcome: 'done_already', slot: 'day' });
    expect(db.calls.map((c) => c[0])).toEqual(['db_is_replica', 'settings']);
  });

  // Sceptic pass: the replica check is the FIRST call, so a URL pointing at the primary never gets even the settings read.
  test.each([[false, 'not_replica'], [null, 'not_replica']])('the server is not a replica (%s) → refused before any other read, no marker', async (replica, reason) => {
    const redis = fakeRedis();
    const db = fakeDb({ replica });
    await expect(Run.run(deps({ redis, db }))).resolves.toEqual({ outcome: 'refused', reason });
    expect(db.calls.map((c) => c[0])).toEqual(['db_is_replica']);
    expect(redis.sets).toHaveLength(0);
  });

  test('a full run: batches, a pause between, one key per teacher, the team key, the marker; counts-only log', async () => {
    const teachers = Array.from({ length: 5 }, (_, i) => ({ id: U(i + 1), name: `T${i} Testwala`, school: 'S', region: 'Sihala', source: 'direct', level: ['PRIMARY'] }));
    const redis = fakeRedis();
    const db = fakeDb({ teachers });
    const sleep = jest.fn(async () => {});
    const out = await Run.run(deps({ redis, db, sleep, batchSize: 2 }));
    expect(out).toMatchObject({ outcome: 'ran', slot: 'day', teachers: 5, batches: 3, failedBatches: 0, written: 5 });
    expect(db.calls.filter((c) => c[0] === 'teacher_activity_batch').map((c) => c[1])).toEqual([2, 2, 1]);
    expect(sleep).toHaveBeenCalledTimes(2);
    const key1 = C.teacherActivityKey(U(1));
    expect(C.checkTeacherActivity(redis.store[key1], AT('14:40').getTime())).toMatchObject({ slot: 'day', furthest_step: 'plan_opened' });
    expect(redis.sets.find((s) => s.k === key1).ttl).toBe(C.TTL_SECONDS);
    const team = C.checkTeamActivity(redis.store[C.TEAM_ACTIVITY_KEY], AT('14:40').getTime());
    expect(team.steps.plan_opened.count).toBe(5);
    expect(redis.store[C.runMarkerKey('2026-11-19', 'day')]).toBeTruthy();
    const logged = JSON.stringify(mockLogs);
    expect(logged).not.toMatch(/00000000-0000-4000/);
    expect(logged).not.toContain('Testwala');
  });

  test('placement: region by the registry, GB by source, unknown → no organization', async () => {
    const redis = fakeRedis();
    await Run.run(deps({ redis }));
    const { teachers } = redis.store[C.TEAM_ACTIVITY_KEY];
    expect(teachers[U(1)]).toMatchObject({ org: 'niete', region: 'Sihala', band: 'k5', name: 'Test Teacherwala' });
    expect(teachers[U(2)]).toMatchObject({ org: 'moawin', region: null });
    expect(teachers[U(3)]).toMatchObject({ org: null, region: null, band: 'g612' });
  });

  test('a failed batch keeps those teachers\' previous values; no team key and no marker, so the next tick retries', async () => {
    const teachers = Array.from({ length: 4 }, (_, i) => ({ id: U(i + 1), name: 'x', region: 'Sihala', source: 'direct' }));
    const redis = fakeRedis({ [C.teacherActivityKey(U(1))]: 'previous' });
    const out = await Run.run(deps({ redis, db: fakeDb({ teachers, failBatch: 0 }), batchSize: 2 }));
    expect(out).toMatchObject({ outcome: 'partial', failedBatches: 1, written: 2 });
    expect(redis.store[C.teacherActivityKey(U(1))]).toBe('previous');
    expect(redis.store[C.teacherActivityKey(U(3))]).toBeTruthy();
    expect(redis.store[C.TEAM_ACTIVITY_KEY]).toBeUndefined();
    expect(redis.store[C.runMarkerKey('2026-11-19', 'day')]).toBeUndefined();
  });

  test('the teacher list cannot be read → read_failed, nothing written', async () => {
    const redis = fakeRedis();
    const db = fakeDb();
    db.rpc = async (name) => (name === 'db_is_replica' ? { data: true, error: null } : { data: null, error: { message: 'boom' } });
    await expect(Run.run(deps({ redis, db }))).resolves.toMatchObject({ outcome: 'read_failed' });
    expect(redis.sets).toHaveLength(0);
  });

  test('the slots cannot be read → off (fail closed)', async () => {
    const db = fakeDb();
    db.from = () => { throw new Error('socket hang up'); };
    await expect(Run.run(deps({ db }))).resolves.toEqual({ outcome: 'off', reason: 'no_slots' });
  });

  test('never throws', async () => {
    const redis = fakeRedis();
    redis.set = async () => { throw new Error('READONLY'); };
    await expect(Run.run(deps({ redis }))).resolves.toMatchObject({ outcome: 'error' });
  });
});
