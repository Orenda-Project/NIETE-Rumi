'use strict';
/**
 * NO GRADE FORBIDS ANYTHING ON ANY SHELF (bd-5gyspy.5). Stories, the video library and the games list show every grade
 * to everyone; a grade is only the default selection, with «All grades» and every other grade one tap away.
 *
 *   - a child with no grade at all opens on «All grades»: books (one with its page voice), videos, and the number games a
 *     Grade-3 child plays (each other form opens as a practice play, nothing kept);
 *   - a Grade-3 child opens on Grade 3; `g=all` lists every grade with Grade 3 first;
 *   - a teacher's «experience as a child» preview (a practice token carrying the teacher, `tu`) opens on the grades the
 *     teacher teaches (users.grades_taught), those first under «All»; its Games list carries the teacher's own quizzes,
 *     at least the rows a Grade-3 child of that teacher gets, each opened as the teacher's own preview (`p`);
 *   - one `web_quiz.shelf` line per shelf answer: {tab, sel, lang, n}, never an id.
 *
 * The real internal router and the real services run; only the network boundaries are stood in for (Supabase as the
 * in-memory table double that applies filters, R2, speech, the video signer, Redis, the loggers).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key) => `https://r2.test/put/${key}?X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/ogg' })),
  downloadFromR2: jest.fn(async () => null),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key) => `https://signed.test/${key}`),
  getObjectBytes: jest.fn(async () => null),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
  listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/quiz/web-quiz-media', () => ({
  presignVideo: jest.fn(async ({ video_id: v }) => ({ url: `https://video.test/${v}.mp4`, poster: null })),
  signPoster: jest.fn(async () => null),
  presignAudio: jest.fn(async () => null),
  presignDownload: jest.fn(async () => null),
  videoKey: jest.fn(() => null),
  DEFAULT_EXPIRES: 3600,
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn() }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); return true; },
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
    delete: async (k) => store.delete(k),
    incr: async (k) => { const n = (Number(store.get(k)) || 0) + 1; store.set(k, n); return n; },
    expire: async () => true,
  };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const F = require('./__fixtures__/stories-testwala');

// Every mock of a first-party module above stands in only for functions that module really exports.
test('every first-party mock names only functions its real module exports', () => {
  const real = (p) => jest.requireActual(p);
  const check = (p, mocked) => Object.keys(mocked).filter((k) => typeof mocked[k] === 'function').forEach((k) => expect([p, k, typeof real(p)[k]]).toEqual([p, k, 'function']));
  check('../../../shared/utils/logger', require('../../../shared/utils/logger'));
  check('../../../shared/utils/structured-logger', require('../../../shared/utils/structured-logger'));
  check('../../../shared/services/quiz/web-quiz-media', require('../../../shared/services/quiz/web-quiz-media'));
});

const SWITCHES = [
  'web_quiz_hub', 'web_quiz_child_quiz_home', 'web_quiz_home_v3', 'web_quiz_stories', 'web_quiz_library', 'web_quiz_video_shelf',
  'web_quiz_challenge', 'web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing', 'web_quiz_challenge_listen',
  'web_quiz_challenge_questions', 'web_quiz_identity_canon', 'web_quiz_practice_play',
];
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const KID0 = '44444444-4444-4444-8444-000000000010'; // no grade anywhere
const KID3 = '44444444-4444-4444-8444-000000000003'; // Grade 3, on the teacher's class list
const QZ = '22222222-2222-4222-8222-000000000001';
const QZ4 = '22222222-2222-4222-8222-000000000004';
const SC = '33333333-3333-4333-8333-000000000001';
const SC4 = '33333333-3333-4333-8333-000000000004';
const VID3 = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const VID4 = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const VQ3 = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const VQ4 = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';
const BOOK3 = F.BOOK(10);
const iso = (t) => new Date(t).toISOString();
const DAY = 24 * 3600 * 1000;

let fake; let server; let base;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'route-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default';
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(async () => { await new Promise((r) => (server ? server.close(r) : r())); });

function world() {
  const page3 = { ...F.P1, id: F.PAGE(10, 1), book_id: BOOK3 };
  const code = (id, c, quizId, extra = {}) => ({ id, code: c, quiz_id: quizId, active: true, expires_at: iso(Date.now() + 5 * DAY), topic: `Topic ${c}`,
    language: 'en', class_id: null, teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: iso(Date.now() - 3600000), ...extra });
  fake = makeFake({
    app_settings: SWITCHES.map((key) => ({ key, value: true })),
    users: [{ id: TEACHER, grades_taught: '["grade_3","grade_4","grade_7"]', preferred_language: 'en' }],
    students: [
      { id: KID0, student_name: 'Noor Testwala', student_name_urdu: null, self_reported_class: null, list_id: null, is_active: true, merged_into: null, status: null, created_at: iso(Date.now() - 9 * DAY) },
      { id: KID3, student_name: 'Sana Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, merged_into: null, status: null, created_at: iso(Date.now() - 9 * DAY) },
    ],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    class_enrollments: [],
    story_books: [
      F.book(10, { grade: 3 }), F.book(11, { grade: 3, title: 'Book 11 Testwala' }), F.book(1, { grade: 2 }),
      F.book(20, { grade: 4, title: 'Book 20 Testwala' }), F.book(30, { grade: 5, title: 'Book 30 Testwala' }), F.book(40, { grade: 1, title: 'Book 40 Testwala' }),
    ],
    story_pages: [page3],
    story_page_voices: [{ ...F.VOICE_P1, id: 'v-b10', page_id: page3.id, audio_key: `story/sandbox/${BOOK3}/a01-dddd0010.ogg` }],
    story_questions: [],
    story_events: [],
    challenge_passages: [],
    challenge_periods: [{ period_id: '2026-10', starts_at: iso(Date.now() - 10 * DAY), ends_at: iso(Date.now() + 20 * DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' }],
    student_videos: [
      { id: VID3, grade: '3', subject: 'Science', clean_chapter: 'Plants', clean_title: 'Parts of a Flower', language: null, migration_status: 'done', superseded_by: null, r2_url: 'https://acct.r2.example.com/b/student-videos/v3.mp4' },
      { id: VID4, grade: '4', subject: 'Maths', clean_chapter: 'Fractions', clean_title: 'Halves', language: null, migration_status: 'done', superseded_by: null, r2_url: 'https://acct.r2.example.com/b/student-videos/v4.mp4' },
    ],
    quizzes: [
      { id: VQ3, video_id: VID3, quiz_source: 'video', status: 'ready', topic: 'Video quiz 3', grade: '3', subject: 'Science', language: 'en' },
      { id: VQ4, video_id: VID4, quiz_source: 'video', status: 'ready', topic: 'Video quiz 4', grade: '4', subject: 'Maths', language: 'en' },
      { id: QZ, topic: 'Nouns', subject: 'english', language: 'en', grade: '3', video_id: null, quiz_source: 'transcript', status: 'ready', meta: { sent_at: iso(Date.now() - 3600000) } },
      { id: QZ4, topic: 'Area', subject: 'maths', language: 'en', grade: '4', video_id: null, quiz_source: 'transcript', status: 'ready', meta: { sent_at: iso(Date.now() - 7200000) } },
    ],
    quiz_share_codes: [code(SC, 'TCH301', QZ), code(SC4, 'TCH401', QZ4, { created_at: iso(Date.now() - 7200000) })],
    quiz_sessions: [], quiz_answers: [], web_quiz_challenge_runs: [], child_identity: [], child_phone_bindings: [], child_rungs: [], challenge_draws: [],
  });
  Object.assign(supabase, fake);
  require('../../../shared/services/quiz/web-quiz-practice-play')._reset();
  require('../../../shared/services/quiz/web-quiz-challenge').__reset();
  require('../../../shared/services/quiz/web-quiz-stories')._reset();
  require('../../../shared/services/quiz/web-quiz-library')._reset();
  require('../../../shared/services/quiz/web-quiz-hub-home')._resetCache();
  try { require('../../../shared/services/quiz/web-quiz-grade-pick')._reset(); } catch (_) { /* the module this change adds */ }
  for (const m of ['web-quiz-hub-flags', 'web-quiz-identity-flags', 'web-quiz-book']) require(`../../../shared/services/quiz/${m}`)._resetCache();
  try { require('../../../shared/services/quiz/web-quiz-hub-play')._resetCache(); } catch (_) { /* no cache */ }
  redis._store.clear();
  logEvent.mockClear();
}

const H = { 'x-api-key': 'route-key', 'x-wq-device': DEVICE };
const get = async (p) => { const r = await fetch(`${base}${p}`, { headers: H }); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = async (p, body) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const shelfLines = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.shelf').map((c) => c[1]);
const kidQ = (id) => `kid=${T.chipId('h', id)}`;
const hubOf = (id) => T.signHub([id], 'test');
const practiceTok = (over = {}) => T.sign({ k: 'h', ids: [], pr: 1, g: 3, lang: 'en', exp: Math.floor(Date.now() / 1000) + 3600, ...over });
const gradesOf = (books) => books.map((b) => b.grade);
// the grade groups in shelf order: [3,3,4,...] -> [3,4,...]
const runs = (gs) => gs.filter((g, i) => i === 0 || gs[i - 1] !== g);
const numbers = (games) => games.filter((g) => g.kind === 'numbers').map((g) => g.stop);

describe('a child with NO grade at all: «All grades» is the default, never an empty shelf', () => {
  beforeEach(world);

  test('stories: every grade\'s books, one of them opening with its page voice', async () => {
    const t = hubOf(KID0);
    const shelf = await get(`/stories/shelf/h/${t}?${kidQ(KID0)}&l=en`);
    expect(shelf.status).toBe(200);
    expect(shelf.body.sel).toBe('all');
    expect(new Set(gradesOf(shelf.body.books))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(runs(gradesOf(shelf.body.books))).toEqual([1, 2, 3, 4, 5]);
    const voiced = shelf.body.books.find((b) => b.id === BOOK3);
    expect(voiced).toBeTruthy();
    const book = await get(`/stories/book/${BOOK3}/h/${t}?${kidQ(KID0)}`);
    expect(book.status).toBe(200);
    expect(book.body.pages[0].audio).toEqual({ url: `/s/${BOOK3}/a01-dddd0010.ogg`, ms: 3200 });
  });

  test('videos: the library lists subjects and lessons of every grade', async () => {
    const t = hubOf(KID0);
    const lib = await get(`/lib/h/${t}?${kidQ(KID0)}&l=en`);
    expect(lib.status).toBe(200);
    expect(lib.body.sel).toBe('all');
    expect(lib.body.subjects.map((s) => s.key).sort()).toEqual(['Maths', 'Science']);
    const sci = await get(`/lib/h/${t}?${kidQ(KID0)}&l=en&s=Science`);
    expect(sci.status).toBe(200);
    expect(sci.body.chapters[0].videos.map((v) => v.vid)).toEqual([VID3]);
  });

  test('games: every number game a Grade-3 child gets, each opening as a practice play of a grade', async () => {
    const g0 = await get(`/doors/h/${hubOf(KID0)}?${kidQ(KID0)}&d=games&l=en`);
    expect(g0.status).toBe(200);
    redis._store.clear();
    const g3 = await get(`/doors/h/${hubOf(KID3)}?${kidQ(KID3)}&d=games&l=en`);
    expect(g3.status).toBe(200);
    const kid3 = numbers(g3.body.games);
    expect(kid3.length).toBeGreaterThan(0);
    const form3 = g0.body.games.filter((g) => g.kind === 'numbers' && g.form === '3').map((g) => g.stop);
    expect(form3).toEqual(expect.arrayContaining(kid3));
    // every form there is (grade 1's needs its own switches, off here)
    expect([...new Set(g0.body.games.filter((g) => g.kind === 'numbers').map((g) => g.form))]).toEqual(['3', '5']);
    g0.body.games.filter((g) => g.kind === 'numbers').forEach((g) => {
      expect(g.href).toMatch(/^\/c\/[A-Za-z0-9._-]+\?kid=#(missing|bigger)$/);
      const tok = T.verify(g.href.slice(3).split('?')[0], 'h');
      expect(tok).toMatchObject({ pr: 1, ids: [], g: g.g });
    });
    expect(g0.body.sel).toBe('all');
  });
});

describe('a Grade-3 child: Grade 3 is the default; «All» lists every grade, Grade 3 first', () => {
  beforeEach(world);

  test('stories', async () => {
    const t = hubOf(KID3);
    const def = await get(`/stories/shelf/h/${t}?${kidQ(KID3)}&l=en`);
    expect(def.status).toBe(200);
    expect(def.body.grade).toBe(3);
    expect(new Set(gradesOf(def.body.books))).toEqual(new Set([3]));
    const all = await get(`/stories/shelf/h/${t}?${kidQ(KID3)}&l=en&g=all`);
    expect(all.body.sel).toBe('all');
    expect(all.body.first).toEqual([3]);
    expect(runs(gradesOf(all.body.books))).toEqual([3, 1, 2, 4, 5]);
  });

  test('videos', async () => {
    const t = hubOf(KID3);
    const def = await get(`/lib/h/${t}?${kidQ(KID3)}&l=en`);
    expect(def.body.grade).toBe('3');
    expect(def.body.subjects.map((s) => s.key)).toEqual(['Science']);
    const all = await get(`/lib/h/${t}?${kidQ(KID3)}&l=en&g=all`);
    expect(all.body.sel).toBe('all');
    expect(all.body.subjects.map((s) => s.key)).toEqual(['Science', 'Maths']);
    const maths = await get(`/lib/h/${t}?${kidQ(KID3)}&l=en&g=all&s=Maths`);
    expect(maths.body.chapters[0]).toMatchObject({ grade: '4' });
    expect(maths.body.chapters[0].videos.map((v) => v.vid)).toEqual([VID4]);
  });

  test('games: today\'s rows by default; «All» adds the other form, after Grade 3\'s', async () => {
    const t = hubOf(KID3);
    const def = await get(`/doors/h/${t}?${kidQ(KID3)}&d=games&l=en`);
    expect(def.body.games.every((g) => g.form === undefined)).toBe(true);
    const all = await get(`/doors/h/${t}?${kidQ(KID3)}&d=games&l=en&g=all`);
    expect(all.body.sel).toBe('all');
    const nums = all.body.games.filter((g) => g.kind === 'numbers');
    expect(nums.slice(0, numbers(def.body.games).length).map((g) => g.stop)).toEqual(numbers(def.body.games));
    expect(nums.filter((g) => g.form === '5').length).toBeGreaterThan(0);
  });
});

describe('a teacher\'s «experience as a child» preview (teaches Grades 3, 4 and 7)', () => {
  beforeEach(world);

  test('stories: Grades 3 and 4 are the default selection, first under «All»', async () => {
    const t = practiceTok({ tu: TEACHER });
    const def = await get(`/stories/shelf/h/${t}?l=en`);
    expect(def.status).toBe(200);
    expect(def.body.sel).toEqual([3, 4]);
    expect(runs(gradesOf(def.body.books))).toEqual([3, 4]);
    const all = await get(`/stories/shelf/h/${t}?l=en&g=all`);
    expect(all.body.sel).toBe('all');
    expect(runs(gradesOf(all.body.books))).toEqual([3, 4, 1, 2, 5]);
    const g5 = await get(`/stories/shelf/h/${t}?l=en&g=5`);
    expect(gradesOf(g5.body.books)).toEqual([5]);
  });

  test('videos: Grades 3 and 4 by default; «All» available', async () => {
    const t = practiceTok({ tu: TEACHER });
    const def = await get(`/lib/h/${t}?l=en`);
    expect(def.body.sel).toEqual(['3', '4']);
    expect(def.body.subjects.map((s) => s.key)).toEqual(['Science', 'Maths']);
    expect((await get(`/lib/h/${t}?l=en&g=all`)).body.sel).toBe('all');
  });

  test('games: the preview carries the teacher\'s quizzes, at least a Grade-3 child\'s rows, opened as the teacher\'s own preview', async () => {
    const kid = await post(`/hub/${hubOf(KID3)}`, { kid: T.chipId('h', KID3), device_ref: DEVICE, lang: 'en' });
    expect(kid.status).toBe(200);
    const kidCodes = ((kid.body.doors || {}).games || []).filter((g) => g.kind === 'quiz').map((g) => g.code);
    expect(kidCodes.length).toBeGreaterThan(0);
    const pr = await get(`/hub/${practiceTok({ tu: TEACHER })}`);
    expect(pr.status).toBe(200);
    const rows = pr.body.doors.games.filter((g) => g.kind === 'quiz');
    expect(rows.map((g) => g.code)).toEqual(expect.arrayContaining(kidCodes));
    rows.forEach((g) => {
      const p = T.verify(g.p, 'p');
      expect(p).toMatchObject({ t: TEACHER });
      expect(g).toMatchObject({ from: 'teacher', done: false });
    });
    // and the grade's number games, as the child's door gives them
    const doors = await get(`/doors/h/${practiceTok({ tu: TEACHER })}?d=games&l=en`);
    redis._store.clear();
    const g3 = await get(`/doors/h/${hubOf(KID3)}?${kidQ(KID3)}&d=games&l=en`);
    expect(numbers(doors.body.games)).toEqual(expect.arrayContaining(numbers(g3.body.games)));
  });

  test('a preview token with no teacher keeps its own grade as the default (today\'s answer)', async () => {
    const r = await get(`/stories/shelf/h/${practiceTok()}?l=en`);
    expect(r.body.grade).toBe(3);
    expect(new Set(gradesOf(r.body.books))).toEqual(new Set([3]));
  });
});

describe('one web_quiz.shelf line per shelf answer: tab, selection, language, count; never an id', () => {
  beforeEach(world);

  test('stories, games and the library each log once', async () => {
    const t = hubOf(KID3);
    await get(`/stories/shelf/h/${t}?${kidQ(KID3)}&l=en&g=all`);
    await get(`/doors/h/${t}?${kidQ(KID3)}&d=games&l=en`);
    await get(`/lib/h/${t}?${kidQ(KID3)}&l=en`);
    await get(`/stories/shelf/h/${practiceTok({ tu: TEACHER })}?l=ur`);
    const lines = shelfLines();
    expect(lines).toEqual([
      { tab: 'stories', sel: 'all', lang: 'en', n: 6 },
      { tab: 'games', sel: '3', lang: 'en', n: expect.any(Number) },
      { tab: 'videos', sel: '3', lang: 'en', n: 1 },
      { tab: 'stories', sel: '3,4', lang: 'ur', n: 0 },
    ]);
    const text = JSON.stringify(lines);
    [KID3, TEACHER, LIST].forEach((id) => expect(text).not.toContain(id));
  });
});
