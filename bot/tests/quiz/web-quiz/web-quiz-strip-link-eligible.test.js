'use strict';
/**
 * D5's denominator, "link-eligible classes", defined once on the strip (classes_link_eligible): an active class with
 * an active class_teachers row AND at least one active class_enrollments row — the class-link mint's own rule
 * (web-quiz-class-link.js teachesEnrolled, which refuses 'not_your_class' / 'no_roster' otherwise). The bulk count
 * must agree with the mint class by class, so the two can never drift. Counts only.
 * Faked boundaries only: Supabase (the in-memory fake that applies filters), the logger, Redis.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: jest.fn(() => false), scanValues: jest.fn(async () => null) }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Strip = require('../../../shared/services/quiz/web-quiz-strip');

const T1 = 'teacher-1'; const T2 = 'teacher-2';
// c-ok: taught + enrolled; c-noenr: taught, nobody enrolled; c-noct: enrolled, no teacher; c-oldct: the teacher row
// inactive; c-oldenr: only an inactive enrolment; c-closed: the class itself inactive; c-two: two teachers (counted once)
const db0 = () => ({
  classes: ['c-ok', 'c-noenr', 'c-noct', 'c-oldct', 'c-oldenr', 'c-two'].map((id) => ({ id, is_active: true }))
    .concat([{ id: 'c-closed', is_active: false }]),
  class_teachers: [
    { class_id: 'c-ok', teacher_user_id: T1, is_active: true }, { class_id: 'c-noenr', teacher_user_id: T1, is_active: true },
    { class_id: 'c-oldct', teacher_user_id: T1, is_active: false }, { class_id: 'c-oldenr', teacher_user_id: T1, is_active: true },
    { class_id: 'c-closed', teacher_user_id: T1, is_active: true },
    { class_id: 'c-two', teacher_user_id: T1, is_active: true }, { class_id: 'c-two', teacher_user_id: T2, is_active: true },
  ],
  class_enrollments: [
    { class_id: 'c-ok', student_id: 's1', is_active: true }, { class_id: 'c-noct', student_id: 's2', is_active: true },
    { class_id: 'c-oldct', student_id: 's3', is_active: true }, { class_id: 'c-oldenr', student_id: 's4', is_active: false },
    { class_id: 'c-closed', student_id: 's5', is_active: true }, { class_id: 'c-two', student_id: 's6', is_active: true },
    { class_id: 'c-two', student_id: 's7', is_active: true },
  ],
});
const install = (db) => { Object.assign(supabase, makeFake(db)); return db; };

test('the bulk count: active classes with an active teacher row and an active enrolment; n = active classes', async () => {
  install(db0());
  await expect(Strip.linkEligibleClasses()).resolves.toEqual({ eligible: 2, active: 6 });
});

test('it agrees with the mint (teachesEnrolled through mint) on every class and teacher', async () => {
  const db = install(db0());
  const CL = require('../../../shared/services/quiz/web-quiz-class-link');
  const viaMint = new Set();
  for (const c of db.classes) {
    for (const t of [T1, T2]) {
      install(db0());   // a fresh copy: mint writes a link row when it is allowed
      const out = await CL.mint({ teacherId: t, classId: c.id, now: new Date('2026-10-15T06:00:00Z') });
      if (out.ok || out.reason === 'store_failed') viaMint.add(c.id);
    }
  }
  install(db0());
  expect((await Strip.linkEligibleClasses()).eligible).toBe(viaMint.size);
  expect([...viaMint].sort()).toEqual(['c-ok', 'c-two']);
});

test('a table that cannot be read (not there yet): null (the line is skipped), never a throw', async () => {
  install(db0());
  const real = supabase.from;
  const missing = { data: null, error: { code: '42P01', message: 'relation "class_enrollments" does not exist' } };
  const dead = () => { const q = { select: () => q, eq: () => q, gt: () => q, order: () => q, limit: () => q, then: (res) => Promise.resolve(missing).then(res) }; return q; };
  supabase.from = (t) => (t === 'class_enrollments' ? dead() : real(t));
  try {
    await expect(Strip.linkEligibleClasses()).resolves.toBeNull();
  } finally { supabase.from = real; }
});
