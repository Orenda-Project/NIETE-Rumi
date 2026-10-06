'use strict';
/**
 * Server timing for the two calls a child waits on at every lesson: getQuiz (the page) and
 * startSession. One log line each, ids and numbers only: step durations and the total (the DB
 * round-trip count is the route-level web_quiz.timing line). Supabase, the S3 SDK's
 * send (R2), SQS, Redis and the video's first bytes (fetch) are the boundaries and are faked;
 * every first-party module on the path runs for real.
 */
process.env.R2_ENDPOINT = 'https://acct.r2.example.com';
process.env.R2_ACCESS_KEY_ID = 'test-only';
process.env.R2_SECRET_ACCESS_KEY = 'test-only';
process.env.R2_BUCKET_NAME = 'test-bucket';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    get: jest.fn(async (k) => keys.get(k) || null),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
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
const SQS = require('../../../shared/services/queue/sqs-queue.service');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Videos = require('../../../shared/services/quiz/web-quiz-videos');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const OTHER_TEACHER = '11111111-1111-4111-8111-222222222222';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const SC_OTHER = '33333333-3333-4333-8333-444444444444';
const KID_A = '44444444-4444-4444-8444-444444444444';
const V = (n) => `aaaaaaa${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const VQ = (n) => `bbbbbbb${n}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

/** The first bytes of a fast-start MP4: ftyp, then moov > mvhd (version 0) with timescale and duration. */
function mp4Head(secs) {
  const b = Buffer.alloc(200);
  b.write('ftypisom', 4);
  b.write('moov', 36);
  b.write('mvhd', 44);
  b[48] = 0;
  b.writeUInt32BE(1000, 60);
  b.writeUInt32BE(secs * 1000, 64);
  return b;
}

let fake;
function seed() {
  const vrow = (n, grade, subject, title, extra = {}) => ({
    id: V(n), grade, subject, clean_chapter: `Chapter ${n}`, clean_title: title, migration_status: 'done', superseded_by: null,
    r2_url: `https://acct.r2.example.com/test-bucket/student-videos/v${n}.mp4`, ...extra,
  });
  const vquiz = (n) => ({ id: VQ(n), video_id: V(n), quiz_source: 'video', status: 'ready', topic: `Video quiz ${n}`, grade: '3', subject: 'Science', language: null, meta: null });
  fake = makeFake({
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
        topic: 'Parts of a plant', language: 'ur', active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30) },
      { id: SC_OTHER, code: 'ZZ99ZZ', quiz_id: QUIZ, video_id: null, teacher_user_id: OTHER_TEACHER, teacher_name: 'Another Teacher',
        topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30) },
    ],
    quizzes: [
      { id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'science', language: 'ur', meta: null, quiz_source: 'transcript', video_id: null },
      vquiz(1), vquiz(2), vquiz(3), vquiz(5),
    ],
    student_videos: [
      vrow(1, '3', 'Science', 'Life Cycle of a Hen'),
      vrow(2, '3', 'Science', 'Parts of a Flower'),
      vrow(3, '3', 'English', 'Naming Words'),
      vrow(4, '3', 'Science', 'No quiz yet'),                       // no quiz: never listed
      vrow(5, '4', 'Science', 'Another grade'),                     // grade 4: not this class
      vrow(6, '3', 'Science', 'A duplicate', { superseded_by: V(1) }),
    ],
    quiz_questions: [1, 2, 3].map((n) => ({
      id: `9999999${n}-9999-4999-8999-999999999999`, quiz_id: VQ(1), external_id: `leg:${n}`, sort_order: n,
      question_text: `Hen question ${n}`, option_a: 'Egg', option_b: 'Chick', option_c: 'Hen', option_d: null,
      correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null,
    })),
    quiz_sessions: [
      { id: 's-a1', quiz_id: QUIZ, share_code_id: SC, student_id: KID_A, student_name: 'Zara Testwala', user_id: null,
        status: 'completed', correct_answers: 3, total_questions_answered: 4, mastery_percentage: 75, completed_at: ago(1), created_at: ago(1),
        invited_by_student_id: null, device_ref: 'd1', source: 'share_link', student_class: '3' },
      // Zara already finished the quiz of video 2.
      { id: 's-a0', quiz_id: VQ(2), share_code_id: SC, student_id: KID_A, student_name: 'Zara Testwala', user_id: null,
        status: 'completed', correct_answers: 2, total_questions_answered: 3, mastery_percentage: 67, completed_at: ago(20), created_at: ago(20),
        invited_by_student_id: null, device_ref: 'd1', source: 'share_link', student_class: '3' },
    ],
    students: [{ id: KID_A, student_name: 'Zara Testwala', self_reported_class: '3', phone: null }],
    quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const st = (sid = 's-a1', sc = SC) => T.signSession({ sessionId: sid, deviceRef: 'd1', shareCodeId: sc });
const fetchHead = jest.fn(async () => ({ status: 206, arrayBuffer: async () => mp4Head(143) }));

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  redis.__keys.clear();
  jest.clearAllMocks();
  Videos._metaCache.clear();
  require('../../../shared/services/quiz/web-quiz-roster')._resetCache();
  mockS3Send.mockImplementation(async (cmd) => {
    if (cmd.constructor.name === 'HeadObjectCommand') {
      if (/_poster\.jpg$/.test(cmd.input.Key)) { const e = new Error('nf'); e.name = 'NotFound'; throw e; }
      return { ContentLength: 3170403, ContentType: 'video/mp4' };
    }
    return {};
  });
  seed();
});
afterAll(() => { process.env = SAVED; });


const { logEvent } = require('../../../shared/utils/structured-logger');
const timingOf = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

test('getQuiz logs web_quiz.getquiz_timing once: steps and total, no names', async () => {
  const { code } = await Videos.start({ code: 'AB12CD', st: st(), vid: V(1) });
  const scId = fake.db.quiz_share_codes.find((r) => r.code === code).id;
  fake.calls.length = 0;
  logEvent.mockClear();
  await WQ.getQuiz(code);
  const [t] = timingOf('web_quiz.getquiz_timing');
  expect(timingOf('web_quiz.getquiz_timing')).toHaveLength(1);
  expect(t).toMatchObject({ shareCodeId: scId, ok: true });
  expect(Object.keys(t.steps_ms)).toEqual(expect.arrayContaining(['resolve', 'questions', 'media', 'roster', 'live']));
  Object.values(t.steps_ms).concat([t.total_ms]).forEach((v) => expect(Number.isFinite(v) && v >= 0).toBe(true));
  expect(JSON.stringify(t)).not.toMatch(/Testwala|Example|Plants|plant/i);
});

test('startSession logs web_quiz.session_timing once, with its path, also when it refuses', async () => {
  fake.calls.length = 0;
  await WQ.startSession({ code: 'AB12CD', new: { name: 'Ali Testwala', force: true } });
  const [t] = timingOf('web_quiz.session_timing');
  expect(t).toMatchObject({ shareCodeId: SC, ok: true, path: 'new' });
  expect(Object.keys(t.steps_ms)).toEqual(expect.arrayContaining(['resolve', 'identity', 'insert', 'rest']));
  expect(JSON.stringify(t)).not.toMatch(/Ali|Testwala/);
  logEvent.mockClear();
  await expect(WQ.startSession({ code: 'AB12CD', from_st: 'bad' })).rejects.toMatchObject({ status: 401 });
  expect(timingOf('web_quiz.session_timing')[0]).toMatchObject({ ok: false, path: 'from_st', status: 401 });
});
