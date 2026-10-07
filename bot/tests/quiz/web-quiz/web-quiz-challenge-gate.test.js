'use strict';
/**
 * The Challenge's rollout gate: app_settings `web_quiz_challenge` takes the same shapes as `web_quiz_teachers`
 * (true/false, "all", or a list of TEACHER user ids), so production can run a canary. A child is offered the
 * Challenge when one of their teachers is in scope: the quiz's teacher, the class list's teacher, a class teacher
 * (class_teachers), or the teacher of a code they played.
 *
 * Faked boundaries only (Supabase in memory, R2, logger); the challenge service, its gate and tokens run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 1000 })),
  presignKey: jest.fn(async () => null),
  uploadBuffer: jest.fn(async () => 'ok'),
  deleteKey: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
const Gate = require('../../../shared/services/quiz/web-quiz-challenge-gate');

const KID = '44444444-4444-4444-8444-444444444444';   // list teacher T_LIST
const LOOSE = '77777777-7777-4777-8777-777777777777'; // no list; played a code of T_CODE
const ENR = '88888888-8888-4888-8888-888888888888';   // enrolled in a class taught by T_CLASS
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const SC = '33333333-3333-4333-8333-333333333333';
const SESSION = '66666666-6666-4666-8666-666666666666';
const T_LIST = '11111111-1111-4111-8111-000000000001';
const T_CODE = '11111111-1111-4111-8111-000000000002';
const T_CLASS = '11111111-1111-4111-8111-000000000003';
const T_OUT = '11111111-1111-4111-8111-000000000009';

function seed(flag) {
  const db = {
    app_settings: flag === undefined ? [] : [{ key: 'web_quiz_challenge', value: flag }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: T_LIST, is_active: true }],
    students: [
      { id: KID, list_id: LIST },
      { id: LOOSE, list_id: null, self_reported_class: '4' },
      { id: ENR, list_id: null },
    ],
    class_enrollments: [{ id: 'e1', class_id: 'c1', student_id: ENR, is_active: true }],
    classes: [{ id: 'c1', grade_code: 'grade_5' }],
    class_teachers: [{ class_id: 'c1', teacher_user_id: T_CLASS, is_active: true }],
    quiz_share_codes: [{ id: SC, language: 'en', teacher_user_id: T_CODE }],
    quiz_sessions: [{ id: SESSION, student_id: LOOSE, share_code_id: SC, quiz_id: 'q1', created_at: new Date().toISOString() }],
    web_quiz_challenge_runs: [],
  };
  Object.assign(supabase, makeFake(db));
  Ch.__reset();
  Gate._resetCache();
}
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; });

const hub = (id) => T.signHub([id]);
const opens = async (id) => {
  try { await Ch.menu(hub(id)); return true; } catch (e) {
    if (e.status === 503 && e.body && e.body.error === 'challenge_off') return false;
    throw e;
  }
};

describe('the flag shapes', () => {
  test.each([
    [true, true], ['true', true], ['all', true], ['"all"', true], [' ALL ', true],
    [false, false], ['false', false], [undefined, false], [null, false], ['no', false], [[], false], ['[]', false],
  ])('%p → offered to every child in scope: %p', async (flag, on) => {
    seed(flag);
    expect(await opens(KID)).toBe(on);
    expect(await opens(LOOSE)).toBe(on);
  });

  test('a list of teacher ids (array or JSON string): only children of those teachers', async () => {
    seed([T_LIST]);
    expect(await opens(KID)).toBe(true);    // the class list's teacher
    expect(await opens(LOOSE)).toBe(false);
    expect(await opens(ENR)).toBe(false);
    seed(JSON.stringify([T_CODE, T_CLASS]));
    expect(await opens(KID)).toBe(false);
    expect(await opens(LOOSE)).toBe(true);  // played a code of a listed teacher
    expect(await opens(ENR)).toBe(true);    // enrolled in a listed teacher's class
    seed([T_OUT]);
    expect(await opens(KID)).toBe(false);
  });

  test('a quiz session token is in scope through ITS quiz\'s teacher', async () => {
    seed([T_CODE]);
    const st = T.signSession({ sessionId: SESSION, deviceRef: 'd'.repeat(22), shareCodeId: SC });
    await expect(Ch.menu(st)).resolves.toMatchObject({ exercises: expect.any(Array) });
  });

  test('an exercise is refused out of scope, as the menu is', async () => {
    seed([T_OUT]);
    await expect(Ch.exercise(hub(KID), 'bigger')).rejects.toMatchObject({ status: 503, body: { error: 'challenge_off' } });
    seed([T_LIST]);
    await expect(Ch.exercise(hub(KID), 'bigger')).resolves.toMatchObject({ ex: 'bigger' });
  });

  test('a read error is off (fails closed) and is not cached', async () => {
    seed([T_LIST]);
    const real = supabase.from;
    supabase.from = (t) => (t === 'app_settings' ? { select: () => ({ eq: async () => ({ data: null, error: { message: 'down' } }) }) } : real(t));
    expect(await opens(KID)).toBe(false);
    supabase.from = real;
    expect(await opens(KID)).toBe(true);
  });
});
