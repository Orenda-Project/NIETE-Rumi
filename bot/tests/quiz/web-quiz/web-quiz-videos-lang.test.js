'use strict';
/**
 * A library ("watch another video") quiz's page speaks the QUIZ's language, not its class code's:
 * an Urdu lesson tapped from an English class boots Urdu right-to-left, an English lesson tapped
 * from an Urdu class boots English left-to-right — while the code still hangs off the class code and
 * the child stays the same child. Through the real path: videos/start (quiz page or hub) mints or
 * reuses the code, then the page boots it (getQuiz). Supabase, the S3 SDK's send (R2), SQS, Redis and
 * the hub's token check are the boundaries and are faked; every other first-party module runs for real.
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

const SC_UR = '33333333-3333-4333-8333-555555555555';
let fake;
function seed() {
  const vrow = (n, subject, title) => ({
    id: V(n), grade: '3', subject, clean_chapter: `Chapter ${n}`, clean_title: title, migration_status: 'done', superseded_by: null,
    r2_url: `https://acct.r2.example.com/test-bucket/student-videos/v${n}.mp4`,
  });
  // Bank video quizzes carry no language of their own (prod: every ready video quiz has language null).
  const vquiz = (n, subject) => ({ id: VQ(n), video_id: V(n), quiz_source: 'video', status: 'ready', topic: `Video quiz ${n}`, grade: '3', subject, language: null, meta: null });
  const qrow = (quiz, n, text, opts) => ({
    id: `9999999${n}-9999-4999-8999-99999999999${quiz === VQ(1) ? 'a' : 'b'}`, quiz_id: quiz, external_id: `leg:${n}`, sort_order: n,
    question_text: text, option_a: opts[0], option_b: opts[1], option_c: opts[2], option_d: null,
    correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null,
  });
  const cls = (id, code, language, teacher) => ({ id, code, quiz_id: QUIZ, video_id: null, teacher_user_id: teacher, teacher_name: 'Ms Example Teacher',
    topic: 'Parts of a plant', language, active: true, expires_at: future, invited_by_student_id: null,
    parent_share_code_id: null, uses_count: 0, created_at: ago(30) });
  fake = makeFake({
    quiz_share_codes: [cls(SC, 'EN12CD', 'en', TEACHER), cls(SC_UR, 'UR34CD', 'ur', OTHER_TEACHER)],
    quizzes: [
      { id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'science', language: 'en', meta: null, quiz_source: 'transcript', video_id: null },
      vquiz(1, 'Science'), vquiz(3, 'Urdu'),
    ],
    student_videos: [vrow(1, 'Science', 'Life Cycle of a Hen'), vrow(3, 'Urdu', 'Sounds around us')],
    quiz_questions: [
      ...[1, 2].map((n) => qrow(VQ(1), n, `Hen question ${n}`, ['Egg', 'Chick', 'Hen'])),
      ...[1, 2].map((n) => qrow(VQ(3), n, `کس کی آواز آئی؟ ${n}`, ['بلی', 'کتا', 'گائے'])),
    ],
    quiz_sessions: [
      { id: 's-a1', quiz_id: QUIZ, share_code_id: SC, student_id: KID_A, student_name: 'Zara Testwala', user_id: null,
        status: 'completed', correct_answers: 3, total_questions_answered: 4, mastery_percentage: 75, completed_at: ago(1), created_at: ago(1),
        invited_by_student_id: null, device_ref: 'd1', source: 'share_link', student_class: '3' },
    ],
    students: [{ id: KID_A, student_name: 'Zara Testwala', self_reported_class: '3', phone: null }],
    quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const st = (sid = 's-a1', sc = SC) => T.signSession({ sessionId: sid, deviceRef: 'd1', shareCodeId: sc });

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  redis.__keys.clear();
  jest.clearAllMocks();
  Videos._metaCache.clear();
  require('../../../shared/services/quiz/web-quiz-roster')._resetCache();
  mockS3Send.mockImplementation(async (cmd) => {
    if (cmd.constructor.name === 'HeadObjectCommand') return { ContentLength: 3170403, ContentType: 'video/mp4' };
    return {};
  });
  seed();
});
afterAll(() => { process.env = SAVED; });

const rowOf = (code) => fake.db.quiz_share_codes.find((r) => r.code === code);

describe('a library quiz boots in its own language', () => {
  test('an Urdu lesson tapped from an English class page: Urdu, right-to-left; same class, same child', async () => {
    const { code } = await Videos.start({ code: 'EN12CD', st: st(), vid: V(3) });
    const boot = await WQ.getQuiz(code);
    expect(boot.quiz).toMatchObject({ lang: 'ur', dir: 'rtl', voice_lang: 'ur' });
    expect(rowOf(code)).toMatchObject({ parent_share_code_id: SC, teacher_user_id: TEACHER, quiz_id: VQ(3) });
    const sess = await WQ.startSession({ code, from_st: st() });
    expect(sess.child).toMatchObject({ first: 'Zara' });
    expect(fake.db.quiz_sessions.find((x) => x.share_code_id === rowOf(code).id).student_id).toBe(KID_A);
  });

  test('an English lesson tapped from an Urdu class (the hub): English, left-to-right; k is still the child\'s chip on it', async () => {
    mockKidFromHub.mockResolvedValue({ studentId: KID_A, grade: '3', rootId: SC_UR });
    const a = await Videos.start({ hub: 'hubtoken', kid: 'chip-1', vid: V(1) });
    expect((await WQ.getQuiz(a.code)).quiz).toMatchObject({ lang: 'en', dir: 'ltr', voice_lang: 'en' });
    expect(rowOf(a.code)).toMatchObject({ parent_share_code_id: SC_UR, teacher_user_id: OTHER_TEACHER });
    expect(a.k).toBe(T.chipId(rowOf(a.code).id, KID_A));
  });

  test('a lesson code already minted in the class\'s language is corrected on the next tap, and stays the same code', async () => {
    fake.db.quiz_share_codes.push({ id: 'sc-old', code: 'OLD777', quiz_id: VQ(3), video_id: V(3), teacher_user_id: TEACHER,
      teacher_name: 'Ms Example Teacher', topic: 'Sounds around us', language: 'en', active: true, expires_at: future,
      invited_by_student_id: null, parent_share_code_id: SC, uses_count: 0, created_at: ago(2) });
    const { code } = await Videos.start({ code: 'EN12CD', st: st(), vid: V(3) });
    expect(code).toBe('OLD777');
    expect((await WQ.getQuiz(code)).quiz).toMatchObject({ lang: 'ur', dir: 'rtl' });
  });

  test('a lesson in the class\'s own language is unchanged (English lesson, English class)', async () => {
    const { code } = await Videos.start({ code: 'EN12CD', st: st(), vid: V(1) });
    expect((await WQ.getQuiz(code)).quiz).toMatchObject({ lang: 'en', dir: 'ltr' });
  });
});
