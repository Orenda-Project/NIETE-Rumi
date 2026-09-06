/**
 * PLAN_R5 D8 — the student-mode decision, on its own.
 *
 * Every rule here is written to fail towards "teacher", because the two errors
 * are not symmetrical: a wrong "student" costs a child's teacher one oddly
 * pitched reply, and a wrong "teacher" costs nothing at all — it is exactly
 * what the bot does today. These tests exist to hold that asymmetry in place.
 *
 * The escape-hatch matcher gets the most attention because it is the one place
 * a naive implementation does real damage: matching the bare substring
 * "teacher" would retire the identity row of every child who writes "my teacher
 * said", costing them their remembered name (student-identity `findByPhone`
 * filters `is_active`) and dropping them off their teacher's enrolled roster
 * (`findByTeacher`, same filter).
 */

const SM = require('../../bot/shared/services/student-mode.service');

const CHILD_ROW = { id: 's1', student_name: 'x', self_reported_class: 'Class 5', is_active: true };
const NOW = new Date('2026-09-06T10:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe('decide() — a registered teacher is a teacher, always', () => {
  test('registration_completed wins even with an active child row and a quiz today', () => {
    expect(SM.decide({
      user: { id: 'u1', registration_completed: true },
      students: [CHILD_ROW], lastSessionAt: daysAgo(0), now: NOW, flag: true,
    })).toEqual({ mode: 'teacher', reason: 'registered_teacher' });
  });

  test("registration_state 'completed' wins the same way", () => {
    expect(SM.decide({
      user: { id: 'u1', registration_state: 'completed' },
      students: [CHILD_ROW], lastSessionAt: daysAgo(1), now: NOW, flag: true,
    }).mode).toBe('teacher');
  });

  test('a half-registered user is not yet a teacher, but is not a student either without evidence', () => {
    expect(SM.decide({
      user: { id: 'u1', registration_state: 'awaiting_name' },
      students: [], lastSessionAt: null, now: NOW, flag: true,
    })).toEqual({ mode: 'unknown', reason: 'no_student_row' });
  });
});

/**
 * bd-mg9c7.88 — THE SHAPE THAT BROKE IT LIVE.
 *
 * The account that proved rule 2 is not enough is an ordinary one: a teacher
 * who never finished the registration Flow. `registration_completed = false`,
 * `registration_state = 'unregistered'` — so `isRegisteredTeacher()` is false —
 * yet she has a name on her row, owns six quizzes as `teacher_id`, has dozens
 * of coaching sessions, and her handset carries five active quiz-joined
 * `students` rows because she joined her own class links to check them before
 * the self-test path existed. `decide()` called her a student.
 *
 * The recovery-registration branch in text-message.handler.js (~L2262-2290)
 * exists precisely because users of this shape are common: they use features
 * for months without ever completing registration.
 *
 * So registration is now ONE of five teacher signals, any of which is decisive,
 * and all of which are weighed before a single row about a child is read.
 */
describe('decide() — teacher signals are weighed before anything about children', () => {
  const UNREGISTERED_TEACHER = {
    id: 'u-t1', first_name: 'Amina',
    registration_completed: false, registration_state: 'unregistered',
  };
  const LIVE_SIGNALS = {
    registered: false, hasName: true, ownsQuizzes: true, hasCoaching: true, usedFeatures: true,
  };
  const FIVE_CHILD_ROWS = Array.from({ length: 5 }, (_, i) => ({ ...CHILD_ROW, id: `s${i}` }));

  test('the live shape — unregistered, named, owns quizzes, 5 child rows, a quiz today — is a TEACHER', () => {
    expect(SM.decide({
      user: UNREGISTERED_TEACHER,
      teacherSignals: LIVE_SIGNALS,
      students: FIVE_CHILD_ROWS,
      lastSessionAt: daysAgo(0),
      now: NOW,
      flag: true,
    })).toEqual({ mode: 'teacher', reason: 'hasName' });
  });

  test.each([
    ['hasName', { hasName: true }],
    ['ownsQuizzes', { ownsQuizzes: true }],
    ['hasCoaching', { hasCoaching: true }],
    ['usedFeatures', { usedFeatures: true }],
  ])('%s ALONE flips a textbook child handset to teacher', (reason, signal) => {
    expect(SM.decide({
      user: { id: 'u-bare' },
      teacherSignals: signal,
      students: [CHILD_ROW], lastSessionAt: daysAgo(1), now: NOW, flag: true,
    })).toEqual({ mode: 'teacher', reason });
  });

  test('registration still wins first, and keeps its old reason string', () => {
    expect(SM.decide({
      user: { id: 'u1', registration_completed: true },
      teacherSignals: { ownsQuizzes: true },
      students: [CHILD_ROW], lastSessionAt: daysAgo(0), now: NOW, flag: true,
    })).toEqual({ mode: 'teacher', reason: 'registered_teacher' });
  });

  test('a name on the users row is a signal even when the caller passes no signals at all', () => {
    // Every caller must get this protection, including one written before the
    // signals existed. `first_name` is set by the registration Flow AND by the
    // recovery path, so a named row is a teacher whatever else is true.
    expect(SM.decide({
      user: UNREGISTERED_TEACHER,
      students: FIVE_CHILD_ROWS, lastSessionAt: daysAgo(0), now: NOW, flag: true,
    })).toEqual({ mode: 'teacher', reason: 'hasName' });
  });

  test('a whitespace-only first_name is not a name', () => {
    expect(SM.decide({
      user: { id: 'u2', first_name: '   ' },
      students: [CHILD_ROW], lastSessionAt: daysAgo(1), now: NOW, flag: true,
    })).toEqual({ mode: 'student', reason: 'active_student_recent_quiz' });
  });

  test('a bare users row with a child row and a recent quiz is STILL a student', () => {
    // The fix must not swallow the feature it protects.
    expect(SM.decide({
      user: { id: 'u-child', first_name: null, registration_completed: false },
      teacherSignals: {
        registered: false, hasName: false, ownsQuizzes: false, hasCoaching: false, usedFeatures: false,
      },
      students: [CHILD_ROW], lastSessionAt: daysAgo(2), now: NOW, flag: true,
    })).toEqual({ mode: 'student', reason: 'active_student_recent_quiz' });
  });

  test('a signal lookup that failed is read as a teacher, never as a child', () => {
    expect(SM.decide({
      user: { id: 'u3' },
      teacherSignals: { lookupFailed: true },
      students: [CHILD_ROW], lastSessionAt: daysAgo(1), now: NOW, flag: true,
    })).toEqual({ mode: 'teacher', reason: 'signal_lookup_failed' });
  });

  test('the flag still comes first — signals are not even considered when it is off', () => {
    expect(SM.decide({
      user: UNREGISTERED_TEACHER, teacherSignals: LIVE_SIGNALS,
      students: FIVE_CHILD_ROWS, lastSessionAt: daysAgo(0), now: NOW, flag: false,
    })).toEqual({ mode: 'unknown', reason: 'flag_off' });
  });
});

describe('decide() — student needs positive evidence on both sides', () => {
  test('an active child row plus a quiz inside the window', () => {
    expect(SM.decide({
      user: { id: 'u9' }, students: [CHILD_ROW], lastSessionAt: daysAgo(3), now: NOW, flag: true,
    })).toEqual({ mode: 'student', reason: 'active_student_recent_quiz' });
  });

  test('no child row at all → unknown, which is today’s behaviour', () => {
    expect(SM.decide({ user: {}, students: [], lastSessionAt: daysAgo(1), now: NOW, flag: true }))
      .toEqual({ mode: 'unknown', reason: 'no_student_row' });
  });

  test('a child row but no quiz session ever → unknown', () => {
    expect(SM.decide({ user: {}, students: [CHILD_ROW], lastSessionAt: null, now: NOW, flag: true }))
      .toEqual({ mode: 'unknown', reason: 'no_quiz_session' });
  });

  test(`a quiz older than ${SM.WINDOW_DAYS} days → unknown (the mode expires by itself)`, () => {
    expect(SM.decide({
      user: {}, students: [CHILD_ROW], lastSessionAt: daysAgo(SM.WINDOW_DAYS + 1), now: NOW, flag: true,
    })).toEqual({ mode: 'unknown', reason: 'quiz_session_stale' });
  });

  test('exactly at the window edge is still a student', () => {
    expect(SM.decide({
      user: {}, students: [CHILD_ROW], lastSessionAt: daysAgo(SM.WINDOW_DAYS), now: NOW, flag: true,
    }).mode).toBe('student');
  });

  test('an inactive row is not evidence', () => {
    expect(SM.decide({
      user: {}, students: [{ ...CHILD_ROW, is_active: false }],
      lastSessionAt: daysAgo(1), now: NOW, flag: true,
    })).toEqual({ mode: 'unknown', reason: 'no_student_row' });
  });

  test('an unreadable date is not evidence', () => {
    expect(SM.decide({
      user: {}, students: [CHILD_ROW], lastSessionAt: 'not-a-date', now: NOW, flag: true,
    })).toEqual({ mode: 'unknown', reason: 'unreadable_session_date' });
  });

  test('a future timestamp is clock skew, not a stale row', () => {
    expect(SM.decide({
      user: {}, students: [CHILD_ROW],
      lastSessionAt: new Date(NOW.getTime() + 60000).toISOString(), now: NOW, flag: true,
    }).mode).toBe('student');
  });
});

describe('decide() — the flag is the kill switch', () => {
  test('off means unknown even for a textbook child', () => {
    expect(SM.decide({
      user: {}, students: [CHILD_ROW], lastSessionAt: daysAgo(1), now: NOW, flag: false,
    })).toEqual({ mode: 'unknown', reason: 'flag_off' });
  });

  test('isEnabled: unset is off, "false" is off, only "true" is on', () => {
    expect(SM.isEnabled({})).toBe(false);
    expect(SM.isEnabled({ STUDENT_MODE_ENABLED: '' })).toBe(false);
    expect(SM.isEnabled({ STUDENT_MODE_ENABLED: 'false' })).toBe(false);
    expect(SM.isEnabled({ STUDENT_MODE_ENABLED: '1' })).toBe(false);
    expect(SM.isEnabled({ STUDENT_MODE_ENABLED: 'true' })).toBe(true);
    expect(SM.isEnabled({ STUDENT_MODE_ENABLED: ' TRUE ' })).toBe(true);
  });
});

describe('looksLikeTeacherClaim() — anchored, never a bare substring', () => {
  test.each([
    'I am a teacher',
    "i'm a teacher",
    'im teacher',
    'I am the teacher of this class',
    'this is the teacher',
    'teacher here',
    'teacher',
    'Teacher.',
    'میں استاد ہوں',
    'میں ایک ٹیچر ہوں',
    'ٹیچر ہوں',
    'استاد',
    'register',
    'I want to sign up',
    'رجسٹر',
    '/menu',
    '/quiz',
  ])('claims to be a teacher: %j', (msg) => {
    expect(SM.looksLikeTeacherClaim(msg)).toBe(true);
  });

  test.each([
    'my teacher said photosynthesis is how plants eat',
    'ask my teacher',
    'the teacher gave us homework',
    'میرے استاد نے کہا',
    'ہمارے ٹیچر نے سبق پڑھایا',
    'what is a fraction?',
    'i didnt understand question 4',
    '',
    null,
    undefined,
  ])('is NOT a claim: %j', (msg) => {
    expect(SM.looksLikeTeacherClaim(msg)).toBe(false);
  });
});
