'use strict';
/**
 * The portal's reader of the teacher activity store (dashboard/services/teacher-activity-store.js,
 * docs/teacher-activity-store.md): Redis only, through lib/edge-redis.js. Zero database access, ever. Fails soft:
 * no client, Redis down, a miss, bad JSON, a malformed or stale value → null.
 *
 * Mocked at the network edge: a fake Redis client handed to edge-redis, as index.js hands it the real one.
 */
let mockDbTouched = 0;
let mockDbLoaded = 0;
const mockTrap = () => {
  mockDbLoaded += 1;
  return new Proxy({}, { get: () => { mockDbTouched += 1; throw new Error('database touched'); } });
};
jest.mock('../../dashboard/config/supabase', () => mockTrap());
jest.mock('../../bot/shared/config/supabase', () => mockTrap());

const EdgeRedis = require('../../dashboard/lib/edge-redis');
const Store = require('../../dashboard/services/teacher-activity-store');

const UID = '0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

const teacher = (over = {}) => ({
  updated_at: iso(2 * 3600 * 1000),
  slot: 'night',
  tiles: {
    plans_opened: { now: 14, prev: 9 },
    taught: { now: 3, prev: 1 },
    coached: { now: 2, prev: 2 },
    quizzes: { now: 4, prev: 0 },
    exams: { now: 1, prev: 0 },
  },
  trend: [],
  tip: null,
  journey: [{ kind: 'plan_opened', at: iso(86400000), ref_id: 'L03', meta: { plan_kind: 'k5' } }],
  furthest_step: 'plan_opened',
  grade_band: 'k5',
  ...over,
});
const team = () => ({ updated_at: iso(3600 * 1000), window_days: 30, steps: { none: { count: 1, user_ids: [UID] } } });

let store;
let gets;
function fakeClient({ down = false, ready = true } = {}) {
  return {
    isReady: ready,
    get: async (key) => {
      gets.push(key);
      if (down) throw new Error('ECONNREFUSED');
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
  };
}

let warn;
beforeEach(() => {
  store = {};
  gets = [];
  mockDbTouched = 0;
  EdgeRedis.setClient(fakeClient());
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  EdgeRedis.setClient(null);
  warn.mockRestore();
  expect(mockDbTouched).toBe(0);
});

describe('readTeacherActivity', () => {
  test('a stored, fresh, well-formed value comes back parsed, from her key', async () => {
    store[`teacher_activity:v1:${UID}`] = JSON.stringify(teacher());
    expect(await Store.readTeacherActivity(UID)).toEqual(teacher({ updated_at: expect.any(String), journey: expect.any(Array) }));
    expect(gets).toEqual([`teacher_activity:v1:${UID}`]);
  });

  test('a miss → null', async () => {
    expect(await Store.readTeacherActivity(UID)).toBe(null);
  });

  test('bad JSON, a malformed value or a stale one → null, with a warning that names no user', async () => {
    for (const raw of ['{oops', JSON.stringify({ hello: 1 }), JSON.stringify(teacher({ updated_at: iso(37 * 3600 * 1000) }))]) {
      store[`teacher_activity:v1:${UID}`] = raw;
      // eslint-disable-next-line no-await-in-loop
      expect(await Store.readTeacherActivity(UID)).toBe(null);
    }
    for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toContain(UID);
  });

  test('Redis down, not ready, or no client → null', async () => {
    store[`teacher_activity:v1:${UID}`] = JSON.stringify(teacher());
    EdgeRedis.setClient(fakeClient({ down: true }));
    expect(await Store.readTeacherActivity(UID)).toBe(null);
    EdgeRedis.setClient(fakeClient({ ready: false }));
    expect(await Store.readTeacherActivity(UID)).toBe(null);
    EdgeRedis.setClient(null);
    expect(await Store.readTeacherActivity(UID)).toBe(null);
  });

  test('no user, or an id that is not a users.id → null with no Redis call (never the team or a run key)', async () => {
    for (const bad of [null, undefined, '', 'team', 'run:2026-11-19:day', 42]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await Store.readTeacherActivity(bad)).toBe(null);
    }
    expect(gets).toEqual([]);
  });
});

describe('readTeamActivity', () => {
  test('the team key, parsed', async () => {
    // One fixture for both sides: team() reads the clock, so two calls can differ by 1 ms (bd-nq58zg.2).
    const stored = team();
    store['teacher_activity:v1:team'] = JSON.stringify(stored);
    expect(await Store.readTeamActivity()).toEqual(stored);
    expect(gets).toEqual(['teacher_activity:v1:team']);
  });

  test('a miss, bad JSON, a malformed value, or Redis down → null', async () => {
    expect(await Store.readTeamActivity()).toBe(null);
    store['teacher_activity:v1:team'] = '[1,2';
    expect(await Store.readTeamActivity()).toBe(null);
    store['teacher_activity:v1:team'] = JSON.stringify({ ...team(), steps: { none: { count: 'x', user_ids: [] } } });
    expect(await Store.readTeamActivity()).toBe(null);
    EdgeRedis.setClient(fakeClient({ down: true }));
    expect(await Store.readTeamActivity()).toBe(null);
  });
});

test('the module never touches a database client: none is even loaded', () => {
  // Both database clients in reach are traps (above): afterEach checks no property of either was read, and here, that
  // neither module was ever required by the store's require tree.
  expect(mockDbLoaded).toBe(0);
});
