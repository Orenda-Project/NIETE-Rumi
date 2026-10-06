'use strict';
/**
 * finish() on a video quiz names the next lesson ("Next in this chapter"): the video after this one
 * in the Flow's order, in the same grade and subject, that this child has not finished. Supabase, the S3 SDK's send (R2) and fetch are the boundaries
 * and are faked; every first-party module on the path runs for real.
 */
process.env.R2_ENDPOINT = 'https://acct.r2.example.com';
process.env.R2_ACCESS_KEY_ID = 'test-only';
process.env.R2_SECRET_ACCESS_KEY = 'test-only';
process.env.R2_BUCKET_NAME = 'test-bucket';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation((cfg) => {
      const real = new actual.S3Client(cfg);
      real.send = (...a) => mockS3Send(...a);
      return real;
    }),
  };
});

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Bank = require('../../../shared/services/quiz/web-quiz-bank');
const Flag = require('../../../shared/services/quiz/web-quiz-library-flag');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const KID_A = '44444444-4444-4444-8444-444444444444';
const V = (n) => `aaaaaa${String(n).padStart(2, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const VQ = (n) => `bbbbbb${String(n).padStart(2, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();


let fake;
const Q1 = (v) => `cccccc${String(v).padStart(2, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
function seed({ flag = true, done = [] } = {}) {
  const vrow = (n, chapter, title, extra = {}) => ({ id: V(n), grade: '3', subject: 'Science', clean_chapter: chapter, clean_title: title,
    migration_status: 'done', superseded_by: null, r2_url: `https://acct.r2.example.com/test-bucket/student-videos/v${n}.mp4`, ...extra });
  const vquiz = (n) => ({ id: VQ(n), video_id: V(n), quiz_source: 'video', status: 'ready', topic: `Video quiz ${n}`, grade: '3', subject: 'Science', language: 'en', meta: null });
  fake = makeFake({
    app_settings: flag ? [{ key: 'web_quiz_library', value: true }] : [],
    student_videos: [
      vrow(1, 'Plants', 'A seed grows'), vrow(2, 'Plants', 'Leaves'), vrow(3, 'Plants', 'Roots'),
      vrow(4, 'Water', 'Rain'), vrow(5, 'Animals', 'Hens'), vrow(6, 'Plants', 'Not migrated', { migration_status: 'pending' }),
      { ...vrow(7, 'Plants', 'Maths one'), subject: 'Maths' },
    ],
    quizzes: [1, 2, 3, 4, 5, 6, 7].map(vquiz).concat([{ id: QUIZ, topic: 'Lesson', grade: '3', subject: 'science', quiz_source: 'transcript', video_id: null }]),
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, language: 'en', active: true, expires_at: future,
        invited_by_student_id: null, parent_share_code_id: null, created_at: ago(30) },
      { id: 'sc-v2', code: 'VID002', quiz_id: VQ(2), video_id: V(2), teacher_user_id: TEACHER, language: 'en', active: true, expires_at: future,
        invited_by_student_id: null, parent_share_code_id: SC, created_at: ago(3) },
      { id: 'sc-v3', code: 'VID003', quiz_id: VQ(3), video_id: V(3), teacher_user_id: TEACHER, language: 'en', active: true, expires_at: future,
        invited_by_student_id: null, parent_share_code_id: SC, created_at: ago(3) },
    ],
    quiz_questions: [1, 2].map((n) => ({ id: Q1(n), quiz_id: VQ(2), external_id: `q${n}`, sort_order: n, question_text: `Q${n}`,
      option_a: 'A', option_b: 'B', option_c: null, option_d: null, correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null })),
    quiz_sessions: [
      { id: 's-v2', quiz_id: VQ(2), share_code_id: 'sc-v2', student_id: KID_A, status: 'in_progress', user_id: null, created_at: ago(0.1), device_ref: 'd1' },
      ...done.map((n, i) => ({ id: `s-d${i}`, quiz_id: VQ(n), share_code_id: SC, student_id: KID_A, status: 'completed', completed_at: ago(5), created_at: ago(5) })),
    ],
    quiz_answers: [1, 2].map((n) => ({ session_id: 's-v2', question_id: Q1(n), selected_option: 'A', is_correct: true })),
    students: [{ id: KID_A, student_name: 'Zara Testwala' }],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
const st = () => T.signSession({ sessionId: 's-v2', deviceRef: 'd1', shareCodeId: 'sc-v2' });

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  jest.clearAllMocks();
  Bank._reset();
  Flag._reset();
  mockS3Send.mockImplementation(async () => ({}));
});
afterAll(() => { process.env = SAVED; });

test('the next video in the same chapter, with its poster and the class\'s code', async () => {
  seed();
  const out = await WQ.finishSession({ st: st() });
  expect(out.next).toEqual({ vid: V(3), title: 'Roots', chapter: 'Plants', subject: 'Science', grade: '3', code: 'VID003',
    poster: expect.stringMatching(/v3_poster\.jpg\?.*X-Amz-Signature=/) });
});

test('finished lessons are skipped; past the chapter\'s end, the next chapter\'s first unfinished one (Flow order)', async () => {
  seed({ done: [3] });
  expect((await WQ.finishSession({ st: st() })).next).toMatchObject({ vid: V(4), title: 'Rain', chapter: 'Water' });
  Bank._reset(); seed({ done: [3, 4] });
  // "animals" sorts before "plants": nothing is left after Water, so it wraps to the first unfinished one
  expect((await WQ.finishSession({ st: st() })).next).toMatchObject({ vid: V(5), chapter: 'Animals' });
});

test('nothing left in the subject and grade: no next; a lesson quiz: no next; library off: the payload is today\'s', async () => {
  seed({ done: [1, 3, 4, 5] });
  expect((await WQ.finishSession({ st: st() })).next).toBeUndefined();
  Bank._reset(); Flag._reset(); seed({ flag: false });
  expect((await WQ.finishSession({ st: st() })).next).toBeUndefined();
});
