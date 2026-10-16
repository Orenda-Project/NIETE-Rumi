'use strict';
/**
 * The ranked Next after a watched video (ctx after_video): POST /videos/start's WATCH answer (a child with no class,
 * web_quiz_home_v3 on) carries `watch.next` from the next-thing slot (web_quiz_next_offer) with the door's own three
 * choices as candidates — the quiz after it (only under a watch root; minted on the tap, never here), the next lesson
 * this child has not finished, more videos. Slot off / nothing / a failure: no `next` key, today's answer byte for byte.
 * The slot itself is stood in for here (its ranking is tested in web-quiz-next-offer-rank.test.js); the ranker's
 * mapping of the door's quiz-after is tested at the end with the real ranker and the committed table.
 * Supabase, R2 (S3 send), SQS and Redis are faked; the hub module is stood in for. Invented children only.
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
const mockOfferFor = jest.fn();
jest.mock('../../../shared/services/quiz/web-quiz-next-offer-result', () => ({ offerFor: (...a) => mockOfferFor(...a) }));
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
// the route's hook (web-quiz-internal.routes.js): the slot's after-video module, passed in by the route
const HOOK = { onWatch: (a) => require('../../../shared/services/quiz/web-quiz-next-offer-video').watchNext(a) };
const start = (body) => Videos.start(body, HOOK);

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
  require('../../../shared/services/quiz/web-quiz-bank')._reset();
  require('../../../shared/services/quiz/web-quiz-library-flag')._reset();
  mockS3Send.mockImplementation(async (cmd) => {
    if (cmd.constructor.name === 'HeadObjectCommand') {
      if (/_poster\.jpg$/.test(cmd.input.Key)) { const e = new Error('nf'); e.name = 'NotFound'; throw e; }
      return { ContentLength: 3170403, ContentType: 'video/mp4' };
    }
    return {};
  });
  mockEvSw.mockResolvedValue({ events: false });
  mockOfferFor.mockResolvedValue({});
  seed();
});
afterAll(() => { process.env = SAVED; });

const HOME_ON = { key: 'web_quiz_home_v3', value: true };
const ROOT = '33333333-3333-4333-8333-777777777777';
const WATCH_ROOT = { key: 'web_quiz_watch_root', value: JSON.stringify(ROOT) };
const ROOT_ROW = { id: ROOT, code: 'JUGNU1', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Jugnu',
  topic: 'Videos', language: 'en', active: false, expires_at: null, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, created_at: ago(300) };
const Home = () => require('../../../shared/services/quiz/web-quiz-hub-home');
const as = (studentId) => mockKidFromHub.mockResolvedValue({ studentId, grade: '3', rootId: null });
const DEVICE = 'dv-testwala-1';
const NEXT = { kind: 'video', variant: 'next_lesson', id: V(2), href: `#watch/${V(2)}`, title: 'Watch next', ctx: 'after_video',
  rank_src: 'prior', source: 'ranked', score: 11.6, arm: 'rank', score_v: '2026-10-16.2', offer: 'abcdefghij', alts: [] };
const WATCH_KEYS = ['after', 'lang', 'title', 'url', 'vid'];
const keysOf = (w) => Object.keys(w).filter((k) => k !== 'secs' && k !== 'poster').sort();

describe('GOLDEN: the slot gives nothing -> the watch answer is today\'s, byte for byte', () => {
  beforeEach(() => { seed([HOME_ON]); Home()._resetCache(); as(KID_B); mockEvSw.mockResolvedValue({ on: true, events: false }); });

  test('the slot switch off: never asked, and no lesson read for it', async () => {
    mockEvSw.mockResolvedValue({ on: false, events: false });
    mockOfferFor.mockResolvedValue({ next_offer: NEXT });
    const before = fake.calls ? fake.calls.length : 0;
    const a = await start({ hub: 'x', kid: 'y', vid: V(1), device: DEVICE });
    expect(a.watch).not.toHaveProperty('next');
    expect(mockOfferFor).not.toHaveBeenCalled();
    if (fake.calls) expect(fake.calls.slice(before).filter((c) => JSON.stringify(c).includes('quiz_sessions'))).toEqual([]);
  });

  test.each([
    ['the slot off ({})', () => mockOfferFor.mockResolvedValue({})],
    ['the slot answers null', () => mockOfferFor.mockResolvedValue(null)],
    ['the slot throws', () => mockOfferFor.mockRejectedValue(new Error('down'))],
    ['a malformed next_offer', () => mockOfferFor.mockResolvedValue({ next_offer: 'x' })],
  ])('%s', async (_n, arrange) => {
    arrange();
    const a = await start({ hub: 'x', kid: 'y', vid: V(1), device: DEVICE });
    expect(Object.keys(a)).toEqual(['watch']);
    expect(keysOf(a.watch)).toEqual(WATCH_KEYS);
    expect(a.watch).not.toHaveProperty('next');
  });
});

describe('the slot on: watch.next is the ranked Next for after_video', () => {
  beforeEach(() => { seed([HOME_ON]); Home()._resetCache(); as(KID_B); mockEvSw.mockResolvedValue({ on: true, events: false }); });

  test('watch.next = the slot\'s object; asked once with this child, this phone, the lesson\'s language and the door\'s choices', async () => {
    mockOfferFor.mockResolvedValue({ next_offer: NEXT });
    const a = await start({ hub: 'x', kid: 'y', vid: V(1), device: DEVICE });
    expect(a.watch.next).toEqual(NEXT);
    expect(keysOf(a.watch)).toEqual([...WATCH_KEYS, 'next'].sort());
    expect(mockOfferFor).toHaveBeenCalledTimes(1);
    const arg = mockOfferFor.mock.calls[0][0];
    expect(arg).toMatchObject({ studentId: KID_B, device: DEVICE, lang: 'en', ctx: 'after_video' });
    // no watch root: no quiz after it; the next lesson this child has not finished (Science G3 after the hen); more videos
    expect(arg.extra).toEqual([
      { kind: 'video', variant: 'next_lesson', id: V(2), href: `#watch/${V(2)}`, title: 'Watch next', title_ur: 'اگلی ویڈیو دیکھیں',
        sub: 'Parts of a Flower', sub_ur: 'Parts of a Flower', minutes: 3, art: expect.any(String) },
      { kind: 'video', variant: 'more', id: 'videos', href: '#videos', title: 'More videos', title_ur: 'اور ویڈیوز دیکھیں', minutes: 3, art: expect.any(String) },
    ]);
  });

  test('under a watch root, the quiz after it first — its href maps to the tap\'s mint (#after/<vid>); nothing minted now', async () => {
    seed([HOME_ON, WATCH_ROOT]); Home()._resetCache(); as(KID_B);
    fake.db.quiz_share_codes.push({ ...ROOT_ROW });
    const n = fake.db.quiz_share_codes.length;
    await start({ hub: 'x', kid: 'y', vid: V(1), device: DEVICE });
    expect(mockOfferFor.mock.calls[0][0].extra[0]).toEqual({ kind: 'quiz', variant: 'after_video', id: `after.${V(1)}`, href: `#after/${V(1)}`,
      title: 'Play the quiz', title_ur: 'کوئز کھیلیں', sub: 'Life Cycle of a Hen', sub_ur: 'Life Cycle of a Hen', minutes: 3, art: expect.any(String) });
    expect(fake.db.quiz_share_codes.length).toBe(n);
  });

  test('a lesson this child already finished is not "Watch next" (Zara finished the flower\'s quiz: no next lesson left)', async () => {
    as(KID_A);
    await start({ hub: 'x', kid: 'y', vid: V(1), device: DEVICE });
    expect(mockOfferFor.mock.calls[0][0].extra.map((c) => c.variant)).toEqual(['more']);
  });

  test('every id and href passes the page relay and the door\'s own href rule', async () => {
    seed([HOME_ON, WATCH_ROOT]); Home()._resetCache(); as(KID_B);
    fake.db.quiz_share_codes.push({ ...ROOT_ROW });
    await start({ hub: 'x', kid: 'y', vid: V(1), device: DEVICE });
    for (const c of mockOfferFor.mock.calls[0][0].extra) {
      expect(c.id).toMatch(/^[a-z0-9._:-]{1,64}$/i);
      expect(c.href).toMatch(/^(#[A-Za-z0-9/_-]*|\/[A-Za-z0-9][^\s]*)$/);
      expect(c.href).not.toMatch(/[A-Z0-9]{6}/);   // never a share code in a ranked list
    }
  });

  test('no hook (a caller other than the route) -> no next, the slot never asked', async () => {
    mockOfferFor.mockResolvedValue({ next_offer: NEXT });
    const a = await Videos.start({ hub: 'x', kid: 'y', vid: V(1), device: DEVICE });
    expect(a.watch).not.toHaveProperty('next');
    expect(mockOfferFor).not.toHaveBeenCalled();
  });

  test('never asked: the quiz-after tap (after:1), a child with a class code, a phone with no device', async () => {
    seed([HOME_ON, WATCH_ROOT]); Home()._resetCache(); as(KID_B);
    fake.db.quiz_share_codes.push({ ...ROOT_ROW });
    await start({ hub: 'x', kid: 'y', vid: V(1), after: 1, device: DEVICE });
    mockKidFromHub.mockResolvedValue({ studentId: KID_A, grade: '3', rootId: SC });
    await start({ hub: 'x', kid: 'y', vid: V(1), device: DEVICE });
    as(KID_B);
    const a = await start({ hub: 'x', kid: 'y', vid: V(1) });
    expect(a.watch).not.toHaveProperty('next');
    expect(mockOfferFor).not.toHaveBeenCalled();
  });

  test('the slot is asked beside the video\'s signing, not after it (a slow slot never adds to a fast video)', async () => {
    let release;
    mockOfferFor.mockImplementation(() => new Promise((res) => { release = () => res({ next_offer: NEXT }); }));
    const Media = require('../../../shared/services/quiz/web-quiz-media');
    const real = Media.presignVideo;
    const order = [];
    Media.presignVideo = async (...a) => { order.push('signed'); return real(...a); };
    try {
      const p = start({ hub: 'x', kid: 'y', vid: V(1), device: DEVICE });
      await new Promise((r) => setTimeout(r, 20));
      // the slot is still pending, and the video has been signed already (a serial await would sign nothing yet)
      expect(mockOfferFor).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['signed']);
      release();
      expect((await p).watch.next).toEqual(NEXT);
    } finally { Media.presignVideo = real; }
  });
});

describe('the ranker: the door\'s quiz-after is a NEW quiz on the after_video row (not "play again")', () => {
  const NO = jest.requireActual('../../../shared/services/quiz/web-quiz-next-offer');
  const after = { kind: 'quiz', variant: 'after_video', id: `after.${V(1)}`, href: `#after/${V(1)}`, title: 'Play the quiz', minutes: 3 };
  const nextLesson = { kind: 'video', variant: 'next_lesson', id: V(2), href: `#watch/${V(2)}`, title: 'Watch next', minutes: 3 };
  const more = { kind: 'video', variant: 'more', id: 'videos', href: '#videos', title: 'More videos', minutes: 3 };
  const row = (kind, variant) => NO.FILE_WEIGHTS.contexts.after_video.find((r) => r.kind === kind && (r.variant || null) === variant);

  test('the quiz after a video scores as the table\'s new-quiz row', () => {
    const r = NO.rank('after_video', [after], { arm: 'rank', seed: 's', now: new Date().toISOString() });
    expect(r.next.score).toBe(row('quiz', 'new').score);
    expect(r.next.score).not.toBe(row('quiz', 'again').score);
  });

  test('rank arm: the next lesson (video row) leads; the quiz after it is an alternative', () => {
    const r = NO.rank('after_video', [after, nextLesson, more], { arm: 'rank', seed: 's', now: new Date().toISOString() });
    expect(r.next.kind).toBe('video');
    expect(r.next.alts.map((a) => a.id)).toContain(after.id);
  });

  test('ctrl arm: today\'s door order (the quiz after it when offered, else the next lesson)', () => {
    expect(NO.rank('after_video', [after, nextLesson, more], { arm: 'ctrl', seed: 's', now: new Date().toISOString() }).next.id).toBe(after.id);
    expect(NO.rank('after_video', [nextLesson, more], { arm: 'ctrl', seed: 's', now: new Date().toISOString() }).next.id).toBe(V(2));
  });
});
