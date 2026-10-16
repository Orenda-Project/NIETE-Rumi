'use strict';
/**
 * The class link's own picture: what a teacher's forwarded /q/<CODE> previews as in WhatsApp.
 *
 *   class quiz   the class label + the quiz topic            (app_settings quiz_teacher_home)
 *   class story  the class label + the book's title + cover  (quiz_teacher_home AND the story send's switches)
 *
 * One new signed picture kind ('t', ref = the class share code's id), drawn only for the teacher's own class code:
 * never for a child's challenge code or a "watch another video" code, never with another teacher's class.
 * Both switches off: the quiz payload, its preview facts and the picture route answer exactly as before (goldens in
 * __golden__/class-pic-off.json, written by running this file on the code before the picture with GOLDEN_WRITE=1).
 *
 * Supabase, R2, SQS, Redis, WhatsApp and the headless browser are the boundaries and are faked; the services and the
 * internal routes run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    isAvailable: () => true,
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
jest.mock('../../../shared/storage/r2', () => ({ downloadFromR2: jest.fn(), uploadBuffer: jest.fn(), headObject: jest.fn() }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToImage: jest.fn(), htmlToPdf: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../../shared/services/quiz/web-quiz-publish.service', () => ({
  ...jest.requireActual('../../../shared/services/quiz/web-quiz-publish.service'),
  ensureQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
  requestQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
}));

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const sharp = require('sharp');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const { htmlToImage } = require('../../../shared/utils/html-to-pdf');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Og = require('../../../shared/services/quiz/web-quiz-og');
const Art = require('../../../shared/services/quiz/web-quiz-art');
const Stories = require('../../../shared/services/quiz/story-teacher.service');
const TeacherHome = require('../../../shared/services/first-touch/teacher-home.flags');

// The picture's own module: absent before it was built (the red run), so the file still loads.
const tryReq = (p) => { try { return require(p); } catch (_) { return null; } };
const ClassPic = tryReq('../../../shared/services/quiz/web-quiz-class-pic');

const GOLDEN = path.join(__dirname, '__golden__', 'class-pic-off.json');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const OTHER = '11111111-1111-4111-8111-222222222222';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const QUIZ_UR = '22222222-2222-4222-8222-333333333333';
const QUIZ_ST = '22222222-2222-4222-8222-444444444444';
const QUIZ_ST_UR = '22222222-2222-4222-8222-555555555555';
const SC = '33333333-3333-4333-8333-333333333301';
const SC_UR = '33333333-3333-4333-8333-333333333302';
const SC_CH = '33333333-3333-4333-8333-333333333303';
const SC_MV = '33333333-3333-4333-8333-333333333304';
const SC_OT = '33333333-3333-4333-8333-333333333305';
const SC_ST = '33333333-3333-4333-8333-333333333306';
const SC_ST_UR = '33333333-3333-4333-8333-333333333307';
const SC_ST_OT = '33333333-3333-4333-8333-333333333308';
const CLS_MINE = '66666666-6666-4666-8666-666666666601';
const CLS_OTHER = '66666666-6666-4666-8666-666666666602';
const KID_A = '44444444-4444-4444-8444-444444444444';
const BOOK = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BOOK_UR = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

// Words a picture of a class link never says, in either language.
const TEST_WORDS = /\btest\b|\bexam|assessment|امتحان|ٹیسٹ/i;

/** The id the picture kind is signed with, computed from the scheme itself (web-quiz-art-id.js), so the red run has it. */
function tId(ref, kind = 't') {
  const mac = crypto.createHmac('sha256', T.secret()).update(`wq-art|${kind}|${ref}`).digest('base64url').slice(0, 12);
  return `${kind}.${Buffer.from(ref.replace(/-/g, ''), 'hex').toString('base64url')}.${mac}`;
}

let db;
let fake;
function code(id, c, quizId, extra = {}) {
  return {
    id, code: c, quiz_id: quizId, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Sender',
    topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
    parent_share_code_id: null, uses_count: 0, created_at: ago(30), class_id: CLS_MINE, ...extra,
  };
}
function seed({ home = false, story = false } = {}) {
  const questions = (quizId) => [1, 2].map((n) => ({
    id: `${quizId === QUIZ ? '9' : '8'}999999${n}-9999-4999-8999-999999999999`, quiz_id: quizId, external_id: `tq:${n}`, sort_order: n,
    question_text: `Question ${n}`, option_a: 'Root', option_b: 'Leaf', option_c: 'Stem', option_d: null,
    correct_option: 'B', explanation: `Because ${n}`, option_feedback: {}, media: {}, render_pattern: 'P1',
  }));
  db = {
    app_settings: [
      ...(home ? [{ key: 'quiz_teacher_home', value: true }] : []),
      ...(story ? [{ key: 'web_quiz_stories_teacher', value: true }] : []),
      { key: 'web_quiz_stories', value: true },
      { key: 'web_quiz_hub', value: true },
      { key: 'web_quiz_enabled', value: true },
      { key: 'web_quiz_teachers', value: 'all' },
    ],
    classes: [
      { id: CLS_MINE, grade_code: 'grade_3', section: 'A', shift_code: null, is_active: true },
      { id: CLS_OTHER, grade_code: 'grade_5', section: 'B', shift_code: null, is_active: true },
    ],
    class_teachers: [
      { class_id: CLS_MINE, teacher_user_id: TEACHER, is_active: true },
      { class_id: CLS_OTHER, teacher_user_id: OTHER, is_active: true },
    ],
    student_lists: [],
    story_books: [
      { id: BOOK, title: 'The Brave Little Ant', grade: 3, lang: 'en', pages: 6, minutes: 2, cover_file: 'cover-0a1b2c3d.webp', featured_rank: null, status: 'ready' },
      { id: BOOK_UR, title: 'ننھی چیونٹی کی ہمت', grade: 3, lang: 'ur', pages: 6, minutes: 2, cover_file: 'cover-4e5f6a7b.webp', featured_rank: null, status: 'ready' },
    ],
    story_pages: [],
    story_page_voices: [],
    story_events: [],
    users: [{ id: TEACHER, name: 'Ms Example Sender', phone_number: '+92300FIXTURE1', preferred_language: 'en' }],
    quizzes: [
      { id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'Science', language: 'en', meta: { web_arm: 'web' }, quiz_source: 'transcript', user_id: TEACHER },
      { id: QUIZ_UR, topic: 'پودے کے حصے', grade: '3', subject: 'Science', language: 'ur', meta: { web_arm: 'web' }, quiz_source: 'transcript', user_id: TEACHER },
      // A story send: the quiz row's topic is NOT what the picture names (the book's own title is).
      { id: QUIZ_ST, topic: 'Row topic never drawn', grade: '3', subject: null, language: 'en', meta: { story: { book_id: BOOK, lang: 'en' } }, quiz_source: 'story', user_id: TEACHER },
      { id: QUIZ_ST_UR, topic: 'Row topic never drawn', grade: '3', subject: null, language: 'ur', meta: { story: { book_id: BOOK_UR, lang: 'ur' } }, quiz_source: 'story', user_id: TEACHER },
    ],
    quiz_questions: [...questions(QUIZ), ...questions(QUIZ_UR)],
    quiz_share_codes: [
      code(SC, 'AB12CD', QUIZ),
      code(SC_UR, 'UR12CD', QUIZ_UR, { language: 'ur', topic: 'پودے کے حصے' }),
      // a child's challenge code (personal invite) and a "watch another video" code: never a class picture
      code(SC_CH, 'CH12CD', QUIZ, { invited_by_student_id: KID_A, parent_share_code_id: SC }),
      code(SC_MV, 'MV12CD', QUIZ, { parent_share_code_id: SC }),
      // a code of this teacher's that names ANOTHER teacher's class
      code(SC_OT, 'OT12CD', QUIZ, { class_id: CLS_OTHER }),
      code(SC_ST, 'ST12CD', QUIZ_ST, { topic: 'Row topic never drawn' }),
      code(SC_ST_UR, 'SU12CD', QUIZ_ST_UR, { language: 'ur', topic: 'Row topic never drawn' }),
      code(SC_ST_OT, 'SO12CD', QUIZ_ST, { class_id: CLS_OTHER, topic: 'Row topic never drawn' }),
    ],
    quiz_sessions: [
      { id: 's-a1', quiz_id: QUIZ, share_code_id: SC, student_id: KID_A, student_name: 'Zara Example', user_id: null,
        status: 'completed', correct_answers: 1, total_questions_answered: 2, mastery_percentage: 50,
        completed_at: ago(1), created_at: ago(1), invited_by_student_id: null },
    ],
    students: [{ id: KID_A, student_name: 'Zara Example', self_reported_class: '3' }],
    quiz_answers: [],
  };
  fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
function setFlags({ home, story }) {
  db.app_settings = db.app_settings.filter((r) => r.key !== 'quiz_teacher_home' && r.key !== 'web_quiz_stories_teacher');
  if (home) db.app_settings.push({ key: 'quiz_teacher_home', value: true });
  if (story) db.app_settings.push({ key: 'web_quiz_stories_teacher', value: true });
  resetCaches();
}
function resetCaches() {
  TeacherHome.reset();
  Stories._reset();
  Og._reset();
  Art._resetCache();
  if (ClassPic) ClassPic._reset();
  try { require('../../../shared/services/quiz/web-quiz-link')._resetCache(); } catch (_) { /* none */ }
  try { require('../../../shared/services/quiz/web-quiz-hub-flags')._resetCache(); } catch (_) { /* none */ }
  try { require('../../../shared/services/quiz/web-quiz-hub-flags')._reset(); } catch (_) { /* none */ }
}

let server; let base;
const KEY = { 'x-api-key': 'pic-key' };
const SAVED = { ...process.env };
let COVER;
let drawn;
beforeAll(async () => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'pic-key', WEB_QUIZ_BASE_URL: 'https://quiz.example.com', RAILWAY_ENVIRONMENT_NAME: 'sandbox' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  COVER = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#2E7D32' } }).webp().toBuffer();
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => { process.env = SAVED; return new Promise((r) => server.close(r)); });
beforeEach(() => {
  jest.clearAllMocks();
  require('../../../shared/services/cache/railway-redis.service').__keys.clear();
  seed();
  resetCaches();
  drawn = [];
  r2.downloadFromR2.mockReset().mockImplementation(async (key) => {
    if (/^story\/sandbox\/[0-9a-f-]{36}\/cover-[0-9a-f]{8}\.webp$/.test(key)) return COVER;
    throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
  });
  r2.uploadBuffer.mockReset().mockResolvedValue('https://r2/x');
  r2.headObject.mockReset().mockResolvedValue({ exists: false });
  htmlToImage.mockReset().mockImplementation(async (html, o) => {
    drawn.push(html);
    return sharp({ create: { width: o.width, height: o.height || 630, channels: 3, background: '#FFF8E7' } }).png().toBuffer();
  });
});

const get = async (p) => {
  const r = await fetch(`${base}${p}`, { headers: KEY });
  const type = r.headers.get('content-type') || '';
  const body = /json/.test(type) ? await r.json() : Buffer.from(await r.arrayBuffer());
  return { status: r.status, type, cache: r.headers.get('cache-control'), body };
};
const quiz = (c) => get(`/quiz/${c}`);
const pic = (ref, c) => get(`/art/${tId(ref)}${c ? `?c=${c}` : ''}`);
// What a picture shows, as text: the drawn HTML without its styles, fonts and pictures.
const shown = (html) => String(html).replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// ─── both switches off: today's answers, byte for byte ────────────────────────

describe('both switches off: the payload, the preview facts and the picture route are today\'s (goldens)', () => {
  async function offAnswers() {
    seed();
    resetCaches();
    const quizOut = await quiz('AB12CD');
    resetCaches();
    const ogQuiz = await get('/og/AB12CD');
    const picQuiz = await pic(SC, 'AB12CD');
    // the story kind: the story's own switch off too (a story code with no questions is today's 404)
    const storyOut = await quiz('ST12CD');
    const picStory = await pic(SC_ST, 'ST12CD');
    return {
      quiz_art: quizOut.body.art,
      og_quiz: ogQuiz.body,
      pic_quiz: { status: picQuiz.status, type: picQuiz.type, body: picQuiz.body },
      story_page: { status: storyOut.status, body: storyOut.body },
      pic_story: { status: picStory.status, type: picStory.type, body: picStory.body },
    };
  }

  test('class quiz and class story, off: equal to the goldens written before the picture existed', async () => {
    const got = await offAnswers();
    if (process.env.GOLDEN_WRITE === '1') {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    }
    const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(got).toEqual(want);
    expect(Object.keys(got.quiz_art).sort()).toEqual(['class', 'invite', 'schools']);
    expect(drawn).toHaveLength(0);
  });

  test('stories on, the teacher home off: a story code opens as today and carries no class picture', async () => {
    setFlags({ home: false, story: true });
    const out = await quiz('ST12CD');
    expect(out.status).toBe(200);
    expect(out.body.story).toBeTruthy();
    expect(Object.keys(out.body.art).sort()).toEqual(['class', 'invite', 'schools']);
    expect((await pic(SC_ST, 'ST12CD')).status).toBe(404);
  });

  test('the teacher home on, the story send off: a story code is today\'s 404, its picture refused', async () => {
    setFlags({ home: true, story: false });
    expect((await quiz('ST12CD')).status).toBe(404);
    const p = await pic(SC_ST, 'ST12CD');
    expect(p.status).toBe(404);
    expect(p.body).toEqual({ error: 'not_found' });
  });
});

// ─── on ───────────────────────────────────────────────────────────────────────

describe('class quiz (quiz_teacher_home on)', () => {
  beforeEach(() => setFlags({ home: true, story: false }));

  test('the payload names the class picture: a new signed kind for this class code, and its version', async () => {
    const out = await quiz('AB12CD');
    expect(out.status).toBe(200);
    expect(out.body.art.teach).toBe(tId(SC));
    expect(out.body.art.teach_v).toMatch(/^[0-9a-f]{8}$/);
    // today's pictures are kept as they were
    expect(out.body.art.class).toMatch(/^l\./);
    // the preview facts carry it too (a preview fetch reads these)
    resetCaches();
    expect((await get('/og/AB12CD')).body.art.teach).toBe(tId(SC));
  });

  test('the picture: a 1200x630 PNG within 40 KB, cached for good; the class label and the topic, nothing else', async () => {
    const p = await pic(SC, 'AB12CD');
    expect(p.status).toBe(200);
    expect(p.type).toBe('image/png');
    expect(p.cache).toMatch(/immutable/);
    const m = await sharp(p.body).metadata();
    expect([m.format, m.width, m.height]).toEqual(['png', 1200, 630]);
    expect(p.body.length).toBeLessThanOrEqual(40 * 1024);
    const text = shown(drawn[0]);
    expect(text).toContain('Class 3-A');
    expect(text).toContain('Parts of a plant');
    expect(text).not.toMatch(/Zara|Example|Sender|FIXTURE|\d+\s*\/\s*\d+|%|question/i);
    expect(text).not.toMatch(TEST_WORDS);
  });

  test('Urdu: the label in Urdu digits, never an ASCII digit on the picture', async () => {
    const out = await quiz('UR12CD');
    expect(out.body.art.teach).toBe(tId(SC_UR));
    const p = await pic(SC_UR, 'UR12CD');
    expect(p.status).toBe(200);
    const html = drawn[0];
    expect(html).toContain('<html lang="ur" dir="rtl">');
    const text = shown(html);
    expect(text).toContain('جماعت');
    expect(text).toContain('۳-A');
    expect(text).toContain('پودے کے حصے');
    expect(text).not.toMatch(/[0-9]/);
    expect(text).not.toMatch(TEST_WORDS);
  });

  test('the second fetch is answered from memory: no second draw', async () => {
    await pic(SC, 'AB12CD');
    await pic(SC, 'AB12CD');
    expect(htmlToImage).toHaveBeenCalledTimes(1);
  });

  test('the version moves when the class label moves, and only then', async () => {
    const v1 = (await quiz('AB12CD')).body.art.teach_v;
    resetCaches();
    expect((await quiz('AB12CD')).body.art.teach_v).toBe(v1);
    db.classes[0].section = 'B';
    resetCaches();
    const v2 = (await quiz('AB12CD')).body.art.teach_v;
    expect(v2).not.toBe(v1);
  });

  test('a topic that would put a test word on the picture: no class picture (today\'s)', async () => {
    db.quiz_share_codes[0].topic = 'Unit Test: plants';
    resetCaches();
    const out = await quiz('AB12CD');
    expect(out.body.art.teach).toBeUndefined();
    expect((await pic(SC, 'AB12CD')).status).toBe(404);
  });
});

describe('class story (quiz_teacher_home AND the story send on)', () => {
  beforeEach(() => setFlags({ home: true, story: true }));

  test('both on: the story payload names the class picture', async () => {
    const out = await quiz('ST12CD');
    expect(out.status).toBe(200);
    expect(out.body.story).toBeTruthy();
    expect(out.body.art.teach).toBe(tId(SC_ST));
    expect(out.body.art.teach_v).toMatch(/^[0-9a-f]{8}$/);
  });

  test('the picture: the class label, the BOOK\'s title (never the quiz row\'s topic) and its cover from storage', async () => {
    const p = await pic(SC_ST, 'ST12CD');
    expect(p.status).toBe(200);
    expect(p.type).toBe('image/png');
    expect(p.body.length).toBeLessThanOrEqual(40 * 1024);
    expect(r2.downloadFromR2).toHaveBeenCalledWith(`story/sandbox/${BOOK}/cover-0a1b2c3d.webp`, expect.anything());
    const html = drawn[0];
    expect(html).toMatch(/<img class="cover" src="data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{100}/);
    const text = shown(html);
    expect(text).toContain('Class 3-A');
    expect(text).toContain('The Brave Little Ant');
    expect(text).not.toContain('Row topic never drawn');
    expect(text).not.toMatch(/Zara|Example|Sender|FIXTURE|%|\d+\s*\/\s*\d+/);
    expect(text).not.toMatch(TEST_WORDS);
  });

  test('Urdu story: the Urdu title and the label in Urdu digits', async () => {
    const p = await pic(SC_ST_UR, 'SU12CD');
    expect(p.status).toBe(200);
    const text = shown(drawn[0]);
    expect(text).toContain('ننھی چیونٹی کی ہمت');
    expect(text).toContain('۳-A');
    expect(text).not.toMatch(/[0-9]/);
    expect(text).not.toMatch(TEST_WORDS);
  });

  test('the version moves when the book\'s title moves', async () => {
    const v1 = (await quiz('ST12CD')).body.art.teach_v;
    db.story_books[0].title = 'The Brave Little Ant Again';
    resetCaches();
    expect((await quiz('ST12CD')).body.art.teach_v).not.toBe(v1);
  });

  test('a cover storage cannot give: the picture is still drawn, without it', async () => {
    r2.downloadFromR2.mockReset().mockRejectedValue(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
    const p = await pic(SC_ST, 'ST12CD');
    expect(p.status).toBe(200);
    expect(drawn[0]).not.toContain('class="cover"');
    expect(shown(drawn[0])).toContain('The Brave Little Ant');
  });
});

// ─── whose picture ────────────────────────────────────────────────────────────

describe('never a child\'s link, never another teacher\'s class', () => {
  beforeEach(() => setFlags({ home: true, story: true }));

  test('a child\'s challenge code and a "watch another video" code carry no class picture', async () => {
    const ch = await quiz('CH12CD');
    expect(ch.status).toBe(200);
    expect(ch.body.art.teach).toBeUndefined();
    const mv = await quiz('MV12CD');
    expect(mv.body.art.teach).toBeUndefined();
  });

  test('the picture is not fetchable through a child\'s code, nor for a child\'s code, nor with no code', async () => {
    expect((await pic(SC, 'CH12CD')).status).toBe(404);
    expect((await pic(SC, 'MV12CD')).status).toBe(404);
    expect((await pic(SC_CH, 'CH12CD')).status).toBe(404);
    expect((await pic(SC_MV, 'MV12CD')).status).toBe(404);
    expect((await pic(SC)).status).toBe(404);
    expect((await pic(SC, 'UR12CD')).status).toBe(404);
    expect(drawn).toHaveLength(0);
  });

  test('a child-keyed kind never stands in: the class picture\'s mac under another letter is refused', async () => {
    const t = tId(SC);
    const asClass = `l.${t.split('.')[1]}.${t.split('.')[2]}`;
    expect((await get(`/art/${asClass}?c=AB12CD`)).status).toBe(404);
    const asCard = tId(SC, 'c');
    expect((await get(`/art/t.${asCard.split('.')[1]}.${asCard.split('.')[2]}?c=AB12CD`)).status).toBe(404);
  });

  test('a quiz code naming another teacher\'s class: no label, so no class quiz picture (today\'s)', async () => {
    const out = await quiz('OT12CD');
    expect(out.body.art.teach).toBeUndefined();
    expect((await pic(SC_OT, 'OT12CD')).status).toBe(404);
  });

  test('a story code naming another teacher\'s class: the book and its cover, and no class label', async () => {
    const out = await quiz('SO12CD');
    expect(out.body.art.teach).toBe(tId(SC_ST_OT));
    const p = await pic(SC_ST_OT, 'SO12CD');
    expect(p.status).toBe(200);
    const text = shown(drawn[0]);
    expect(text).toContain('The Brave Little Ant');
    expect(text).not.toMatch(/Class|5-B/);
  });
});

describe('the picture itself (pure)', () => {
  test('urDigits: every ASCII digit as its Urdu digit', () => {
    expect(ClassPic.urDigits('3-A · 10')).toBe('۳-A · ۱۰');
  });

  test('the four pictures say only their facts and the fixed words', () => {
    const cases = [
      [{ kind: 'quiz', lang: 'en', label: '3-A', topic: 'Parts of a plant' }, ['Class 3-A', 'Parts of a plant', 'Quiz', 'JUGNU']],
      [{ kind: 'quiz', lang: 'ur', label: '3-A', topic: 'پودے کے حصے' }, ['جماعت', '۳-A', 'پودے کے حصے', 'کوئز', 'JUGNU']],
      [{ kind: 'story', lang: 'en', label: '3-A', title: 'The Brave Little Ant' }, ['Class 3-A', 'The Brave Little Ant', 'Story', 'JUGNU']],
      [{ kind: 'story', lang: 'ur', label: '3-A', title: 'ننھی چیونٹی کی ہمت' }, ['جماعت', '۳-A', 'ننھی چیونٹی کی ہمت', 'کہانی', 'JUGNU']],
    ];
    for (const [f, words] of cases) {
      const text = shown(ClassPic.renderClassPic(f, { fonts: false }));
      for (const w of words) expect(text).toContain(w);
      expect(text).not.toMatch(TEST_WORDS);
      if (f.lang === 'ur') expect(text).not.toMatch(/[0-9]/);
    }
  });
});
