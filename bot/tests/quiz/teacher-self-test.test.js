'use strict';
/**
 * PLAN_R5 §1 D8 — the pure marker helpers: a self-test session is one whose
 * `user_id` equals the teacher who owns the share code, and nothing else.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/student-identity.service', () => ({
  normalisePhone: (p) => {
    let d = String(p || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0')) d = `92${d.slice(1)}`;
    else if (d.startsWith('3') && d.length === 10) d = `92${d}`;
    return d.slice(0, 15);
  },
}));

const { installFrom } = require('../../../tests/quiz/helpers/supabase-chain');

const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const SelfTest = require('../../shared/services/quiz/teacher-self-test');

describe('isSelfTest', () => {
  test('a null teacherUserId is never a self-test', () => {
    expect(SelfTest.isSelfTest({ user_id: 'u1' }, null)).toBe(false);
    expect(SelfTest.isSelfTest({ user_id: 'u1' }, undefined)).toBe(false);
  });

  test('a child row (user_id: null) is never a self-test', () => {
    expect(SelfTest.isSelfTest({ user_id: null }, 'u1')).toBe(false);
  });

  test('a session with no teacherUserId to compare is never a self-test', () => {
    expect(SelfTest.isSelfTest(null, 'u1')).toBe(false);
  });

  test('a session whose user_id matches the teacher is a self-test', () => {
    expect(SelfTest.isSelfTest({ user_id: 'u1' }, 'u1')).toBe(true);
  });

  test('a session whose user_id belongs to a DIFFERENT registered user is not a self-test', () => {
    expect(SelfTest.isSelfTest({ user_id: 'u2' }, 'u1')).toBe(false);
  });
});

describe('excludeSelfTests', () => {
  const teacherId = 'u1';
  const rows = [
    { id: 's1', user_id: null },
    { id: 's2', user_id: 'u1' },
    { id: 's3', user_id: null },
  ];

  test('drops only the teacher self-test row', () => {
    const out = SelfTest.excludeSelfTests(rows, teacherId);
    expect(out.map((r) => r.id)).toEqual(['s1', 's3']);
  });

  test('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(rows));
    SelfTest.excludeSelfTests(rows, teacherId);
    expect(rows).toEqual(copy);
  });

  test('returns a NEW array, not the same reference', () => {
    const out = SelfTest.excludeSelfTests(rows, teacherId);
    expect(out).not.toBe(rows);
  });

  test('with no teacherUserId, nothing is excluded', () => {
    const out = SelfTest.excludeSelfTests(rows, null);
    expect(out).toHaveLength(3);
  });
});

describe('resolveSelfTest', () => {
  beforeEach(() => jest.clearAllMocks());

  function stubUser(user) {
    supabase.from.mockImplementation((table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (table === 'users' ? { data: user, error: null } : { data: null, error: null }),
        }),
      }),
    }));
  }

  test('recognises her phone in any of the three PK formats', async () => {
    stubUser({ id: 'u1', first_name: 'Ayesha', last_name: 'Khan', phone_number: '+923001234567' });
    const forms = ['+923001234567', '03001234567', '923001234567'];
    for (const phone of forms) {
      // eslint-disable-next-line no-await-in-loop
      const r = await SelfTest.resolveSelfTest({ phone, teacherUserId: 'u1' });
      expect(r).toEqual({ userId: 'u1', name: 'Ayesha Khan' });
    }
  });

  test('a child on the same share code (different phone) is not a match', async () => {
    stubUser({ id: 'u1', first_name: 'Ayesha', phone_number: '+923001234567' });
    const r = await SelfTest.resolveSelfTest({ phone: '923009999999', teacherUserId: 'u1' });
    expect(r).toBeNull();
  });

  test('a missing teacherUserId never queries and returns null', async () => {
    const r = await SelfTest.resolveSelfTest({ phone: '923001234567', teacherUserId: null });
    expect(r).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test('a lookup error fails OPEN (returns null, never throws)', async () => {
    supabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => { throw new Error('db down'); } }) }),
    }));
    await expect(SelfTest.resolveSelfTest({ phone: '923001234567', teacherUserId: 'u1' }))
      .resolves.toBeNull();
  });

  test('a teacher with no stored phone number fails OPEN', async () => {
    stubUser({ id: 'u1', first_name: 'Ayesha', phone_number: null });
    const r = await SelfTest.resolveSelfTest({ phone: '923001234567', teacherUserId: 'u1' });
    expect(r).toBeNull();
  });
});

/**
 * bd-mg9c7.88 residue — the operator's own handset carried five active
 * quiz-joined `students` rows from joining his own class links before this
 * self-test path existed. Recognising the self-test is not enough on its own
 * to stop student-mode.service reading those rows as evidence next time; this
 * is the retire half, wired at the one place a self-test is confirmed.
 */
describe('resolveSelfTest — retiring stray student rows on recognition', () => {
  beforeEach(() => jest.clearAllMocks());

  const TEACHER = { id: 'u1', first_name: 'Ayesha', last_name: 'Khan', phone_number: '+923001234567' };

  test('a recognised self-test retires the handset\'s quiz-joined student rows', async () => {
    installFrom(supabase.from, {
      users: { data: [TEACHER], error: null },
      students: { data: [{ id: 's-1' }, { id: 's-2' }], error: null },
    });

    const r = await SelfTest.resolveSelfTest({ phone: '923001234567', teacherUserId: 'u1' });

    expect(r).toEqual({ userId: 'u1', name: 'Ayesha Khan' });
    const calls = supabase.from.callsFor('students').flat();
    const update = calls.find((c) => c[0] === 'update');
    expect(update).toBeTruthy();
    expect(update[1]).toMatchObject({ is_active: false });
    expect(calls.some((c) => c[0] === 'is' && c[1] === 'list_id' && c[2] === null)).toBe(true);
    expect(logEvent).toHaveBeenCalledWith('video_quiz.self_test_rows_retired', { userId: 'u1', retired: 2 });
  });

  test('a phone that is NOT the teacher\'s retires nothing', async () => {
    installFrom(supabase.from, {
      users: { data: [TEACHER], error: null },
      students: { data: [{ id: 's-1' }], error: null },
    });

    const r = await SelfTest.resolveSelfTest({ phone: '923009999999', teacherUserId: 'u1' });

    expect(r).toBeNull();
    expect(supabase.from.callsFor('students')).toHaveLength(0);
  });

  test('an attendance-roster row is never touched', async () => {
    installFrom(supabase.from, {
      users: { data: [TEACHER], error: null },
      students: { data: [{ id: 's-1' }], error: null },
    });

    await SelfTest.resolveSelfTest({ phone: '923001234567', teacherUserId: 'u1' });

    const calls = supabase.from.callsFor('students').flat();
    expect(calls.some((c) => c[0] === 'is' && c[1] === 'list_id' && c[2] === null)).toBe(true);
  });

  test('a retire failure does not stop the self-test being recognised', async () => {
    installFrom(supabase.from, {
      users: { data: [TEACHER], error: null },
      students: { data: null, error: { message: 'connection reset' } },
    });

    const r = await SelfTest.resolveSelfTest({ phone: '923001234567', teacherUserId: 'u1' });

    expect(r).toEqual({ userId: 'u1', name: 'Ayesha Khan' });
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('a lookup miss (mismatched phone) never writes anything, and does not log', async () => {
    installFrom(supabase.from, {
      users: { data: [TEACHER], error: null },
      students: { data: [{ id: 's-1' }], error: null },
    });

    await SelfTest.resolveSelfTest({ phone: '923009999999', teacherUserId: 'u1' });

    expect(logEvent).not.toHaveBeenCalled();
  });
});

