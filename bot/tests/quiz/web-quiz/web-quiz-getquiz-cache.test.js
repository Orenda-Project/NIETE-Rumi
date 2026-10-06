'use strict';
/**
 * getQuiz's media cache: a lesson page opened twice within 5 minutes (prefetch, then the tap; or
 * a whole class opening the same link) presigns its media once. Supabase, the S3 SDK's send (R2) and fetch are the boundaries
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
function seed() {
  const vrow = (n) => ({ id: V(n), grade: '3', subject: 'Science', clean_chapter: 'Plants', clean_title: `Video ${n}`,
    migration_status: 'done', superseded_by: null, r2_url: `https://acct.r2.example.com/test-bucket/student-videos/v${n}.mp4` });
  const audio = { '99999991-9999-4999-8999-999999999991': { q: 'quiz-audio/q1.mp3', opts: ['quiz-audio/a.mp3', 'quiz-audio/b.mp3'], why: null } };
  const vquiz = (n) => ({ id: VQ(n), video_id: V(n), quiz_source: 'video', status: 'ready', topic: `Video quiz ${n}`, grade: '3',
    subject: 'Science', language: 'en', meta: { web: { audio } } });
  const code = (id, c, n) => ({ id, code: c, quiz_id: VQ(n), video_id: V(n), teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
    topic: 'Plants', language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(2) });
  fake = makeFake({
    quiz_share_codes: [code('sc-1', 'VID001', 1), code('sc-2', 'VID002', 2)],
    quizzes: [vquiz(1), vquiz(2)],
    student_videos: [vrow(1), vrow(2)],
    quiz_questions: [1, 2].flatMap((v) => [1, 2, 3].map((n) => ({
      id: `9999999${n}-9999-4999-8999-99999999999${v}`, quiz_id: VQ(v), external_id: `q${n}`, sort_order: n,
      question_text: `Question ${n}`, option_a: 'Egg', option_b: 'Chick', option_c: 'Hen', option_d: null,
      correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null,
    }))),
    quiz_sessions: [], students: [], app_settings: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const r2 = require('../../../shared/storage/r2');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const SAVED = { ...process.env };
let presign;
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  jest.clearAllMocks();
  WQ._resetQuizCache();
  mockS3Send.mockImplementation(async () => ({ ContentLength: 3170403, ContentType: 'video/mp4' }));
  presign = jest.spyOn(r2, 'getPresignedUrl');
  seed();
});
afterEach(() => presign.mockRestore());
afterAll(() => { process.env = SAVED; });

test('a second getQuiz of the same code within 5 minutes signs nothing and asks R2 nothing; the payload is the same', async () => {
  const a = await WQ.getQuiz('VID001');
  const signed = presign.mock.calls.length;
  const r2calls = mockS3Send.mock.calls.length;
  expect(signed).toBeGreaterThan(0);
  expect(a.video && a.video.url).toMatch(/X-Amz-Signature/);
  const b = await WQ.getQuiz('VID001');
  expect(presign.mock.calls.length).toBe(signed);
  expect(mockS3Send.mock.calls.length).toBe(r2calls);
  expect(b.video).toEqual(a.video);
  expect(b.quiz.questions[0].audio || null).toEqual(a.quiz.questions[0].audio || null);
});

test('another code signs its own media', async () => {
  await WQ.getQuiz('VID001');
  const signed = presign.mock.calls.length;
  await WQ.getQuiz('VID002');
  expect(presign.mock.calls.length).toBeGreaterThan(signed);
});

test('after 5 minutes the media are signed again', async () => {
  await WQ.getQuiz('VID001');
  const signed = presign.mock.calls.length;
  const now = Date.now();
  const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000 + 1);
  try {
    await WQ.getQuiz('VID001');
  } finally { spy.mockRestore(); }
  expect(presign.mock.calls.length).toBeGreaterThan(signed);
});

describe('library events and the video id on the lesson page', () => {
  test('more_timing, lib_view, lib_pick and video_download keep their ids and timings, nothing else', () => {
    expect(WQ.cleanEvent({ n: 'more_timing', list_ms: 312, nav_ms: 1800, ff_ms: 2900, src: 'mem', first: 'Zara' }))
      .toEqual({ name: 'more_timing', props: { list_ms: 312, nav_ms: 1800, ff_ms: 2900, src: 'mem' } });
    expect(WQ.cleanEvent({ n: 'lib_view', g: 'KG', s: 'General Knowledge', n_v: 3 }).props).toEqual({ g: 'KG', s: 'General Knowledge' });
    expect(WQ.cleanEvent({ n: 'lib_pick', vid: V(1), ch_i: 2 }).props).toEqual({ vid: V(1), ch_i: 2 });
    expect(WQ.cleanEvent({ n: 'video_download', vid: 'not a uuid <x>' }).props).toEqual({});
    expect(WQ.cleanEvent({ n: 'lib_view', g: '9', s: 'Zara Testwala 0300' }).props).toEqual({});
  });

  test('library on: the lesson\'s video carries its bank id (for Download); off: the payload is today\'s', async () => {
    const off = await WQ.getQuiz('VID001');
    expect(off.video.vid).toBeUndefined();
    WQ._resetQuizCache();
    require('../../../shared/services/quiz/web-quiz-library-flag')._reset();
    fake.db.app_settings.push({ key: 'web_quiz_library', value: true });
    const on = await WQ.getQuiz('VID001');
    expect(on.video.vid).toBe(V(1));
    expect(on.video.bytes).toBe(3170403);
  });
});

test('new clips in the quiz (the audio backfill) are signed at once, not served stale from the cache', async () => {
  const first = await WQ.getQuiz('VID001');
  fake.db.quizzes[0].meta = { web: { audio: { '99999991-9999-4999-8999-999999999991': { q: 'quiz-audio/q1-v2.mp3', opts: [], why: null } } } };
  const second = await WQ.getQuiz('VID001');
  expect(JSON.stringify(second.quiz.questions)).toContain('q1-v2.mp3');
  expect(JSON.stringify(first.quiz.questions)).not.toContain('q1-v2.mp3');
});
