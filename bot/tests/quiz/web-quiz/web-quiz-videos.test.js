'use strict';
/**
 * "Watch another video" on the web child quiz (web-quiz-videos.js) and the two places the rest of
 * the web quiz treats its codes differently (resolveCode, startSession). Supabase, the S3 SDK's
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

describe('pure helpers', () => {
  test('grades: one grade, a band, a "Grade N" label, early years; nothing for an unknown value', () => {
    expect(Videos.gradesFor('3')).toEqual(['3']);
    expect(Videos.gradesFor('3-5')).toEqual(['3', '4', '5']);
    expect(Videos.gradesFor('Grade 2')).toEqual(['2']);
    expect(Videos.gradesFor('kg')).toEqual(['KG']);
    expect(Videos.gradesFor('6-8')).toEqual(['6']);
    expect(Videos.gradesFor(null)).toEqual([]);
  });
  test('the lesson quiz\'s subject names map to the video bank\'s', () => {
    expect(Videos.subjectFor('maths')).toBe('Maths');
    expect(Videos.subjectFor('Mathematics')).toBe('Maths');
    expect(Videos.subjectFor('islamiat')).toBe('Islamic Studies');
    expect(Videos.subjectFor('science')).toBe('Science');
  });
  test('the length of a fast-start MP4 comes from its movie header', () => {
    expect(Videos.mp4Seconds(mp4Head(143))).toBe(143);
    expect(Videos.mp4Seconds(Buffer.from('not a video'))).toBeNull();
  });
});

describe('list', () => {
  test('no secret: 503 web_quiz_off, like every other web quiz endpoint', async () => {
    delete process.env.INTERNAL_API_KEY;
    await expect(Videos.list('AB12CD')).rejects.toMatchObject({ status: 503, body: { error: 'web_quiz_off' } });
    await expect(Videos.start({ code: 'AB12CD' })).rejects.toMatchObject({ status: 503 });
  });

  test('lessons of the quiz\'s grade, same subject first, not-yet-done before done, with length, size and no poster when none exists', async () => {
    const out = await Videos.list('AB12CD', { st: st(), fetchImpl: fetchHead });
    expect(out.grade).toBe('3');
    expect(out.subject).toBe('Science');
    expect(out.videos.map((v) => v.title)).toEqual(['Life Cycle of a Hen', 'Parts of a Flower', 'Naming Words']);
    expect(out.videos[0]).toEqual({ vid: V(1), title: 'Life Cycle of a Hen', chapter: 'Chapter 1', subject: 'Science', grade: '3', secs: 143, mb: 3.2 });
    expect(out.videos[1].done).toBe(true);
    expect(out.videos[0].done).toBeUndefined();
    // Only the first 64 KB of each video is read, for its length.
    expect(fetchHead.mock.calls[0][1]).toEqual({ headers: { range: 'bytes=0-65535' } });
  });

  test('a video quiz never lists its own video', async () => {
    fake.db.quiz_share_codes.push({ id: 'sc-v1', code: 'VID111', quiz_id: VQ(1), video_id: V(1), teacher_user_id: TEACHER,
      language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, created_at: ago(2) });
    const out = await Videos.list('VID111', { fetchImpl: fetchHead });
    expect(out.videos.map((v) => v.vid)).not.toContain(V(1));
  });

  test('a quiz with no grade lists nothing (never guesses)', async () => {
    fake.db.quizzes[0].grade = null;
    const out = await Videos.list('AB12CD', { fetchImpl: fetchHead });
    expect(out.videos).toEqual([]);
  });
});

describe('start: one code per (class code, video quiz), the teacher kept', () => {
  test('the first child mints it with the class code as parent and no inviter; the next child gets the same code', async () => {
    const a = await Videos.start({ code: 'AB12CD', st: st(), vid: V(1) });
    expect(a.code).toMatch(/^[A-Z0-9]{4,12}$/);
    const row = fake.db.quiz_share_codes.find((r) => r.code === a.code);
    expect(row).toMatchObject({
      quiz_id: VQ(1), video_id: V(1), teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
      topic: 'Life Cycle of a Hen', language: 'ur', parent_share_code_id: SC, invited_by_student_id: null,
    });
    const b = await Videos.start({ code: 'AB12CD', st: st(), vid: V(1) });
    expect(b.code).toBe(a.code);
    expect(fake.db.quiz_share_codes.filter((r) => r.quiz_id === VQ(1))).toHaveLength(1);
  });

  test('a lesson picked from a "more videos" quiz hangs off the same class code', async () => {
    const a = await Videos.start({ code: 'AB12CD', st: st(), vid: V(1) });
    const sess = await WQ.startSession({ code: a.code, from_st: st() });
    const b = await Videos.start({ code: a.code, st: sess.st, vid: V(3) });
    expect(fake.db.quiz_share_codes.find((r) => r.code === b.code).parent_share_code_id).toBe(SC);
  });

  test('a token from another code, an unknown lesson or a lesson with no quiz is refused', async () => {
    await expect(Videos.start({ code: 'AB12CD', st: st('s-a1', SC_OTHER), vid: V(1) })).rejects.toMatchObject({ status: 401 });
    await expect(Videos.start({ code: 'AB12CD', st: st(), vid: 'nope' })).rejects.toMatchObject({ status: 400 });
    await expect(Videos.start({ code: 'AB12CD', st: st(), vid: V(4) })).rejects.toMatchObject({ status: 404 });
  });
});

describe('a "more videos" code in the rest of the web quiz', () => {
  test('it plays its own quiz (a parent with no inviter is not a challenge)', async () => {
    const { code } = await Videos.start({ code: 'AB12CD', st: st(), vid: V(1) });
    const ctx = await WQ.resolveCode(code);
    const row = fake.db.quiz_share_codes.find((r) => r.code === code);
    expect(ctx.quizId).toBe(VQ(1));
    expect(ctx.shareCodeId).toBe(row.id);
    expect(ctx.invitedByStudentId).toBeNull();
    const quiz = await WQ.getQuiz(code);
    expect(quiz.quiz.questions[0].text).toBe('Hen question 1');
    expect(quiz.challenge).toBeUndefined();
  });

  test('its page names the class as the class code does (the lesson code has no finishers of its own yet)', async () => {
    const { code } = await Videos.start({ code: 'AB12CD', st: st(), vid: V(1) });
    const root = await require('../../../shared/services/quiz/video-quiz-report.service').loadClassRows(SC);
    expect(root.className).toBeTruthy();
    expect((await WQ.getQuiz(code)).cls.label).toBe(root.className);
  });

  test('a friend\'s challenge code still plays its parent\'s quiz', async () => {
    fake.db.quiz_share_codes.push({ id: 'sc-ch', code: 'CHAL12', quiz_id: QUIZ, teacher_user_id: TEACHER, language: 'ur', active: true,
      expires_at: future, invited_by_student_id: KID_A, parent_share_code_id: SC, created_at: ago(1) });
    const ctx = await WQ.resolveCode('CHAL12');
    expect(ctx.shareCodeId).toBe(SC);
    expect(ctx.invitedByStudentId).toBe(KID_A);
  });

  test('the same child plays it with no name to pick: the earlier session\'s token says who', async () => {
    const { code } = await Videos.start({ code: 'AB12CD', st: st(), vid: V(1) });
    const out = await WQ.startSession({ code, from_st: st() });
    expect(out.child).toMatchObject({ first: 'Zara' });
    const row = fake.db.quiz_share_codes.find((r) => r.code === code);
    const s = fake.db.quiz_sessions.find((x) => x.share_code_id === row.id);
    expect(s).toMatchObject({ student_id: KID_A, quiz_id: VQ(1), invited_by_student_id: null, source: 'share_link' });
  });

  test('a child on the teacher\'s class list keeps the list\'s class on the lesson\'s session (roster mode)', async () => {
    fake.db.app_settings = [{ key: 'web_quiz_roster_id', value: true }];
    fake.db.student_lists = [{ id: 'L1', user_id: TEACHER, class_name: '3', section: 'B', is_active: true }];
    Object.assign(fake.db.students[0], { list_id: 'L1', roll_number: 5, is_active: true });
    const { code } = await Videos.start({ code: 'AB12CD', st: st(), vid: V(1) });
    await WQ.startSession({ code, from_st: st() });
    const row = fake.db.quiz_share_codes.find((r) => r.code === code);
    expect(fake.db.quiz_sessions.find((x) => x.share_code_id === row.id).student_class).toBe('3-B');
  });

  test('a token from another teacher\'s class does not carry the child over', async () => {
    fake.db.quiz_sessions.push({ id: 's-o1', quiz_id: QUIZ, share_code_id: SC_OTHER, student_id: KID_A, student_name: 'Zara Testwala',
      status: 'completed', created_at: ago(1), invited_by_student_id: null });
    const { code } = await Videos.start({ code: 'AB12CD', st: st(), vid: V(1) });
    await expect(WQ.startSession({ code, from_st: st('s-o1', SC_OTHER) })).rejects.toMatchObject({ status: 401 });
  });

  test('no 12-hour teacher report is scheduled for it (the teacher never sent it; a report is a paid message)', async () => {
    const { code } = await Videos.start({ code: 'AB12CD', st: st(), vid: V(1) });
    await WQ.startSession({ code, from_st: st() });
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  test('a video-bank quiz is shared by every teacher: playing it from "more videos" never changes its attempt rule for them', async () => {
    const { code } = await Videos.start({ code: 'AB12CD', st: st(), vid: V(1) });
    await WQ.startSession({ code, from_st: st() });
    expect(fake.db.quizzes.find((q) => q.id === VQ(1)).meta).toBeNull();
  });

  test('the teacher\'s own class code still schedules its report as before', async () => {
    await WQ.startSession({ code: 'AB12CD', chip: T.chipId(SC, KID_A) });
    expect(SQS.queueJob).toHaveBeenCalledTimes(1);
  });
});
