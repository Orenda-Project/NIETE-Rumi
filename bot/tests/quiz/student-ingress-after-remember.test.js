'use strict';
/**
 * A child we have just remembered is a child at the door straight away.
 *
 * The door (student-ingress classify) caches its verdict per handset for 10
 * minutes. A new child's first message is decided "unknown" (no students row
 * yet); then the quiz remembers them (StudentIdentity.remember writes the row).
 * Without dropping that cached "unknown", the child's /quiz within the next 10
 * minutes was routed as a teacher's. Real ingress, real student identity, real
 * student mode; Supabase (an in-memory students table) and Redis (a Map) are
 * the faked boundaries.
 */
process.env.STUDENT_MODE_ENABLED = 'true';

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    get: jest.fn(async (k) => (keys.has(k) ? keys.get(k) : null)),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
  };
});
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const Ingress = require('../../shared/services/student-ingress');
const StudentIdentity = require('../../shared/services/quiz/student-identity.service');

const PHONE = '920000000417';
const USER = { id: 'u-new', registration_completed: false, registration_state: 'unregistered', name: null,
  teacher_uuid: null, school_id: null, portal_activated: false, role: 'teacher' };

let students;
function stub() {
  supabase.from.mockImplementation((table) => {
    const chain = {
      _filters: [],
      select: (cols, opts) => { chain._head = Boolean(opts && opts.head); return chain; },
      eq: (c, v) => { chain._filters.push([c, v]); return chain; },
      is: () => chain, in: () => chain, or: () => chain, order: () => chain, limit: () => chain, not: () => chain, gte: () => chain,
      insert: (row) => { chain._insert = { id: `st-${students.length + 1}`, ...row }; return chain; },
      single: async () => {
        if (table === 'students' && chain._insert) { students.push(chain._insert); return { data: chain._insert, error: null }; }
        return { data: null, error: null };
      },
      maybeSingle: async () => ({ data: table === 'users' ? USER : null, error: null }),
      then: (resolve) => {
        if (chain._head) return resolve({ count: 0, error: null });
        if (table === 'students') {
          const phone = (chain._filters.find(([c]) => c === 'phone') || [])[1];
          return resolve({ data: students.filter((s) => !phone || s.phone === phone), error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return chain;
  });
}

beforeEach(() => {
  students = [];
  redisService.__keys.clear();
  stub();
});

test('decide (unknown) → remember → decide: the second verdict is the child, not the cached unknown', async () => {
  const first = await Ingress.classify({ user: USER, phone: PHONE });
  expect(first).toMatchObject({ mode: 'unknown', reason: 'no_student_row' });
  expect(redisService.__keys.has(Ingress.CACHE_KEY(PHONE))).toBe(true);

  const row = await StudentIdentity.remember({ phone: PHONE, name: 'Kamran Testwala', className: '3' });
  expect(row).toBeTruthy();

  const second = await Ingress.classify({ user: USER, phone: PHONE });
  expect(second).toMatchObject({ persona: 'student', mode: 'student' });
});

test('the same with a "+" on the phone: the cache key the door used is the one dropped', async () => {
  await Ingress.classify({ user: USER, phone: `+${PHONE}` });
  await StudentIdentity.remember({ phone: PHONE, name: 'Kamran Testwala', className: '3' });
  expect(redisService.__keys.has(Ingress.CACHE_KEY(`+${PHONE}`))).toBe(false);
});

test('a failed remember (no row written) leaves the cached verdict alone', async () => {
  await Ingress.classify({ user: USER, phone: PHONE });
  expect(await StudentIdentity.remember({ phone: PHONE, name: '' })).toBeNull();
  expect(redisService.__keys.has(Ingress.CACHE_KEY(PHONE))).toBe(true);
});
