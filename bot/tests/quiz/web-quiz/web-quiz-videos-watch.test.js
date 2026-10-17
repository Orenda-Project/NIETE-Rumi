'use strict';
/**
 * Videos for a child with no class (web_quiz_home_v3): POST /videos/start from the kid's hub with no teacher's code
 * played yet. Today (switch off, or absent) it answers 409 no_class, byte for byte. With the switch on it answers a
 * WATCH: the lesson's own signed video, no code minted, no report, no league; the quiz is offered after, under the
 * watch root (app_settings VALUE web_quiz_watch_root = a share code id) only when one is set. A child WITH a class code
 * is unchanged in both states. Supabase, R2 (S3 send), SQS and Redis are faked; the hub module is stood in for.
 * Invented children only.
 */
process.env.R2_ENDPOINT = 'https://acct.r2.example.com';
process.env.R2_ACCESS_KEY_ID = 'test-only';
process.env.R2_SECRET_ACCESS_KEY = 'test-only';
process.env.R2_BUCKET_NAME = 'test-bucket';

jest.mock('../../../shared/config/supabase', () => ({}));
const mockKidFromHub = jest.fn();
jest.mock('../../../shared/services/quiz/web-quiz-hub', () => ({ kidFromHub: (...a) => mockKidFromHub(...a) }));
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
const mockEmit3 = jest.fn();
const mockEvSw = jest.fn();
jest.mock('../../../shared/services/quiz/web-quiz-events-v3', () => ({ emit3: (...a) => mockEmit3(...a) }));
jest.mock('../../../shared/services/quiz/web-quiz-next-offer', () => ({ switches: (...a) => mockEvSw(...a) }));
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
const KID_B = '44444444-4444-4444-8444-555555555555';
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
function seed(settings = []) {
  const vrow = (n, grade, subject, title, extra = {}) => ({
    id: V(n), grade, subject, clean_chapter: `Chapter ${n}`, clean_title: title, migration_status: 'done', superseded_by: null,
    r2_url: `https://acct.r2.example.com/test-bucket/student-videos/v${n}.mp4`, ...extra,
  });
  const vquiz = (n) => ({ id: VQ(n), video_id: V(n), quiz_source: 'video', status: 'ready', topic: `Video quiz ${n}`, grade: '3', subject: 'Science', language: null, meta: null });
  fake = makeFake({
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Nadia Testwala',
        topic: 'Parts of a plant', language: 'ur', active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30) },
      { id: SC_OTHER, code: 'ZZ99ZZ', quiz_id: QUIZ, video_id: null, teacher_user_id: OTHER_TEACHER, teacher_name: 'Farah Testwala',
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
    app_settings: settings,
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



const HOME_ON = { key: 'web_quiz_home_v3', value: true };
const ROOT = '33333333-3333-4333-8333-777777777777';
const WATCH_ROOT = { key: 'web_quiz_watch_root', value: JSON.stringify(ROOT) };
const ROOT_ROW = { id: ROOT, code: 'JUGNU1', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Jugnu',
  topic: 'Videos', language: 'en', active: false, expires_at: null, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, created_at: ago(300) };
const Home = () => require('../../../shared/services/quiz/web-quiz-hub-home');
const classless = () => mockKidFromHub.mockResolvedValue({ studentId: KID_A, grade: '3', rootId: null });
const codesNow = () => fake.db.quiz_share_codes.length;

describe('GOLDEN: switch off -> a child with no class still gets 409 no_class', () => {
  test.each([['absent', []], ['false', [{ key: 'web_quiz_home_v3', value: 'false' }]], ['off with a watch root', [WATCH_ROOT]]])('%s', async (_n, settings) => {
    seed(settings); Home()._resetCache(); classless();
    const n = codesNow();
    await expect(Videos.start({ hub: 'x', kid: 'y', vid: V(1) })).rejects.toMatchObject({ status: 409, body: { error: 'no_class' } });
    await expect(Videos.start({ hub: 'x', kid: 'y', vid: V(1), after: 1 })).rejects.toMatchObject({ status: 409, body: { error: 'no_class' } });
    expect(codesNow()).toBe(n);
  });
});

describe('switch on: a child with no class WATCHES', () => {
  beforeEach(() => { seed([HOME_ON]); Home()._resetCache(); classless(); });

  test('the video itself, signed, no code minted, no report queued', async () => {
    const n = codesNow();
    const a = await Videos.start({ hub: 'x', kid: 'y', vid: V(1) });
    expect(a.watch).toMatchObject({ vid: V(1), title: 'Life Cycle of a Hen', lang: 'en', after: false });
    expect(a.watch.url).toMatch(/^https:\/\/.*student-videos\/v1(_web)?\.mp4\?/);
    expect(a.code).toBeUndefined();
    expect(codesNow()).toBe(n);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  test('the lesson\'s Urdu-script name rides as title_ur only under web_quiz_videos_ur_titles; off, the watch is today\'s', async () => {
    fake.db.student_videos.find((r) => r.id === V(1)).title_ur = 'مرغی کی زندگی';
    const off = await Videos.start({ hub: 'x', kid: 'y', vid: V(1) });
    expect('title_ur' in off.watch).toBe(false);
    seed([HOME_ON, { key: 'web_quiz_library', value: true }, { key: 'web_quiz_videos_ur_titles', value: true }]); Home()._resetCache(); classless();
    require('../../../shared/services/quiz/web-quiz-library')._reset();
    fake.db.student_videos.find((r) => r.id === V(1)).title_ur = 'مرغی کی زندگی';
    const on = await Videos.start({ hub: 'x', kid: 'y', vid: V(1) });
    expect(on.watch).toMatchObject({ vid: V(1), title: 'Life Cycle of a Hen', title_ur: 'مرغی کی زندگی' });
    fake.db.student_videos.find((r) => r.id === V(1)).title_ur = null;
    require('../../../shared/services/quiz/web-quiz-library')._reset();
    expect('title_ur' in (await Videos.start({ hub: 'x', kid: 'y', vid: V(1) })).watch).toBe(false);
  });

  test('activity_start (EVENTS_V3 §1) for the watch only under the events switch', async () => {
    mockEvSw.mockResolvedValue({ events: false });
    await Videos.start({ hub: 'x', kid: 'y', vid: V(1) });
    expect(mockEmit3).not.toHaveBeenCalled();
    mockEvSw.mockResolvedValue({ events: true });
    await Videos.start({ hub: 'x', kid: 'y', vid: V(1) });
    expect(mockEmit3).toHaveBeenCalledWith('web_quiz.activity_start', { kind: 'video', item: V(1), via: 'hub_door', offer: null }, { canonicalId: KID_A });
  });

  test('a bad lesson id is 400, an unknown lesson 404, a bad hub token 401 — as today', async () => {
    await expect(Videos.start({ hub: 'x', kid: 'y', vid: 'nope' })).rejects.toMatchObject({ status: 400 });
    await expect(Videos.start({ hub: 'x', kid: 'y', vid: V(4) })).rejects.toMatchObject({ status: 404 });
    mockKidFromHub.mockResolvedValue(null);
    await expect(Videos.start({ hub: 'x', kid: 'y', vid: V(1) })).rejects.toMatchObject({ status: 401 });
  });

  test('the quiz after, with no watch root set: 409 no_class (the page offers the next video instead)', async () => {
    await expect(Videos.start({ hub: 'x', kid: 'y', vid: V(1), after: 1 })).rejects.toMatchObject({ status: 409, body: { error: 'no_class' } });
  });

  test('the quiz after, under the watch root: a lesson code of the child\'s OWN (no league with strangers), never a report', async () => {
    seed([HOME_ON, WATCH_ROOT]); Home()._resetCache(); classless();
    fake.db.quiz_share_codes.push({ ...ROOT_ROW });
    expect((await Videos.start({ hub: 'x', kid: 'y', vid: V(1) })).watch.after).toBe(true);
    const a = await Videos.start({ hub: 'x', kid: 'y', vid: V(1), after: 1 });
    const row = fake.db.quiz_share_codes.find((r) => r.code === a.code);
    expect(row).toMatchObject({ quiz_id: VQ(1), video_id: V(1), parent_share_code_id: ROOT, invited_by_student_id: null, teacher_user_id: TEACHER, teacher_name: 'Jugnu' });
    expect(a.k).toBe(T.chipId(row.id, KID_A));
    // once the child has played it, the same child gets the same code back
    fake.db.quiz_sessions.push({ id: 's-w1', quiz_id: VQ(1), share_code_id: row.id, student_id: KID_A, status: 'completed', created_at: ago(0) });
    expect((await Videos.start({ hub: 'x', kid: 'y', vid: V(1), after: 1 })).code).toBe(a.code);
    // another class-less child never shares it (a code's league is its players: strangers from other schools)
    mockKidFromHub.mockResolvedValue({ studentId: KID_B, grade: '3', rootId: null });
    const b = await Videos.start({ hub: 'x2', kid: 'z', vid: V(1), after: 1 });
    expect(b.code).not.toBe(a.code);
    // a "more videos" code (parent, no inviter): resolveCode marks it so, and the session schedules no teacher report
    const ctx = await WQ.resolveCode(a.code);
    expect(ctx.moreVideosOf).toBe(ROOT);
  });

  test('a watch root that names no code: 409 no_class, nothing minted', async () => {
    seed([HOME_ON, WATCH_ROOT]); Home()._resetCache(); classless();
    const n = codesNow();
    await expect(Videos.start({ hub: 'x', kid: 'y', vid: V(1), after: 1 })).rejects.toMatchObject({ status: 409, body: { error: 'no_class' } });
    expect(codesNow()).toBe(n);
  });

  test('a child WITH a class code is unchanged: the class lesson code, video then quiz on /q', async () => {
    mockKidFromHub.mockResolvedValue({ studentId: KID_A, grade: '3', rootId: SC });
    const a = await Videos.start({ hub: 'x', kid: 'y', vid: V(1) });
    expect(a.watch).toBeUndefined();
    expect(fake.db.quiz_share_codes.find((r) => r.code === a.code)).toMatchObject({ parent_share_code_id: SC, teacher_user_id: TEACHER });
  });
});
