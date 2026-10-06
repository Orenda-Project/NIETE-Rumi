'use strict';
/**
 * The web library (web-quiz-library.js): subjects for a grade, then a subject's chapters, from an
 * in-memory index of the video bank. Supabase, the S3 SDK's send (R2) and fetch are the boundaries
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
const Lib = require('../../../shared/services/quiz/web-quiz-library');
const Videos = require('../../../shared/services/quiz/web-quiz-videos');

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
function seed({ flag = true } = {}) {
  const vrow = (n, grade, subject, chapter, title, extra = {}) => ({
    id: V(n), grade, subject, clean_chapter: chapter, clean_title: title, migration_status: 'done', superseded_by: null,
    r2_url: `https://acct.r2.example.com/test-bucket/student-videos/v${n}.mp4`, ...extra,
  });
  const vquiz = (n) => ({ id: VQ(n), video_id: V(n), quiz_source: 'video', status: 'ready', topic: `Video quiz ${n}`, grade: '3', subject: 'Science' });
  const videos = [
    vrow(1, '3', 'Science', 'Plants', 'Parts of a Flower'),
    vrow(2, '3', 'Science', 'Plants', 'Leaves'),
    vrow(3, '3', 'Science', 'Animals', 'Life Cycle of a Hen'),
    vrow(4, '3', 'Maths', 'Chapter 2', 'Adding'),
    vrow(5, '3', 'Maths', 'Chapter 10', 'Big numbers'),
    vrow(6, '3', 'English', 'Nouns', 'Naming Words'),
    vrow(7, '3', 'Science', 'Plants', 'No quiz yet'),                         // no ready quiz: never listed
    vrow(8, '3', 'Science', 'Plants', 'A duplicate', { superseded_by: V(1) }), // superseded: never listed
    vrow(9, '4', 'Science', 'Energy', 'Grade four video'),
    vrow(10, 'KG', 'English', 'Letters', 'ABC'),
    vrow(11, '3', 'Urdu', 'Haroof', 'Not migrated', { migration_status: 'pending' }),
  ];
  fake = makeFake({
    app_settings: flag ? [{ key: 'web_quiz_library', value: true }] : [],
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
        topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30) },
      // This class already has codes for videos 1 and 3; the code for video 2 has expired.
      { id: 'sc-v1', code: 'VID001', quiz_id: VQ(1), video_id: V(1), teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: future, invited_by_student_id: null, parent_share_code_id: SC, created_at: ago(5) },
      { id: 'sc-v2', code: 'VID002', quiz_id: VQ(2), video_id: V(2), teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: past, invited_by_student_id: null, parent_share_code_id: SC, created_at: ago(500) },
      { id: 'sc-v3', code: 'VID003', quiz_id: VQ(3), video_id: V(3), teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: future, invited_by_student_id: null, parent_share_code_id: SC, created_at: ago(5) },
      // A friend's challenge code under the class: never offered as the class's code.
      { id: 'sc-f', code: 'FRND01', quiz_id: VQ(6), video_id: V(6), teacher_user_id: TEACHER, language: 'en', active: true,
        expires_at: future, invited_by_student_id: KID_A, parent_share_code_id: SC, created_at: ago(5) },
    ],
    quizzes: [
      { id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'science', language: 'en', quiz_source: 'transcript', video_id: null },
      ...[1, 2, 3, 4, 5, 6, 9, 10, 11].map(vquiz),
      { id: VQ(7), video_id: V(7), quiz_source: 'video', status: 'generating' },
    ],
    student_videos: videos,
    quiz_sessions: [
      { id: 's-a1', quiz_id: QUIZ, share_code_id: SC, student_id: KID_A, status: 'completed', completed_at: ago(1), created_at: ago(1) },
      { id: 's-a0', quiz_id: VQ(2), share_code_id: SC, student_id: KID_A, status: 'completed', completed_at: ago(20), created_at: ago(20) },
      { id: 's-a2', quiz_id: VQ(3), share_code_id: SC, student_id: KID_A, status: 'in_progress', created_at: ago(20) },
    ],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const st = (sid = 's-a1', sc = SC) => T.signSession({ sessionId: sid, deviceRef: 'd1', shareCodeId: sc });
const callsTo = (t) => fake.calls.filter((c) => c.table === t).length;
const heads = () => mockS3Send.mock.calls.filter(([cmd]) => cmd.constructor.name === 'HeadObjectCommand').length;
const anyR2 = () => mockS3Send.mock.calls.length;

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  jest.clearAllMocks();
  Videos._metaCache.clear();
  Lib._reset();
  mockS3Send.mockImplementation(async (cmd) => {
    if (cmd.constructor.name === 'HeadObjectCommand') return { ContentLength: 3170403, ContentType: 'video/mp4' };
    return {};
  });
  seed();
});
afterAll(() => { process.env = SAVED; });

describe('lib: subjects (L1)', () => {
  test('the quiz\'s grade, every grade with its count of playable videos, subjects in the Flow\'s order with art', async () => {
    const out = await Lib.lib('AB12CD', { st: st() });
    expect(out.grade).toBe('3');
    expect(out.grades).toEqual([
      { g: 'KG', n: 1, art: expect.stringMatching(/^\/wq\/art\/grade-kg-\d+\.(svg|webp)$/) },
      { g: '3', n: 6, art: expect.stringMatching(/^\/wq\/art\/grade-3-\d+\.(svg|webp)$/) },
      { g: '4', n: 1, art: expect.stringMatching(/^\/wq\/art\/grade-4-\d+\.(svg|webp)$/) },
    ]);
    expect(out.subjects.map((s) => [s.key, s.n])).toEqual([['English', 1], ['Maths', 2], ['Science', 3]]);
    expect(out.subjects[1].art).toMatch(/^\/wq\/art\/subject-maths-\d+\.(svg|webp)$/);
    expect(out.mine).toBe('Science');                 // the quiz's own subject: "Watch another video" opens it
    expect(out.chapters).toBeUndefined();
  });

  test('another grade on request; an unknown grade falls back to the quiz\'s', async () => {
    expect((await Lib.lib('AB12CD', { g: 'KG' })).subjects.map((s) => s.key)).toEqual(['English']);
    expect((await Lib.lib('AB12CD', { g: 'nope' })).grade).toBe('3');
  });
});

describe('lib: chapters (L2)', () => {
  test('chapters in the Flow\'s text order, each video with poster, done and the class\'s live code', async () => {
    const out = await Lib.lib('AB12CD', { st: st(), s: 'Science' });
    expect(out.subject).toBe('Science');
    expect(out.art).toMatch(/^\/wq\/art\/subject-science-\d+\.(svg|webp)$/);
    expect(out.chapters.map((c) => [c.name, c.videos.map((v) => v.title)])).toEqual([
      ['Animals', ['Life Cycle of a Hen']],
      ['Plants', ['Leaves', 'Parts of a Flower']],
    ]);
    const [hen] = out.chapters[0].videos;
    const [leaves, flower] = out.chapters[1].videos;
    expect(hen).toMatchObject({ vid: V(3), code: 'VID003' });
    expect(hen.done).toBeUndefined();                 // in progress is not done
    expect(leaves.done).toBe(true);
    expect(leaves.code).toBeUndefined();              // its class code expired: the page mints a new one
    expect(flower.code).toBe('VID001');
    expect(flower.poster).toMatch(/student-videos\/v1_poster\.jpg\?.*X-Amz-Signature=/);
    // Lengths are never waited for: none cached yet, so none shown.
    expect(flower.secs).toBeUndefined();
    expect(flower.mb).toBeUndefined();
  });

  test('"Chapter 10" before "Chapter 2" (today\'s text order, kept)', async () => {
    const out = await Lib.lib('AB12CD', { s: 'Maths' });
    expect(out.chapters.map((c) => c.name)).toEqual(['Chapter 10', 'Chapter 2']);
  });

  test('a friend\'s challenge code is never the class\'s code', async () => {
    const out = await Lib.lib('AB12CD', { s: 'English' });
    expect(out.chapters[0].videos[0].code).toBeUndefined();
  });

  test('zero R2 calls while answering: posters are signed locally, no HEAD', async () => {
    await Lib.lib('AB12CD', { st: st(), s: 'Science' });
    expect(heads()).toBe(0);
    expect(anyR2()).toBe(0);
  });

  test('the class codes come from ONE query, whatever the number of videos', async () => {
    await Lib.lib('AB12CD', { st: st() }); // warm the index
    fake.calls.length = 0;
    await Lib.lib('AB12CD', { st: st(), s: 'Science' });
    // one for resolveCode, one for the class's codes of all 3 videos
    expect(callsTo('quiz_share_codes')).toBe(2);
    expect(callsTo('student_videos')).toBe(0);    // the index, not the bank, answers
  });

  test('lengths and sizes warm in the background after the answer, then show', async () => {
    const fetchHead = jest.fn(async () => ({ status: 206, arrayBuffer: async () => Buffer.alloc(10) }));
    await Lib.lib('AB12CD', { s: 'Science', fetchImpl: fetchHead });
    await Lib._idle();
    expect(heads()).toBeGreaterThan(0);           // the background warm-up did the HEADs
    const out = await Lib.lib('AB12CD', { s: 'Science' });
    expect(out.chapters[1].videos[1].mb).toBe(3.2);
  });
});

describe('the bank index', () => {
  test('loaded once, shared by concurrent callers, refreshed after 10 minutes', async () => {
    await Promise.all([Lib.lib('AB12CD', {}), Lib.lib('AB12CD', { g: 'KG' })]);
    expect(callsTo('student_videos')).toBe(1);
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);
    try {
      fake.db.student_videos.push({ id: V(12), grade: '3', subject: 'Maths', clean_chapter: 'Chapter 3', clean_title: 'New',
        migration_status: 'done', superseded_by: null, r2_url: 'https://acct.r2.example.com/test-bucket/student-videos/v12.mp4' });
      fake.db.quizzes.push({ id: VQ(12), video_id: V(12), quiz_source: 'video', status: 'ready' });
      await Lib.lib('AB12CD', {});                  // stale: answered from the old index, refresh starts
      await Lib._idle();
      expect(callsTo('student_videos')).toBe(2);
      const out = await Lib.lib('AB12CD', {});
      expect(out.subjects.find((x) => x.key === 'Maths').n).toBe(3);
      expect(callsTo('student_videos')).toBe(2);
    } finally { spy.mockRestore(); }
  });
});

describe('flag and access', () => {
  test('flag off: 404 library_off (the page keeps today\'s list)', async () => {
    seed({ flag: false });
    await expect(Lib.lib('AB12CD', {})).rejects.toMatchObject({ status: 404, body: { error: 'library_off' } });
  });
  test('no secret: 503 web_quiz_off', async () => {
    delete process.env.INTERNAL_API_KEY;
    await expect(Lib.lib('AB12CD', {})).rejects.toMatchObject({ status: 503, body: { error: 'web_quiz_off' } });
  });
  test('a session token of another class shows no "done" (never another child\'s history)', async () => {
    const out = await Lib.lib('AB12CD', { st: st('s-a1', 'another-class'), s: 'Science' });
    expect(out.chapters[1].videos[0].done).toBeUndefined();
  });
});

describe('download: GET /videos/dl/:code -> 302 to an attachment link', () => {
  const express = require('express');
  let server; let base;
  beforeAll(async () => {
    const app = express();
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  });
  afterAll(() => new Promise((r) => server.close(r)));
  const KEY = { 'x-api-key': 'test-key' };

  test('302 to a 1-hour presigned GET of the light copy, saved as a clean file name', async () => {
    const r = await fetch(`${base}/videos/dl/AB12CD?st=${encodeURIComponent(st())}&vid=${V(1)}`, { headers: KEY, redirect: 'manual' });
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get('location'));
    expect(loc.pathname).toMatch(/\/student-videos\/v1_web\.mp4$/);
    expect(loc.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(loc.searchParams.get('response-content-disposition')).toBe('attachment; filename="science-grade3-parts-of-a-flower.mp4"');
    expect(loc.searchParams.get('response-content-type')).toBe('video/mp4');
  });

  test('no light copy: the original', async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.constructor.name === 'HeadObjectCommand' && /_web\.mp4$/.test(cmd.input.Key)) { const e = new Error('nf'); e.name = 'NotFound'; throw e; }
      return { ContentLength: 10 };
    });
    const r = await fetch(`${base}/videos/dl/AB12CD?st=${encodeURIComponent(st())}&vid=${V(4)}`, { headers: KEY, redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(new URL(r.headers.get('location')).pathname).toMatch(/\/student-videos\/v4\.mp4$/);
  });

  test('a bad or another class\'s token: 401; an unknown or unplayable video: 404', async () => {
    const bad = await fetch(`${base}/videos/dl/AB12CD?st=nope&vid=${V(1)}`, { headers: KEY, redirect: 'manual' });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'bad_token' });
    const other = await fetch(`${base}/videos/dl/AB12CD?st=${encodeURIComponent(st('s-a1', 'x'))}&vid=${V(1)}`, { headers: KEY, redirect: 'manual' });
    expect(other.status).toBe(401);
    const pending = await fetch(`${base}/videos/dl/AB12CD?st=${encodeURIComponent(st())}&vid=${V(11)}`, { headers: KEY, redirect: 'manual' });
    expect(pending.status).toBe(404);
    const junk = await fetch(`${base}/videos/dl/AB12CD?st=${encodeURIComponent(st())}&vid=../../x`, { headers: KEY, redirect: 'manual' });
    expect(junk.status).toBe(400);
  });

  test('the library routes are mounted behind the key', async () => {
    expect((await fetch(`${base}/lib/AB12CD`)).status).toBe(401);
    const r = await fetch(`${base}/lib/AB12CD?s=Maths`, { headers: KEY });
    expect(r.status).toBe(200);
    expect((await r.json()).chapters.length).toBe(2);
    const h = await fetch(`${base}/lib/h/sometoken?kid=x`, { headers: KEY });
    expect([401, 503]).toContain(h.status);
  });
});

describe('review fixes', () => {
  test('a quiz for a grade band opens on the child\'s own grade inside the band', async () => {
    fake.db.quizzes[0].grade = '3-5';
    fake.db.quiz_sessions[0].student_class = '4';
    expect((await Lib.lib('AB12CD', { st: st() })).grade).toBe('4');
    fake.db.quiz_sessions[0].student_class = '9';      // outside the band: the band's first grade
    Lib._reset();
    expect((await Lib.lib('AB12CD', { st: st() })).grade).toBe('3');
    expect((await Lib.lib('AB12CD', {})).grade).toBe('3'); // nothing known about the child
  });

  test('posters are signed quietly (no log line per poster)', async () => {
    require('../../../shared/services/quiz/web-quiz-media')._posterCache.clear();
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await Lib.lib('AB12CD', { st: st(), s: 'Science' });
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
