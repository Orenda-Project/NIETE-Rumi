'use strict';
/**
 * The practice home that PLAYS (app_settings web_quiz_practice_play): a grown-up's "Try it as a student" link (a hub
 * token {k:'h', ids:[], pr:1, g}) opens the content the class's grade sees, READ-ONLY, through the real internal
 * routes: the storybook shelf, a book's pages and voices, the story events, the Stories and Games doors, the video
 * library and a video, the Jugnu games page (menu, a game, its result) and its read-along and listening stories.
 *
 * Switch OFF (or absent): every one of those routes refuses the practice token exactly as before (401 bad_token on the
 * content routes, 401 on the games page), and the refusal now says it was a preview link (content_refused practice:1).
 * Switch ON: every route answers, and NOTHING is written anywhere (no insert, update or delete on any table, no Redis
 * key): no students row, no session, no binding, no run row, no story event, no draw row, no speech key.
 *
 * The real router, the real services and the real item bank; only the network boundaries are stood in for (Supabase
 * as an in-memory table double that applies filters, R2, speech, the signer of video links, Redis).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
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
  const writes = [];
  return {
    _store: store, _writes: writes,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { writes.push(k); store.set(k, v); return true; },
    setNX: async (k, v) => { writes.push(k); if (store.has(k)) return false; store.set(k, v); return true; },
    delete: async (k) => { writes.push(k); return store.delete(k); },
    incr: async (k) => { writes.push(k); const n = (Number(store.get(k)) || 0) + 1; store.set(k, n); return n; },
    expire: async () => true,
  };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { makeFake } = require('./fake-supabase');
const { guardColumns } = require('./registry-columns');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const F = require('./__fixtures__/stories-testwala');

const KEY = 'web_quiz_practice_play';
const SWITCHES = [
  'web_quiz_hub', 'web_quiz_child_quiz_home', 'web_quiz_home_v3', 'web_quiz_stories', 'web_quiz_library', 'web_quiz_video_shelf',
  'web_quiz_challenge', 'web_quiz_challenge_record', 'web_quiz_challenge_trail', 'web_quiz_challenge_missing', 'web_quiz_challenge_listen',
  'web_quiz_challenge_questions', 'web_quiz_challenge_v2', 'web_quiz_challenge_period', 'web_quiz_challenge_pool', 'web_quiz_challenge_story',
  'web_quiz_live_read_v3', 'web_quiz_challenge_realtime', 'web_quiz_identity_canon',
];
const DAY = 24 * 3600 * 1000;
const iso = (t) => new Date(t).toISOString();
const REL = '2026-10-01T00:00:00Z';
const reg = (id, extra = {}) => {
  const [lang, kind, band] = id.split('.');
  return { passage_id: id, lang, kind, band: Number(band), pool: 'practice', status: 'reviewed', is_reference: false, released_at: REL, withdrawn_at: null, twin_of: null, provenance: 'published_calibrated', ...extra };
};
// Invented practice stories (Testwala words), loaded as the bank's passages for this suite only.
const PDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wqpractice-'));
const W = ['Hina', 'Testwala', 'saw', 'a', 'red', 'kite', 'It', 'flew', 'over', 'the', 'school', 'Hina', 'smiled', 'and', 'ran', 'home'];
const Q = (id, needs) => ({ id, prompt: `What did ${id} see?`, type: 'literal', needs_line: needs, tap_ok: true, accept: ['a red kite'], reject: ['a blue bird', 'a green bus', 'a cat'], rubric: '' });
const passage = (id, words, questions) => {
  const [lang, kind, band] = id.split('.');
  fs.writeFileSync(path.join(PDIR, `${id}.json`), JSON.stringify({
    passage_id: id, lang, kind, band: Number(band), pool: 'practice', status_at_authoring: 'reviewed', is_reference: false,
    text: words.join(' '), lines: [{ n: 1, from: 0, to: 5 }, { n: 2, from: 6, to: 10 }, { n: 3, from: 11, to: words.length - 1 }],
    tokens: words, questions, twin_of: null, title_en: `${kind} story Testwala`, title_ur: null, bank_version: 'child-test-items-v4',
  }));
};
passage('en.read.1.kite', W, [Q('en.read.1.kite.q1', 1)]);
passage('en.listen.1.rain', ['The', 'rain', 'story', ...W.slice(3)], [Q('en.listen.1.rain.q1', 1), Q('en.listen.1.rain.q2', 2), Q('en.listen.1.rain.q3', 3)]);

const VID = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VQ = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BOOK3 = F.BOOK(10);
// Every table a child's play could write; each must stay exactly as seeded.
const CHILD_TABLES = ['students', 'quiz_sessions', 'web_quiz_challenge_runs', 'story_events', 'child_identity', 'child_phone_bindings',
  'child_rungs', 'challenge_draws', 'web_quiz_live_read_keys', 'class_enrollments', 'student_lists'];

let fake; let server; let base;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'route-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default';
  Bank._loadPassagesFrom(PDIR);
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(async () => { Bank._loadPassagesFrom(); await new Promise((r) => (server ? server.close(r) : r())); });

function world({ practice = true } = {}) {
  const page3 = { ...F.P1, id: F.PAGE(10, 1), book_id: BOOK3 };
  fake = guardColumns(makeFake({
    app_settings: [...SWITCHES.map((key) => ({ key, value: true })), ...(practice === null ? [] : [{ key: KEY, value: practice }])],
    story_books: [F.book(10, { grade: 3 }), F.book(11, { grade: 3, title: 'Book 11 Testwala' }), F.book(1)],
    story_pages: [page3],
    story_page_voices: [{ ...F.VOICE_P1, id: 'v-b10', page_id: page3.id, audio_key: `story/sandbox/${BOOK3}/a01-dddd0010.ogg` }],
    story_questions: F.QUESTIONS.map((q) => ({ ...q, id: `${q.id}-10`, book_id: BOOK3 })),
    story_events: [],
    challenge_passages: [reg('en.read.1.kite'), reg('en.listen.1.rain')],
    challenge_periods: [{ period_id: '2026-10', starts_at: iso(Date.now() - 10 * DAY), ends_at: iso(Date.now() + 20 * DAY), anchor_block_version: 'A1', weights_v: 'w1', bank_version: 'child-test-items-v4' }],
    student_videos: [{ id: VID, grade: '3', subject: 'Science', clean_chapter: 'Plants', clean_title: 'Parts of a Flower', language: null, migration_status: 'done', superseded_by: null, r2_url: 'https://acct.r2.example.com/b/student-videos/v1.mp4' }],
    quizzes: [{ id: VQ, video_id: VID, quiz_source: 'video', status: 'ready', topic: 'Video quiz 1', grade: '3', subject: 'Science', language: 'en' }],
    ...Object.fromEntries(CHILD_TABLES.map((t) => [t, []])),
  }));
  Object.assign(supabase, fake);
  require('../../../shared/services/quiz/web-quiz-practice-play')._reset();
  require('../../../shared/services/quiz/web-quiz-challenge').__reset();
  require('../../../shared/services/quiz/web-quiz-stories')._reset();
  require('../../../shared/services/quiz/web-quiz-library')._reset();
  require('../../../shared/services/quiz/web-quiz-hub-home')._resetCache();
  for (const m of ['web-quiz-hub-flags', 'web-quiz-identity-flags', 'web-quiz-book']) require(`../../../shared/services/quiz/${m}`)._resetCache();
  try { require('../../../shared/services/quiz/web-quiz-hub-play')._resetCache(); } catch (_) { /* no cache */ }
  redis._store.clear();
  redis._writes.length = 0;
  logEvent.mockClear();
}
const writes = () => fake.calls.filter((c) => c.op !== 'select');
const practiceTok = (g = 3, over = {}) => T.sign({ k: 'h', ids: [], pr: 1, g, lang: 'en', exp: Math.floor(Date.now() / 1000) + 3600, ...over });
const H = { 'x-api-key': 'route-key', 'x-wq-device': 'TeacherPhoneDeviceRef1' };
const get = async (p) => { const r = await fetch(`${base}${p}`, { headers: H }); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = async (p, body) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

describe('GOLDEN: web_quiz_practice_play off or absent -> a preview link opens nothing, as before', () => {
  for (const practice of [null, false]) {
    test(`switch ${practice === null ? 'absent' : 'false'}: every content route refuses the practice token`, async () => {
      world({ practice });
      const t = practiceTok();
      expect((await get(`/stories/shelf/h/${t}?l=en`)).status).toBe(401);
      expect((await get(`/stories/book/${BOOK3}/h/${t}`)).status).toBe(401);
      expect((await post(`/stories/event/h/${t}`, { book_id: BOOK3, event: 'story_opened', data: {} })).status).toBe(401);
      expect((await get(`/doors/h/${t}?d=games&l=en`)).status).toBe(401);
      expect((await get(`/lib/h/${t}?l=en`)).status).toBe(401);
      expect((await post('/videos/start', { hub: t, kid: '', vid: VID })).status).toBe(401);
      expect((await get(`/ch/${t}?lang=en`)).status).toBe(401);
      expect((await get(`/ch/${t}/missing?lang=en`)).status).toBe(401);
      expect(writes()).toEqual([]);
    });
  }
  test('the hub boot of a practice home carries no practice_play and no stories bit while off', async () => {
    world({ practice: false });
    const r = await get(`/hub/${practiceTok()}`);
    expect(r.status).toBe(200);
    expect(r.body.practice).toBe(1);
    expect(r.body).not.toHaveProperty('practice_play');
    expect(r.body).not.toHaveProperty('stories');
  });
  test('F3: a refused preview link says so (content_refused practice:1); a forged child token says practice:0', async () => {
    world({ practice: false });
    await get(`/stories/shelf/h/${practiceTok()}?l=en`);
    await get(`/lib/h/${practiceTok()}?l=en`);
    expect(events('web_quiz.content_refused')).toEqual(expect.arrayContaining([
      expect.objectContaining({ route: 'stories_shelf', practice: 1 }), expect.objectContaining({ route: 'lib', practice: 1 })]));
    logEvent.mockClear();
    await get(`/stories/shelf/h/${T.sign({ k: 'h', ids: ['44444444-4444-4444-8444-444444444444'], exp: Math.floor(Date.now() / 1000) + 3600 })}?l=en`);
    expect(events('web_quiz.content_refused')).toEqual([expect.objectContaining({ route: 'stories_shelf', practice: 0 })]);
  });
});

describe('web_quiz_practice_play on: the preview plays, read-only, for its grade', () => {
  beforeEach(() => world({ practice: true }));

  test('the hub boot: practice_play, the Stories bit (the shelf opens), the Videos door as shelves', async () => {
    const r = await get(`/hub/${practiceTok()}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ practice: 1, practice_play: 1, kid: null, kids: [], grade: 3, stories: { on: 1 } });
    expect(r.body.doors.videos).toMatchObject({ watch: true, practice: true, grade: 3, shelf: true });
    expect(writes()).toEqual([]);
  });

  test('storybooks: the grade\'s shelf, a book with its page voice, events answered and never kept', async () => {
    const t = practiceTok();
    const shelf = await get(`/stories/shelf/h/${t}?l=en`);
    expect(shelf.status).toBe(200);
    expect(shelf.body.grade).toBe(3);
    expect(shelf.body.books.map((b) => b.id).sort()).toEqual([F.BOOK(10), F.BOOK(11)].sort());
    expect(shelf.body.books.every((b) => b.done === false)).toBe(true);
    const book = await get(`/stories/book/${BOOK3}/h/${t}`);
    expect(book.status).toBe(200);
    expect(book.body.pages[0].audio).toEqual({ url: `/s/${BOOK3}/a01-dddd0010.ogg`, ms: 3200 });
    // no live reading with no child (its key is counted per child): the reader offers listening, not the microphone
    expect(book.body.lr3).toBe(false);
    expect((await post(`/stories/event/h/${t}`, { book_id: BOOK3, event: 'story_opened', data: { grade: 3 } })).body).toEqual({ ok: true });
    expect((await post(`/stories/event/h/${t}`, { book_id: BOOK3, page_n: 1, event: 'story_page_listened', data: { ms: 3000, completed: true } })).body).toEqual({ ok: true });
    const done = await post(`/stories/event/h/${t}`, { book_id: BOOK3, event: 'story_questions_done', data: { answers: [0, 2] } });
    expect(done.body).toMatchObject({ ok: true, correct: 1, total: 2 });
    expect((await post(`/stories/event/h/${t}`, { book_id: BOOK3, event: 'story_answer', data: { n: 1, i: 0 } })).body).toMatchObject({ ok: true, right: true });
    expect((await post(`/stories/event/h/${t}`, { book_id: BOOK3, event: 'story_done', data: {} })).body).toMatchObject({ ok: true, sticker: false });
    expect(fake.db.story_events).toEqual([]);
    expect(writes()).toEqual([]);
    expect(events('web_quiz.practice_play').map((e) => e.route)).toEqual(expect.arrayContaining(['stories_shelf', 'stories_book', 'stories_event']));
  });

  test('the Stories and Games doors: the shelf, the number games and Jugnu\'s stories for the grade, never the counted read aloud', async () => {
    const t = practiceTok();
    const stories = await get(`/doors/h/${t}?d=stories&l=en`);
    expect(stories.status).toBe(200);
    expect(stories.body).toMatchObject({ shelf: true });
    const games = await get(`/doors/h/${t}?d=games&l=en`);
    expect(games.status).toBe(200);
    const kinds = games.body.games.map((g) => `${g.kind}:${g.stop || g.id}`);
    expect(kinds).toEqual(expect.arrayContaining(['numbers:bigger', 'passage:en.read.1.kite', 'listen:en.listen.1.rain']));
    expect(games.body.games.some((g) => g.kind === 'read' || g.kind === 'bigtest')).toBe(false);
    expect(writes()).toEqual([]);
  });

  test('videos: the grade\'s library (watch only, no quiz button), and a video that plays with nothing minted', async () => {
    const t = practiceTok();
    const lib = await get(`/lib/h/${t}?l=en`);
    expect(lib.status).toBe(200);
    expect(lib.body.grade).toBe('3');
    expect(lib.body.subjects.map((s) => s.key)).toEqual(['Science']);
    const sci = await get(`/lib/h/${t}?l=en&s=Science`);
    expect(sci.status).toBe(200);
    expect(sci.body.chapters[0].videos[0]).toMatchObject({ vid: VID });
    expect(sci.body.quiz).toBe(false);
    const start = await post('/videos/start', { hub: t, kid: '', vid: VID });
    expect(start.status).toBe(200);
    expect(start.body.watch).toMatchObject({ vid: VID, url: `https://video.test/${VID}.mp4`, after: false });
    // the quiz after a video mints a code and a child's session: never from a preview
    expect((await post('/videos/start', { hub: t, kid: '', vid: VID, after: 1 })).status).toBe(409);
    expect(writes()).toEqual([]);
  });

  test('Jugnu\'s games page: the menu (no microphone stop), a number game served and scored in memory', async () => {
    const t = practiceTok();
    const menu = await get(`/ch/${t}?lang=en`);
    expect(menu.status).toBe(200);
    const ids = menu.body.exercises.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['missing', 'bigger', 'listen']));
    expect(ids).not.toContain('read');
    expect(menu.body).toMatchObject({ practice_play: 1, v2: expect.objectContaining({ story: true }) });
    const bigger = await get(`/ch/${t}/bigger?lang=en`);
    expect(bigger.status).toBe(200);
    expect(bigger.body).toMatchObject({ ex: 'bigger', practice_round: true, teacher_preview: true, practice_play: 1 });
    expect(bigger.body.items.length).toBeGreaterThan(0);
    const taps = bigger.body.items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 900 }));
    const res = await post('/ch/result', { ct: bigger.body.ct, taps, ms: 9000 });
    expect(res.status).toBe(200);
    expect(res.body.score).toMatchObject({ correct: bigger.body.items.length, n: bigger.body.items.length });
    const missing = await get(`/ch/${t}/missing?lang=en`);
    expect(missing.status).toBe(200);
    expect(missing.body).toMatchObject({ ex: 'missing', anchor_block: 'A1', practice_round: true });
    const answers = missing.body.items.map((it, i) => ({ i, value: String(it.answer), ms: 2000, first_key_ms: 800, keys: 1 }));
    const mres = await post('/ch/result', { ct: missing.body.ct, answers, ms: 20000 });
    expect(mres.status).toBe(200);
    expect(mres.body.score.correct).toBe(missing.body.items.length);
    // the counted read aloud (the microphone) is not served to a preview
    expect((await get(`/ch/${t}/read?lang=en`)).status).toBe(404);
    expect(fake.db.web_quiz_challenge_runs).toEqual([]);
    expect(writes()).toEqual([]);
  });

  test('Jugnu\'s stories (audio): the read-along and the listening story with its questions, nothing kept', async () => {
    const t = practiceTok();
    const read = await get(`/ch/${t}/read?lang=en&room=story&pid=en.read.1.kite`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ ex: 'read', practice_round: true, practice_play: 1, live: false, story: expect.objectContaining({ text: W.join(' ') }) });
    expect(read.body.story_clip.url).toMatch(/^https:\/\/signed\.test\//);
    const listen = await get(`/ch/${t}/listen?lang=en&room=story&pid=en.listen.1.rain`);
    expect(listen.status).toBe(200);
    expect(listen.body.story_clip.url).toMatch(/^https:\/\/signed\.test\//);
    const qs = await post('/ch/qs', { ct: listen.body.ct, lang: 'en' });
    expect(qs.status).toBe(200);
    expect(qs.body.questions.length).toBeGreaterThan(0);
    const q0 = qs.body.questions[0];
    const right = q0.options.indexOf('a red kite');
    expect((await post('/ch/qa', { ct: listen.body.ct, q: q0.id, pick: right, lang: 'en' })).body).toEqual({ ok: true, answer: 'a red kite' });
    expect((await post('/ch/qa', { ct: listen.body.ct, q: q0.id, pick: (right + 1) % 3, lang: 'en' })).body).toEqual({ ok: false, answer: 'a red kite' });
    // a story the grade's shelf could not show is refused
    expect((await get(`/ch/${t}/read?lang=en&room=story&pid=en.read.1.nothere`)).status).toBe(400);
    // the microphone's routes are closed to a preview run
    expect((await post('/ch/upload', { ct: read.body.ct, type: 'audio/webm', size: 1000 })).status).toBe(403);
    expect((await post('/ch/live', { ct: read.body.ct, lang: 'en' })).status).toBe(403);
    expect(writes()).toEqual([]);
  });

  test('nothing anywhere: no table written, no Redis key, every child table as seeded', async () => {
    const t = practiceTok(4);
    await get(`/hub/${t}`);
    await get(`/stories/shelf/h/${t}?l=en`);
    await get(`/doors/h/${t}?d=games&l=en`);
    await get(`/lib/h/${t}?l=en`);
    await post('/videos/start', { hub: t, kid: '', vid: VID });
    const b = await get(`/ch/${t}/bigger?lang=en`);
    await post('/ch/result', { ct: b.body.ct, taps: [], ms: 100 });
    expect(writes()).toEqual([]);
    expect(redis._writes).toEqual([]);
    CHILD_TABLES.forEach((tb) => expect(fake.db[tb]).toEqual([]));
    const notes = events('web_quiz.practice_play');
    expect(notes.length).toBeGreaterThan(0);
    notes.forEach((e) => expect(e).toMatchObject({ role: 'practice', practice: 1 }));
  });

  test('a practice token of a grade with no number game (grade 1 without its switches) still opens stories and videos', async () => {
    const t = practiceTok(1);
    expect((await get(`/stories/shelf/h/${t}?l=en`)).status).toBe(200);
    expect((await get(`/lib/h/${t}?l=en`)).status).toBe(200);
    expect((await get(`/ch/${t}?lang=en`)).status).toBe(403);
  });
});
