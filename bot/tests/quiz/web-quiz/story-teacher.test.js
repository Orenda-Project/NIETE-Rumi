'use strict';
/**
 * A teacher sends a storybook to the class (story-teacher.service.js, app_settings web_quiz_stories_teacher):
 * the shelf, the send (one quizzes row per teacher × book, one live code, the class message), the child's /q/<code>
 * opening the book, the hub door for an unfinished story session, the class report from story_events, and the
 * switch-off goldens. Supabase, SQS, Redis and WhatsApp are the boundaries and are faked; every first-party module
 * on the path runs for real.
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
  sendMessage: jest.fn().mockResolvedValue(true), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockRejectedValue(new Error('no renderer in test env')) }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WhatsAppService = require('../../../shared/services/whatsapp.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Stories = require('../../../shared/services/quiz/story-teacher.service');
const Door = require('../../../shared/services/quiz/web-quiz-hub-door');
const Report = require('../../../shared/services/quiz/video-quiz-report.service');
const Draw = require('../../../shared/services/quiz/web-quiz-challenge-draw');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const OTHER = '11111111-1111-4111-8111-222222222222';
const KID_A = '44444444-4444-4444-8444-444444444444';
const KID_B = '44444444-4444-4444-8444-555555555555';
const B = (n) => `bbbbbbb${n}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
const DEVICE = 'AbCdEfGhIjKlMnOpQrStUv';   // a phone's device ref (22 url-safe characters)
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

const book = (n, grade, lang, extra = {}) => ({
  id: B(n), title: `Book ${n} Testwala`, grade, lang, pages: 6, minutes: 2.5, cover_file: `cover-0000000${n}.webp`,
  featured_rank: null, status: 'ready', ...extra,
});

let fake;
let db;
function seed({ on = true, web = true } = {}) {
  db = {
    app_settings: [
      ...(on ? [{ key: 'web_quiz_stories_teacher', value: true }] : []),
      { key: 'web_quiz_stories', value: true },
      ...(web ? [{ key: 'web_quiz_enabled', value: true }, { key: 'web_quiz_teachers', value: 'all' }] : []),
      { key: 'web_quiz_hub', value: true },
    ],
    story_books: [
      book(1, 2, 'en'), book(2, 2, 'en', { featured_rank: 1 }), book(3, 2, 'en'), book(4, 2, 'en'), book(5, 2, 'en'),
      book(6, 2, 'en', { status: 'draft' }), book(7, 3, 'en'), book(8, 2, 'ur', { title: 'کتاب Testwala' }),
    ],
    story_pages: [{ id: 'pg-2-1', book_id: B(2), n: 1, image_file: 'p01-00000002.webp' }, { id: 'pg-2-2', book_id: B(2), n: 2, image_file: 'p02-00000002.webp' }],
    story_page_voices: [{ page_id: 'pg-2-1', audio_key: `story/sandbox/${B(2)}/a01-1a2b3c4d.ogg`, is_current: true },
      { page_id: 'pg-2-1', audio_key: `story/sandbox/${B(2)}/a01-00000000.ogg`, is_current: false }],
    users: [{ id: TEACHER, name: 'Ms Example Testwala', phone_number: 'teacher-phone', preferred_language: 'en' },
      { id: OTHER, name: 'Mr Other Testwala', phone_number: 'other-phone', preferred_language: 'en' }],
    quizzes: [],
    quiz_questions: [],
    quiz_share_codes: [],
    quiz_sessions: [],
    story_events: [],
    challenge_passages: [],
    students: [{ id: KID_A, student_name: 'Zara Testwala' }, { id: KID_B, student_name: 'Ali Testwala' }],
  };
  fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

// The table's defaults (create_video_quiz_tables.sql): a minted code is active.
const dbDefaults = () => db.quiz_share_codes.forEach((c) => { if (c.active === undefined) c.active = true; });
// The teacher home's token shape (teacher-home.token.js): `via` names the door it was opened from; its verifier refuses one without it.
const th = (uid = TEACHER, lang = 'en') => T.sign({ k: 'th', uid, lang, via: 'go', exp: Math.floor(Date.now() / 1000) + 3600 });

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_BASE_URL: 'https://quiz.example.com', REFERRAL_BOT_NUMBER: '0000' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  jest.clearAllMocks();
  require('../../../shared/services/cache/railway-redis.service').__keys.clear();
  Stories._reset();
  require('../../../shared/services/quiz/web-quiz-link')._resetCache();
  require('../../../shared/services/quiz/teacher-report-gate')._resetCache();
  try { require('../../../shared/services/quiz/web-quiz-hub-flags')._resetCache(); } catch (_) { /* no cache */ }
  try { require('../../../shared/services/quiz/web-quiz-hub-flags')._reset(); } catch (_) { /* no cache */ }
  seed();
});
afterAll(() => { process.env = SAVED; });

describe('the story shelf', () => {
  test('ready books of the grade and language, the featured one first, four of them', async () => {
    const out = await Stories.shelf({ uid: TEACHER, grade: 2, lang: 'en' });
    expect(out.books).toHaveLength(4);
    expect(out.books[0]).toEqual({ id: B(2), title: 'Book 2 Testwala', grade: 2, lang: 'en', dir: 'ltr', pages: 6, minutes: 2.5,
      cover: `/s/${B(2)}/cover-00000002.webp`, featured: true, first_page: `/s/${B(2)}/p01-00000002.webp`, sample_audio: `/s/${B(2)}/a01-1a2b3c4d.ogg` });
    expect(out.books.map((b) => b.id)).not.toContain(B(6));   // a draft never shows
    expect(out.books.map((b) => b.id)).not.toContain(B(7));   // another grade
    expect(out.books.slice(1).every((b) => b.featured === false)).toBe(true);
  });
  test('all=1 gives every ready book; the order is the same for one teacher on one day', async () => {
    const a = await Stories.shelf({ uid: TEACHER, grade: 2, lang: 'en', all: true });
    const b = await Stories.shelf({ uid: TEACHER, grade: 2, lang: 'en', all: true });
    expect(a.books.map((x) => x.id).sort()).toEqual([B(1), B(2), B(3), B(4), B(5)].sort());
    expect(a.books.map((x) => x.id)).toEqual(b.books.map((x) => x.id));
  });
  test('Urdu books are right to left', async () => {
    const out = await Stories.shelf({ uid: TEACHER, grade: 2, lang: 'ur' });
    expect(out.books).toEqual([expect.objectContaining({ id: B(8), dir: 'rtl' })]);
  });
  test('switch off: 404 stories_off and no book is read', async () => {
    seed({ on: false });
    await expect(Stories.shelf({ uid: TEACHER, grade: 2, lang: 'en' })).rejects.toMatchObject({ status: 404, body: { error: 'stories_off' } });
    expect(fake.calls.some((c) => c.t === 'story_books')).toBe(false);
  });
  test('a teacher-home token names the teacher; anything else is no one', () => {
    expect(Stories.teacherOf(th())).toBe(TEACHER);
    expect(Stories.teacherOf(T.sign({ k: 'h', uid: TEACHER, exp: Math.floor(Date.now() / 1000) + 60 }))).toBeNull();
    expect(Stories.teacherOf('nope')).toBeNull();
  });
});

describe('the send', () => {
  test('one story quiz row with the book in meta, no questions, a 30-day code and the class message', async () => {
    const out = await Stories.share({ uid: TEACHER, storyId: B(1) });
    expect(db.quizzes).toHaveLength(1);
    const q = db.quizzes[0];
    expect(q).toMatchObject({ teacher_id: TEACHER, quiz_source: 'story', topic: 'Book 1 Testwala', grade: '2', language: 'en', status: 'sent' });
    // The sender's own row with no class list: the class is never derived from another teacher's list.
    expect(q.list_id == null).toBe(true);
    expect(q.meta).toMatchObject({ story: { book_id: B(1), lang: 'en' }, share_code: out.code, link: out.link, student_message: out.class_message });
    expect(q.meta.sent_at).toBeTruthy();
    expect(q.meta.first_sent_at).toBeTruthy();
    expect(db.quiz_questions).toHaveLength(0);
    expect(db.quiz_share_codes).toHaveLength(1);
    const sc = db.quiz_share_codes[0];
    expect(sc).toMatchObject({ code: out.code, quiz_id: q.id, teacher_user_id: TEACHER, language: 'en' });
    const days = (Date.parse(sc.expires_at) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(out.link).toBe(`https://quiz.example.com/q/${out.code}`);
    expect(out.class_message).toContain('Book 1 Testwala');
    expect(out.class_message).toContain(out.link);
    expect(out.class_message).toContain('Ms Example Testwala');
    expect(out.class_message).not.toMatch(/\btest\b|\bexam\b|assessment/i);
    expect(logEvent).toHaveBeenCalledWith('teacher_story_sent', expect.objectContaining({ book_id: B(1), reused: false }));
    // the bot sends nothing: the teacher forwards the message
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });
  test('the same teacher sending the same book again gets the same code (no second row, no second code)', async () => {
    const a = await Stories.share({ uid: TEACHER, storyId: B(1) });
    const b = await Stories.share({ uid: TEACHER, storyId: B(1) });
    expect(b.code).toBe(a.code);
    expect(db.quizzes).toHaveLength(1);
    expect(db.quiz_share_codes).toHaveLength(1);
    expect(logEvent).toHaveBeenLastCalledWith('teacher_story_sent', expect.objectContaining({ reused: true }));
  });
  test('an expired code is not reused: a new one is minted on the same row', async () => {
    const a = await Stories.share({ uid: TEACHER, storyId: B(1) });
    db.quiz_share_codes[0].expires_at = ago(1);
    const b = await Stories.share({ uid: TEACHER, storyId: B(1) });
    expect(b.code).not.toBe(a.code);
    expect(db.quizzes).toHaveLength(1);
    expect(db.quiz_share_codes).toHaveLength(2);
  });
  test('another teacher, or another book, is its own send', async () => {
    const a = await Stories.share({ uid: TEACHER, storyId: B(1) });
    const b = await Stories.share({ uid: OTHER, storyId: B(1) });
    const c = await Stories.share({ uid: TEACHER, storyId: B(3) });
    expect(new Set([a.code, b.code, c.code]).size).toBe(3);
    expect(db.quizzes).toHaveLength(3);
  });
  test('a picked class binds the code only when it is this teacher\'s; another teacher\'s class id binds nothing', async () => {
    const HandoutClass = require('../../../shared/services/quiz/handout-class.service');
    const MINE = ['66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000002'];
    const THEIRS = '66666666-6666-4666-8666-000000000009';
    const spy = jest.spyOn(HandoutClass, 'resolveClass').mockResolvedValue({ state: 'ambiguous', class: null, classes: MINE.map((id) => ({ id })) });
    try {
      await Stories.share({ uid: TEACHER, storyId: B(1), classId: THEIRS });
      expect(db.quiz_share_codes).toHaveLength(1);
      expect(db.quiz_share_codes[0].class_id == null).toBe(true);
      await Stories.share({ uid: TEACHER, storyId: B(3), classId: MINE[1] });
      expect(db.quiz_share_codes[1].class_id).toBe(MINE[1]);
    } finally { spy.mockRestore(); }
  });
  test('an Urdu book sends the Urdu message', async () => {
    const out = await Stories.share({ uid: TEACHER, storyId: B(8) });
    expect(out.class_message).toContain('کہانی');
    expect(out.class_message).toContain('کتاب Testwala');
    expect(db.quiz_share_codes[0].language).toBe('ur');
  });
  test('a book that is not ready, or not a book, is refused and nothing is written', async () => {
    await expect(Stories.share({ uid: TEACHER, storyId: B(6) })).rejects.toMatchObject({ status: 404, body: { error: 'no_story' } });
    await expect(Stories.share({ uid: TEACHER, storyId: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(Stories.share({ uid: null, storyId: B(1) })).rejects.toMatchObject({ status: 401 });
    expect(db.quizzes).toHaveLength(0);
  });
  test('with the web quiz off for this teacher there is no page to open: refused, never a WhatsApp quiz link', async () => {
    seed({ web: false });
    await expect(Stories.share({ uid: TEACHER, storyId: B(1) })).rejects.toMatchObject({ status: 409, body: { error: 'web_quiz_off' } });
  });
  test('switch off: 404 and nothing is written', async () => {
    seed({ on: false });
    await expect(Stories.share({ uid: TEACHER, storyId: B(1) })).rejects.toMatchObject({ status: 404, body: { error: 'stories_off' } });
    expect(db.quizzes).toHaveLength(0);
    expect(db.quiz_share_codes).toHaveLength(0);
  });
  test('a send never writes a challenge passage (the Challenge draw, the Book and the week story never see a storybook)', async () => {
    await Stories.share({ uid: TEACHER, storyId: B(1) });
    expect(db.challenge_passages).toHaveLength(0);
    expect(fake.calls.some((c) => c.t === 'challenge_passages')).toBe(false);
  });
});

describe('the preview and the tap', () => {
  test('the preview readies the send (row + code) without marking it sent, and shows the exact message', async () => {
    const pv = await Stories.preview({ uid: TEACHER, storyId: B(1), ui: 'ur' });
    expect(db.quizzes).toHaveLength(1);
    expect(db.quizzes[0].status).toBe('ready');
    expect(db.quizzes[0].meta.sent_at).toBeUndefined();
    expect(pv.book).toMatchObject({ id: B(1), title: 'Book 1 Testwala' });
    expect(pv.class_message).toContain(pv.link);
    expect(pv.wa_href).toBe(`https://wa.me/?text=${encodeURIComponent(pv.class_message)}`);
    expect(pv.back_line).toBe('بھیجنے کے بعد اپنی چیٹ میں بٹن دبا کر یہاں واپس آئیں۔');
    expect(pv.report_line).toBe('رپورٹ ہمیشہ کی طرح آپ کو واٹس ایپ پر ملے گی۔');
    expect(logEvent).not.toHaveBeenCalledWith('teacher_story_sent', expect.anything());
  });
  test('the tap marks it sent and answers wa.me with the same message and the same code', async () => {
    const pv = await Stories.preview({ uid: TEACHER, storyId: B(1) });
    const out = await Stories.send({ uid: TEACHER, storyId: B(1) });
    expect(out.redirect).toBe(pv.wa_href);
    expect(db.quizzes[0].status).toBe('sent');
    expect(db.quiz_share_codes).toHaveLength(1);
    // the preview's code, opened by this tap: the same code, not a second send of an open one
    expect(logEvent).toHaveBeenCalledWith('teacher_story_sent', expect.objectContaining({ book_id: B(1), reused: false }));
  });
  test('the way back line (the teacher home\'s copy object) ends the class message when it is deployed', async () => {
    // The copy object's returnLine is async (it reads its own switch). A fresh module registry for this test only, so
    // the mock replaces the real copy object wherever it is deployed (virtual only while the file is absent: a virtual
    // mock never stands in for a file that exists); the fake database goes on that registry's supabase.
    const copy = '../../../shared/services/first-touch/teacher-home.copy';
    const deployed = require('fs').existsSync(require('path').join(__dirname, `${copy}.js`));
    jest.doMock(copy, () => ({ returnLine: async (l) => (l === 'ur' ? 'واپسی Testwala' : 'Any day: send quiz Testwala') }), { virtual: !deployed });
    try {
      await jest.isolateModulesAsync(async () => {
        Object.assign(require('../../../shared/config/supabase'), { from: fake.from, rpc: fake.rpc });
        const out = await require('../../../shared/services/quiz/story-teacher.service').share({ uid: TEACHER, storyId: B(1) });
        expect(out.class_message.endsWith('\n\nAny day: send quiz Testwala')).toBe(true);
      });
    } finally {
      jest.dontMock(copy);
    }
  });
});

describe('the Stories page (the bot renders it)', () => {
  const Routes = require('../../../shared/routes/story-teacher-internal.routes');
  function res() {
    const r = { code: 200, headers: {}, body: null, type: null };
    r.set = (k, v) => { r.headers[k] = v; return r; };
    r.status = (c) => { r.code = c; return r; };
    r.type = (t) => { r.ctype = t; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
  }
  test('the shelf: grade and language chips as links, the featured book first, in the teacher\'s language', async () => {
    const r = res();
    await Routes.servePage({ params: { th: th(TEACHER, 'en') }, query: { grade: '2', lang: 'en' } }, r);
    expect(r.code).toBe(200);
    expect(r.ctype).toBe('html');
    expect(r.body).toContain('<html lang="en" dir="ltr">');
    expect(r.body).toContain('data-screen="teacher-stories"');
    expect(r.body.indexOf('Book 2 Testwala')).toBeLessThan(r.body.indexOf('Book 1 Testwala'));
    expect(r.body).toContain('Picked for you');
    expect((r.body.match(/data-tap="grade"/g) || []).length).toBe(5);
    expect(r.body).not.toContain('Book 6 Testwala');
  });
  test('a book: the preview with ONE primary "Send to class", the exact message, and the report line', async () => {
    const r = res();
    await Routes.servePage({ params: { th: th(TEACHER, 'ur') }, query: { grade: '2', lang: 'en', book: B(2) } }, r);
    expect(r.code).toBe(200);
    expect(r.body).toContain('data-screen="teacher-story-preview"');
    expect((r.body.match(/data-primary/g) || []).length).toBe(1);
    expect(r.body).toContain('کلاس کو بھیجیں');
    expect(r.body).toContain('<form method="post" action="/api/teacher/story/send">');
    expect(r.body).toContain(`name="story_id" value="${B(2)}"`);
    expect(r.body).toContain(`<audio controls preload="none" src="/s/${B(2)}/a01-1a2b3c4d.ogg">`);
    expect(r.body).toContain('بھیجنے کے بعد اپنی چیٹ میں بٹن دبا کر یہاں واپس آئیں۔');
    expect(r.body).toContain('Book 2 Testwala');
    expect(r.body).toContain(`/s/${B(2)}/p01-00000002.webp`);
    expect(r.body).toContain('رپورٹ ہمیشہ کی طرح آپ کو واٹس ایپ پر ملے گی');
    expect(r.body).toContain('wq-nastaliq-3.woff2');
    // a book with no voice yet: no player at all
    const none = res();
    await Routes.servePage({ params: { th: th(TEACHER, 'en') }, query: { grade: '2', lang: 'en', book: B(1) } }, none);
    expect(none.code).toBe(200);
    expect(none.body).toContain('data-screen="teacher-story-preview"');
    expect(none.body).not.toContain('<audio');
  });
  test('switch off: 404 stories_off, no page (the portal falls through to today)', async () => {
    seed({ on: false });
    const r = res();
    await Routes.servePage({ params: { th: th() }, query: {} }, r);
    expect(r.code).toBe(404);
    expect(r.body).toEqual({ error: 'stories_off' });
  });
  test('a fresh profile (no cookie, no stored language, a teacher with no sends, no class and no books on the shelf): today\'s shape', async () => {
    // teacher-stories.page, rendered by the bot for a phone that has never opened it
    db.story_books = [];
    db.story_pages = [];
    db.story_page_voices = [];
    const r = res();
    await Routes.servePage({ params: { th: th(TEACHER, 'en') }, query: {}, headers: {} }, r);
    expect(r.code).toBe(200);
    expect(r.ctype).toBe('html');
    expect(r.body).toContain('<html lang="en" dir="ltr">');
    expect(r.body).toContain('data-screen="teacher-stories"');
    expect((r.body.match(/data-tap="grade"/g) || []).length).toBe(5);
    expect(r.body).toContain('No stories here — pick another grade or language.');
    expect(r.body).not.toMatch(/localStorage|document\.cookie/);
    expect(db.quizzes).toHaveLength(0);
    expect(db.quiz_share_codes).toHaveLength(0);
  });
});

describe('the teacher\'s web report of a story send', () => {
  async function sentWithKids() {
    await Stories.share({ uid: TEACHER, storyId: B(1) });
    const sc = db.quiz_share_codes[0];
    const q = db.quizzes[0];
    q.meta.first_sent_at = ago(30);
    db.quiz_sessions.push(
      { id: 's-a', quiz_id: q.id, share_code_id: sc.id, student_id: KID_A, student_name: 'Zara Testwala', user_id: null, status: 'in_progress', invited_by_student_id: null, created_at: ago(20), device_ref: 'd1', correct_answers: 0, total_questions_answered: 0 },
    );
    db.story_events.push({ child_id: KID_A, book_id: B(1), page_n: 1, event: 'story_page_listened', data: {}, at: ago(10) },
      { child_id: KID_A, book_id: B(1), page_n: 1, event: 'story_page_read', data: { skipped_words: ['kite'] }, at: ago(10) },
      { child_id: KID_A, book_id: B(1), page_n: null, event: 'story_questions_done', data: { correct: 3, total: 4, by_kind: { literal: [2, 2], inference: [1, 2] } }, at: ago(9) });
    return q;
  }
  test('quizReport carries the story counts and rows; the page shows them instead of scores and questions', async () => {
    const q = await sentWithKids();
    const Data = require('../../../shared/services/quiz/teacher-report.data');
    const r = await Data.quizReport(TEACHER, q.id);
    expect(r.story.counts).toEqual({ opened: 1, listened: 1, read: 1, questions: 1 });
    expect(r.story.children).toEqual([expect.objectContaining({ first: 'Zara', listened: 1, read: 1, questions: { correct: 3, total: 4 } })]);
    expect(r.story.kinds).toEqual([{ kind: 'literal', right: 2, total: 2 }, { kind: 'inference', right: 1, total: 2 }]);
    expect(r.story.words).toEqual(['kite']);
    const { renderPage } = require('../../../shared/templates/teacher-report.page');
    const html = renderPage({ quiz: r }, { lang: 'en', tokens: { self: 'tok' } });
    expect(html).toContain('id="story-children"');
    expect(html).toContain('Finds facts in the story');
    expect(html).toContain('<bdi class="num">3/4</bdi>');
    expect(r.summary.avg).toBeNull();
    expect(r.reminder.text).toBe(db.quizzes[0].meta.student_message);
    expect(html).not.toContain('id="questions"');
    expect(html).not.toContain('id="scores"');
  });
  test('a quiz that is not a story has no story key (golden)', async () => {
    db.quizzes.push({ id: 'q-lp', teacher_id: TEACHER, quiz_source: 'lp_v8', topic: 'Plants', status: 'sent', meta: {}, created_at: ago(5), language: 'en' });
    const r = await require('../../../shared/services/quiz/teacher-report.data').quizReport(TEACHER, 'q-lp');
    expect(r).not.toHaveProperty('story');
  });
  test('the class page never averages a story send as 0 %', async () => {
    await sentWithKids();
    db.quizzes[0].created_at = ago(1);
    const c = await require('../../../shared/services/quiz/teacher-report.data').classReport(TEACHER);
    const row = c.quizzes.find((x) => x.source === 'story');
    expect(row.played).toBe(1);
    expect(row.avg).toBeNull();
  });
});

describe('a preview is not a send', () => {
  test('the code a preview makes is closed: the child link does not open and no hub shows it; the tap opens it', async () => {
    const pv = await Stories.preview({ uid: TEACHER, storyId: B(1) });
    expect(db.quiz_share_codes).toHaveLength(1);
    expect(db.quiz_share_codes[0].active).toBe(false);
    await expect(WQ.getQuiz(pv.code)).rejects.toMatchObject({ status: 410 });
    const again = await Stories.preview({ uid: TEACHER, storyId: B(1) });
    expect(again.code).toBe(pv.code);
    expect(db.quiz_share_codes).toHaveLength(1);
    await Stories.send({ uid: TEACHER, storyId: B(1) });
    expect(db.quiz_share_codes[0].active).toBe(true);
    const out = await WQ.getQuiz(pv.code);
    expect(out.story).toEqual({ id: B(1), from_teacher: true, code: pv.code });
  });
  test('two first previews at once keep one row', async () => {
    await Promise.all([Stories.preview({ uid: TEACHER, storyId: B(1) }), Stories.preview({ uid: TEACHER, storyId: B(1) })]);
    expect(db.quizzes).toHaveLength(1);
  });
});

describe('the switch reads (goldens)', () => {
  const states = { absent: null, false: false, yes: 'yes', 'string true': 'true', one: 1, object: { enabled: true } };
  for (const [name, v] of Object.entries(states)) {
    test(`web_quiz_stories_teacher ${name}: off — the /q 404 and the hub door are today's`, async () => {
      const sent = await Stories.share({ uid: TEACHER, storyId: B(1) });
      dbDefaults();
      db.app_settings = db.app_settings.filter((r) => r.key !== 'web_quiz_stories_teacher');
      if (v !== null) db.app_settings.push({ key: 'web_quiz_stories_teacher', value: v });
      Stories._reset();
      await expect(WQ.getQuiz(sent.code)).rejects.toMatchObject({ status: 404, body: { error: 'no_questions' } });
      expect(await Stories.storyDoorOk({ share_code_id: db.quiz_share_codes[0].id })).toBe(false);
    });
  }
  test('the read throws: off', async () => {
    const real = supabase.from;
    supabase.from = (t) => (t === 'app_settings' ? { select: () => ({ in: () => Promise.reject(new Error('down')) }) } : real(t));
    Stories._reset();
    expect(await Stories.flagOn()).toBe(false);
    supabase.from = real;
  });
  test('needs the child\'s stories and hub: either off, the teacher switch is off', async () => {
    for (const key of ['web_quiz_stories', 'web_quiz_hub']) {
      seed();
      db.app_settings = db.app_settings.filter((r) => r.key !== key);
      Stories._reset();
      expect(await Stories.flagOn()).toBe(false);
    }
  });
  test('a quiz row that carries a story key but is not a story send is not opened as one', async () => {
    const sent = await Stories.share({ uid: TEACHER, storyId: B(1) });
    dbDefaults();
    db.quizzes[0].quiz_source = 'lp_v8';
    await expect(WQ.getQuiz(sent.code)).rejects.toMatchObject({ status: 404, body: { error: 'no_questions' } });
  });
});

describe('story sends in the teacher\'s other quiz lists', () => {
  test('the reports list: a story send counts joined children and has no average', async () => {
    await Stories.share({ uid: TEACHER, storyId: B(1) });
    const sc = db.quiz_share_codes[0];
    db.quiz_sessions.push({ id: 's-a', quiz_id: sc.quiz_id, share_code_id: sc.id, student_id: KID_A, student_name: 'Zara Testwala', user_id: null, status: 'in_progress', invited_by_student_id: null, created_at: ago(2), device_ref: 'd1' });
    const List = require('../../../shared/services/quiz/teacher-report-list.service');
    const stats = await List.statsFor(TEACHER, [db.quizzes[0]]);
    expect(stats.get(db.quizzes[0].id)).toMatchObject({ played: 1, avg: null });
  });
  test('the teacher home\'s Stories tile counts: stories sent and the children who opened them (a preview is neither; off = null)', async () => {
    expect(await Stories.storyCounts(TEACHER)).toEqual({ sent: 0, opened: 0 });
    await Stories.share({ uid: TEACHER, storyId: B(1) });
    await Stories.share({ uid: TEACHER, storyId: B(3) });
    await Stories.preview({ uid: TEACHER, storyId: B(4) });
    await Stories.share({ uid: OTHER, storyId: B(1) });
    const [a, b] = db.quiz_share_codes.filter((c) => c.teacher_user_id === TEACHER && c.active !== false);
    const other = db.quiz_share_codes.find((c) => c.teacher_user_id === OTHER);
    const s = (id, sc, kid) => ({ id, quiz_id: sc.quiz_id, share_code_id: sc.id, student_id: kid, student_name: 'Zara Testwala', user_id: null, status: 'in_progress', invited_by_student_id: null, created_at: ago(2), device_ref: id });
    db.quiz_sessions.push(s('s1', a, KID_A), s('s2', b, KID_A), s('s3', b, KID_B), s('s4', other, '44444444-4444-4444-8444-666666666666'));
    expect(await Stories.storyCounts(TEACHER)).toEqual({ sent: 2, opened: 2 });
    expect(await Stories.storyCounts(OTHER)).toEqual({ sent: 1, opened: 1 });
    expect(await Stories.storyCounts(null)).toBeNull();
    db.app_settings = db.app_settings.filter((r) => r.key !== 'web_quiz_stories_teacher');
    Stories._reset();
    expect(await Stories.storyCounts(TEACHER)).toBeNull();
  });
  test('the quiz menu never lists a story send as a quiz to cancel', async () => {
    await Stories.preview({ uid: TEACHER, storyId: B(1) });
    const Flow = require('../../../shared/routes/quiz-flow-endpoint');
    const out = await Flow.handleQuizFlowInit(TEACHER);
    expect(out.data.actions.map((a) => a.id)).not.toContain('cancel');
  });
});

describe('a storybook row is never a counted draw (the guard)', () => {
  test('drawPassage(counted) skips practice-pool and non-read kinds, whatever their status', () => {
    const now = new Date();
    const rows = [
      { passage_id: 'en.storybook.x', lang: 'en', kind: 'storybook', pool: 'practice', band: 1, status: 'reviewed', released_at: ago(48), provenance: 'reviewer_levelled' },
      { passage_id: 'en.storybook.y', lang: 'en', kind: 'storybook', pool: 'check', band: 1, status: 'calibrated', released_at: ago(48), provenance: 'published_calibrated' },
      { passage_id: 'en.read.p', lang: 'en', kind: 'read', pool: 'practice', band: 1, status: 'reviewed', released_at: ago(48), provenance: 'reviewer_levelled' },
    ];
    const d = Draw.drawPassage({ rows, seenIds: new Set(), kind: 'read', lang: 'en', band: 1, now, seed: 'ab'.repeat(16), counted: true });
    expect(d.id).toBeNull();
    expect(d.outcome).toBe('on_its_way');
  });
});

describe('the child opens /q/<code> of a story send', () => {
  test('the page gets the story to open (and the class join as for any quiz)', async () => {
    const sent = await Stories.share({ uid: TEACHER, storyId: B(1) });
    dbDefaults();
    const out = await WQ.getQuiz(sent.code);
    expect(out.story).toEqual({ id: B(1), from_teacher: true, code: sent.code });
    expect(out.quiz).toMatchObject({ code: sent.code, n: 0, questions: [] });
    expect(out.cls).toBeTruthy();
  });
  test('a story asks for no quiz read-aloud clips (it has no questions to record)', async () => {
    const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
    const sent = await Stories.share({ uid: TEACHER, storyId: B(1) });
    dbDefaults();
    const spy = jest.spyOn(Publish, 'requestQuizAudio').mockResolvedValue(null);
    try {
      const out = await WQ.getQuiz(sent.code);
      expect(out.story).toBeTruthy();
      expect(out.audio_pending).toBeFalsy();
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  test('switch off: the code is the 404 a quiz with no questions always was (golden)', async () => {
    const sent = await Stories.share({ uid: TEACHER, storyId: B(1) });
    dbDefaults();
    db.app_settings = db.app_settings.filter((r) => r.key !== 'web_quiz_stories_teacher');
    Stories._reset();
    await expect(WQ.getQuiz(sent.code)).rejects.toMatchObject({ status: 404, body: { error: 'no_questions' } });
  });
});

describe('the hub door for a story session', () => {
  async function storySession() {
    const sent = await Stories.share({ uid: TEACHER, storyId: B(1) });
    dbDefaults();
    const sc = db.quiz_share_codes[0];
    db.quiz_sessions.push({ id: 's-1', quiz_id: sc.quiz_id, share_code_id: sc.id, student_id: KID_A, student_name: 'Zara Testwala', user_id: null,
      status: 'in_progress', invited_by_student_id: null, device_ref: 'd1', created_at: ago(1) });
    return { sent, st: T.signSession({ sessionId: 's-1', deviceRef: DEVICE, shareCodeId: sc.id }) };
  }
  const Err = class extends Error { constructor(status, body) { super(body.error); this.status = status; this.body = body; } };
  test('an unfinished session of a story send opens the hub', async () => {
    const { st } = await storySession();
    const out = await Door.door({ st, story: 1 }, Err);
    expect(out.href).toMatch(/^\/h\/[A-Za-z0-9._-]+$/);
  });
  test('without `story`, or with the switch off, the unfinished session gets today\'s refusal (golden)', async () => {
    const { st } = await storySession();
    await expect(Door.door({ st }, Err)).rejects.toMatchObject({ status: 404 });
    db.app_settings = db.app_settings.filter((r) => r.key !== 'web_quiz_stories_teacher');
    Stories._reset();
    await expect(Door.door({ st, story: 1 }, Err)).rejects.toMatchObject({ status: 404 });
  });
  test('a quiz that is not a story never opens early', async () => {
    db.quizzes.push({ id: 'q-video', quiz_source: 'video', meta: {}, topic: 'A video' });
    db.quiz_share_codes.push({ id: 'sc-v', code: 'VV22VV', quiz_id: 'q-video', teacher_user_id: TEACHER, active: true, expires_at: new Date(Date.now() + 864e5).toISOString(), invited_by_student_id: null });
    db.quiz_sessions.push({ id: 's-v', quiz_id: 'q-video', share_code_id: 'sc-v', student_id: KID_A, status: 'in_progress', invited_by_student_id: null, user_id: null });
    const st = T.signSession({ sessionId: 's-v', deviceRef: DEVICE, shareCodeId: 'sc-v' });
    await expect(Door.door({ st, story: 1 }, Err)).rejects.toMatchObject({ status: 404 });
  });
});

describe('the class report of a story send', () => {
  test('per child: pages listened, pages read aloud, the questions — sent to the teacher, stamped', async () => {
    await Stories.share({ uid: TEACHER, storyId: B(1) });
    const sc = db.quiz_share_codes[0];
    const q = db.quizzes[0];
    q.meta.first_sent_at = ago(30);
    db.story_events.push({ child_id: KID_A, book_id: B(1), page_n: 2, event: 'story_page_read', data: { skipped_words: ['window', 'long'] }, at: ago(7) },
      { child_id: KID_B, book_id: B(1), page_n: 1, event: 'story_page_read', data: { skipped_words: ['window'] }, at: ago(7) },
      { child_id: KID_A, book_id: B(1), page_n: null, event: 'story_questions_done', data: { correct: 4, total: 4, by_kind: { literal: [2, 2], inference: [1, 1], vocab: [1, 1] } }, at: ago(6) },
      { child_id: KID_B, book_id: B(1), page_n: null, event: 'story_questions_done', data: { correct: 1, total: 4, by_kind: { literal: [1, 2], inference: [0, 1], vocab: [0, 1] } }, at: ago(6) });
    db.quiz_sessions.push(
      { id: 's-a', quiz_id: q.id, share_code_id: sc.id, student_id: KID_A, student_name: 'Zara Testwala', user_id: null, status: 'in_progress', invited_by_student_id: null, created_at: ago(20), device_ref: 'd1' },
      { id: 's-b', quiz_id: q.id, share_code_id: sc.id, student_id: KID_B, student_name: 'Ali Testwala', user_id: null, status: 'in_progress', invited_by_student_id: null, created_at: ago(19), device_ref: 'd2' },
    );
    const ev = (child, event, page_n, data = {}, h = 10) => ({ child_id: child, book_id: B(1), page_n, event, data, at: ago(h) });
    db.story_events.push(
      ev(KID_A, 'story_opened', null), ev(KID_A, 'story_page_listened', 1), ev(KID_A, 'story_page_listened', 2), ev(KID_A, 'story_page_listened', 2),
      ev(KID_A, 'story_page_read', 1), ev(KID_A, 'story_questions_done', null, { correct: 2, total: 4 }, 9), ev(KID_A, 'story_questions_done', null, { correct: 4, total: 4 }, 8),
      ev(KID_B, 'story_page_listened', 1),
      ev(KID_B, 'story_page_read', 3, {}, 40),   // before the send: not this send's
      { child_id: KID_B, book_id: B(3), page_n: 1, event: 'story_page_read', data: {}, at: ago(5) },   // another book
    );
    const sent = await Report.generate(sc.id, { reason: 'scheduled' });
    expect(sent).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const [to, text] = WhatsAppService.sendMessage.mock.calls[0];
    expect(to).toBe('teacher-phone');
    expect(text).toContain('Book 1 Testwala');
    expect(text).toContain('2 opened it');
    expect(text).toContain('2 listened');
    expect(text).toContain('2 read aloud');
    expect(text).toContain('2 answered the questions');
    expect(text).toContain('Finds facts in the story: 3/4');
    expect(text).toContain('Works out why: 1/2');
    expect(text).toContain('Word meanings: 1/2');
    expect(text).toContain('Words the class skipped most: window, long');
    expect(text).toContain('Zara Testwala: 🎧 2 pages · 🗣️ 2 pages · ⭐ 4/4');
    expect(text).toContain('Ali Testwala: 🎧 1 page · 🗣️ 1 page · ⭐ 1/4');
    expect(db.quiz_share_codes[0].report_sent_at).toBeTruthy();
    // a story has no question rows and no guidance writer
    expect(fake.calls.some((c) => c.t === 'quiz_answers')).toBe(false);
  });
  test('with the teacher\'s web report on, the story report carries its link (as every report does)', async () => {
    await Stories.share({ uid: TEACHER, storyId: B(1) });
    const sc = db.quiz_share_codes[0];
    db.app_settings.push({ key: 'teacher_report_teachers', value: 'all' });
    try { require('../../../shared/services/quiz/teacher-report-gate')._resetCache(); } catch (_) { /* no cache */ }
    db.quiz_sessions.push({ id: 's-a', quiz_id: sc.quiz_id, share_code_id: sc.id, student_id: KID_A, student_name: 'Zara Testwala', user_id: null, status: 'in_progress', invited_by_student_id: null, created_at: ago(2), device_ref: 'd1' });
    await Report.generate(sc.id, { reason: 'scheduled' });
    const [, text] = WhatsAppService.sendMessage.mock.calls[0];
    expect(text).toMatch(/https:\/\/quiz\.example\.com\/r\/[A-Za-z0-9._%-]+/);
  });
  test.each([
    ['story_page_listened {miss:true}', (ev, child, n) => ev(child, 'story_page_listened', n, { miss: true })],
    ['story_page_unvoiced', (ev, child, n) => ev(child, 'story_page_unvoiced', n)],
  ])('a page with no voice yet (the reader\'s %s row) is never a page listened: not in the counts, not on a child\'s line, not on the web report', async (_, unvoiced) => {
    await Stories.share({ uid: TEACHER, storyId: B(1) });
    const sc = db.quiz_share_codes[0];
    const q = db.quizzes[0];
    q.meta.first_sent_at = ago(30);
    db.quiz_sessions.push(
      { id: 's-a', quiz_id: q.id, share_code_id: sc.id, student_id: KID_A, student_name: 'Zara Testwala', user_id: null, status: 'in_progress', invited_by_student_id: null, created_at: ago(20), device_ref: 'd1', correct_answers: 0, total_questions_answered: 0 },
      { id: 's-b', quiz_id: q.id, share_code_id: sc.id, student_id: KID_B, student_name: 'Ali Testwala', user_id: null, status: 'in_progress', invited_by_student_id: null, created_at: ago(19), device_ref: 'd2', correct_answers: 0, total_questions_answered: 0 },
    );
    const ev = (child, event, page_n, data = {}) => ({ child_id: child, book_id: B(1), page_n, event, data, at: ago(10) });
    db.story_events.push(
      ev(KID_A, 'story_opened', null), ev(KID_A, 'story_page_listened', 1),
      unvoiced(ev, KID_A, 2), unvoiced(ev, KID_A, 3),
      ev(KID_B, 'story_opened', null), unvoiced(ev, KID_B, 1), unvoiced(ev, KID_B, 2), unvoiced(ev, KID_B, 3),
    );
    const Data = require('../../../shared/services/quiz/teacher-report.data');
    const r = await Data.quizReport(TEACHER, q.id);
    expect(r.story.counts.listened).toBe(1);
    expect(r.story.children.find((c) => c.first === 'Zara').listened).toBe(1);
    expect(r.story.children.find((c) => c.first === 'Ali').listened).toBe(0);
    await Report.generate(sc.id, { reason: 'scheduled' });
    const [, text] = WhatsAppService.sendMessage.mock.calls[0];
    expect(text).toContain('1 listened');
    expect(text).toContain('Zara Testwala: 🎧 1 page');
    expect(text).not.toMatch(/Ali Testwala: 🎧 [1-9]/);
  });
  test('nobody joined: told in story words, stamped as every report', async () => {
    await Stories.share({ uid: TEACHER, storyId: B(1) });
    const sc = db.quiz_share_codes[0];
    await Report.generate(sc.id, { reason: 'scheduled' });
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('teacher-phone', '📖 *Book 1 Testwala* — no one in your class has opened the story yet. The link is still open: forward the class message again.');
    expect(db.quiz_share_codes[0].report_sent_at).toBeTruthy();
  });
});

describe('a preview never reaches a child, even when the database fails', () => {
  const LIST = '55555555-5555-4555-8555-000000000001';
  const Hub = require('../../../shared/services/quiz/web-quiz-hub');
  function classOfTwo() {
    db.students = [{ id: KID_A, student_name: 'Zara Testwala', student_name_urdu: null, self_reported_class: '2', list_id: LIST, is_active: true, created_at: ago(500) }];
    db.student_lists = [{ id: LIST, user_id: TEACHER, class_name: '2', section: 'A', is_active: true }];
  }
  const card = async () => (await Hub.hub(T.signHub([KID_A]), { device: DEVICE })).teacher;
  /** quiz_share_codes updates that set `active` to this value answer an error (the rest run as before). */
  function failUpdates(active) {
    const real = supabase.from;
    supabase.from = (t) => {
      const q = real(t);
      if (t !== 'quiz_share_codes') return q;
      const update = q.update.bind(q);
      q.update = (p) => (p && p.active === active ? { eq: async () => ({ data: null, error: { message: 'down' } }) } : update(p));
      return q;
    };
    return () => { supabase.from = real; };
  }

  test('the class hub after a preview is the hub before it (no teacher card); after Send the book is the teacher card', async () => {
    classOfTwo();
    const before = await card();
    expect(before).toBeNull();
    const pv = await Stories.preview({ uid: TEACHER, storyId: B(1) });
    dbDefaults();   // the table's default for any column the insert did not name
    expect(await card()).toEqual(before);
    await Stories.send({ uid: TEACHER, storyId: B(1) });
    expect(await card()).toMatchObject({ code: pv.code });
  });
  test('the code is minted closed in its own insert: a failing update cannot leave it open', async () => {
    classOfTwo();
    const restore = failUpdates(false);
    try {
      const pv = await Stories.preview({ uid: TEACHER, storyId: B(1) });
      dbDefaults();
      expect(db.quiz_share_codes[0].active).toBe(false);
      await expect(WQ.getQuiz(pv.code)).rejects.toMatchObject({ status: 410 });
      expect(await card()).toBeNull();
    } finally { restore(); }
  });
  test('Send whose code cannot be opened is refused, and the row is not marked sent', async () => {
    await Stories.preview({ uid: TEACHER, storyId: B(1) });
    const restore = failUpdates(true);
    try {
      await expect(Stories.send({ uid: TEACHER, storyId: B(1) })).rejects.toMatchObject({ status: 503 });
    } finally { restore(); }
    expect(db.quizzes[0].status).toBe('ready');
    expect(db.quiz_share_codes[0].active).toBe(false);
  });
  test('Send whose row cannot be marked sent is refused (503), never a 200 behind a row still "ready"', async () => {
    await Stories.preview({ uid: TEACHER, storyId: B(1) });
    const real = supabase.from;
    supabase.from = (t) => {
      const q = real(t);
      if (t !== 'quizzes') return q;
      const update = q.update.bind(q);
      q.update = (p) => (p && p.status === 'sent' ? { eq: async () => ({ data: null, error: { message: 'down' } }) } : update(p));
      return q;
    };
    try {
      await expect(Stories.send({ uid: TEACHER, storyId: B(1) })).rejects.toMatchObject({ status: 503 });
    } finally { supabase.from = real; }
    expect(db.quizzes[0].status).toBe('ready');
    expect(logEvent).not.toHaveBeenCalledWith('teacher_story_sent', expect.anything());
    expect(require('../../../shared/utils/logger').logToFile).toHaveBeenCalledWith(expect.stringContaining('could not mark the send'), expect.anything(), 'error');
  });
  test.each([
    ['answers an error', { data: null, error: { message: 'down' } }],
    ['lands no row', { data: null, error: null }],
  ])('a send whose row cannot be written (the insert %s) is refused (503) before any code is minted', async (_, answer) => {
    const real = supabase.from;
    supabase.from = (t) => {
      const q = real(t);
      if (t !== 'quizzes') return q;
      q.insert = () => ({ select: () => ({ single: async () => answer }) });
      return q;
    };
    try {
      await expect(Stories.preview({ uid: TEACHER, storyId: B(1) })).rejects.toMatchObject({ status: 503, body: { error: 'unavailable' } });
    } finally { supabase.from = real; }
    expect(db.quiz_share_codes).toHaveLength(0);
    expect(require('../../../shared/utils/logger').logToFile).toHaveBeenCalledWith(expect.stringContaining('could not write the send'), expect.anything(), 'error');
  });
  test('the sent event says "reused" only when the code was already open before this tap', async () => {
    await Stories.preview({ uid: TEACHER, storyId: B(1) });
    await Stories.send({ uid: TEACHER, storyId: B(1) });
    expect(logEvent).toHaveBeenLastCalledWith('teacher_story_sent', expect.objectContaining({ reused: false }));
    await Stories.send({ uid: TEACHER, storyId: B(1) });
    expect(logEvent).toHaveBeenLastCalledWith('teacher_story_sent', expect.objectContaining({ reused: true }));
  });
  test('a code closed while its row is already sent is never opened again by a later preview: a new closed code is made', async () => {
    const first = await Stories.share({ uid: TEACHER, storyId: B(1) });
    db.quiz_share_codes[0].active = false;   // closed for another reason after the send
    const pv = await Stories.preview({ uid: TEACHER, storyId: B(1) });
    expect(pv.code).not.toBe(first.code);
    expect(db.quiz_share_codes.find((c) => c.code === first.code).active).toBe(false);
    expect(db.quiz_share_codes.find((c) => c.code === pv.code).active).toBe(false);
  });
});

describe('the switch read throws: the child link and the hub door are today\'s', () => {
  const Err = class extends Error { constructor(status, body) { super(body.error); this.status = status; this.body = body; } };
  test('/q 404 no_questions and the door\'s refusal', async () => {
    const sent = await Stories.share({ uid: TEACHER, storyId: B(1) });
    dbDefaults();
    const sc = db.quiz_share_codes[0];
    db.quiz_sessions.push({ id: 's-1', quiz_id: sc.quiz_id, share_code_id: sc.id, student_id: KID_A, student_name: 'Zara Testwala', user_id: null,
      status: 'in_progress', invited_by_student_id: null, device_ref: 'd1', created_at: ago(1) });
    const st = T.signSession({ sessionId: 's-1', deviceRef: DEVICE, shareCodeId: sc.id });
    const real = supabase.from;
    supabase.from = (t) => {
      const q = real(t);
      if (t !== 'app_settings') return q;
      const inn = q.in.bind(q);
      q.in = (k, v) => (Array.isArray(v) && v.includes('web_quiz_stories_teacher') ? Promise.reject(new Error('down')) : inn(k, v));
      return q;
    };
    Stories._reset();
    try {
      await expect(WQ.getQuiz(sent.code)).rejects.toMatchObject({ status: 404, body: { error: 'no_questions' } });
      await expect(Door.door({ st, story: 1 }, Err)).rejects.toMatchObject({ status: 404 });
    } finally { supabase.from = real; }
  });
});

describe('the class page and the web report around a story send', () => {
  test('cells and weeks of a class page with a story and a quiz are the quiz\'s alone', async () => {
    await Stories.share({ uid: TEACHER, storyId: B(1) });
    db.quizzes[0].created_at = ago(1);
    const sc = db.quiz_share_codes[0];
    db.quiz_sessions.push({ id: 's-a', quiz_id: sc.quiz_id, share_code_id: sc.id, student_id: KID_A, student_name: 'Zara Testwala', user_id: null, status: 'in_progress', invited_by_student_id: null, created_at: ago(1), device_ref: 'd1', correct_answers: 0, total_questions_answered: 0 });
    const Data = require('../../../shared/services/quiz/teacher-report.data');
    const onlyStory = await Data.classReport(TEACHER);
    expect(onlyStory.cells || []).toEqual([]);
    expect(onlyStory.weeks || []).toEqual([]);
  });
  test('the web report of a story nobody opened says so in story words', async () => {
    await Stories.share({ uid: TEACHER, storyId: B(1) });
    const r = await require('../../../shared/services/quiz/teacher-report.data').quizReport(TEACHER, db.quizzes[0].id);
    expect(r.story.counts).toEqual({ opened: 0, listened: 0, read: 0, questions: 0 });
    const { renderPage } = require('../../../shared/templates/teacher-report.page');
    expect(renderPage({ quiz: r }, { lang: 'en', tokens: { self: 'tok' } })).toContain('No child has opened the story yet.');
    expect(renderPage({ quiz: r }, { lang: 'ur', tokens: { self: 'tok' } })).toContain('ابھی کسی بچے نے کہانی نہیں کھولی۔');
  });
});

describe('the child\'s story landing names the teacher in the children\'s word', () => {
  test('Urdu: «ٹیچر», never «استاد»; English unchanged', async () => {
    db.books_ur = true;
    const sent = await Stories.share({ uid: TEACHER, storyId: B(8) });
    dbDefaults();
    const out = await WQ.getQuiz(sent.code);
    expect(out.cls.teacher).toContain('ٹیچر');
    expect(out.cls.teacher).not.toContain('استاد');
    // the name first, as children say it (bidi-isolated, as every Urdu string with a name is)
    expect(out.cls.teacher).toMatch(/Example Testwala\u2069? ٹیچر$/);
    const en = await Stories.share({ uid: TEACHER, storyId: B(1) });
    dbDefaults();
    expect((await WQ.getQuiz(en.code)).cls.teacher).toBe('Teacher Example Testwala');
  });
});

describe('the Stories page\'s "Copy the message" opens the send first', () => {
  const vm = require('vm');
  const Page = require('../../../shared/templates/teacher-stories.page');
  function run({ fetchOk = true } = {}) {
    const p = { book: { id: B(1), title: 'Book 1 Testwala', lang: 'en', dir: 'ltr', pages: 6 }, class_message: 'Hello class https://quiz.example.com/q/AB12CD', report_line: 'r', back_line: 'b' };
    const html = Page.renderPreview({ th: 'tok.AbCdEfGhIjKlMnOpQrStUv', shelf: { grade: 2, lang: 'en' }, ui: 'en', p });
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const button = { hidden: true, textContent: 'Copy the message', disabled: false, attrs: { 'data-done': 'Copied', 'data-long': 'Long-press', 'data-fail': 'This story cannot be sent right now.' } };
    button.getAttribute = (k) => button.attrs[k];
    button.addEventListener = (e, fn) => { button.click = fn; };
    const msg = { value: p.class_message, setAttribute() {}, removeAttribute() {}, select() {} };
    const form = { elements: { th: { value: 'tok.AbCdEfGhIjKlMnOpQrStUv' }, story_id: { value: B(1) } } };
    const order = [];
    const ctx = {
      location: { hash: '', search: '', pathname: '/quiz/teacher/x/stories' },
      document: { getElementById: (id) => ({ copy: button, msg }[id] || null), querySelector: () => form, execCommand: () => false },
      navigator: { clipboard: { writeText: (v) => { order.push(['copy', v]); return Promise.resolve(); } } },
      fetch: (url, o) => { order.push(['fetch', url, JSON.parse(o.body)]); return Promise.resolve({ ok: fetchOk, json: () => Promise.resolve({ class_message: p.class_message }) }); },
      JSON, Promise,
    };
    vm.runInNewContext(script, ctx);
    return { button, order };
  }
  const settle = () => new Promise((r) => setImmediate(r));
  test('a tap POSTs the share (opening the code, marking it sent), then copies the message', async () => {
    const { button, order } = run();
    button.click();
    await settle(); await settle();
    expect(order[0]).toEqual(['fetch', '/api/teacher/story/share', { th: 'tok.AbCdEfGhIjKlMnOpQrStUv', story_id: B(1) }]);
    expect(order[1]).toEqual(['copy', 'Hello class https://quiz.example.com/q/AB12CD']);
    expect(button.textContent).toBe('Copied');
  });
  test('the share refused: nothing is copied and the teacher is told', async () => {
    const { button, order } = run({ fetchOk: false });
    button.click();
    await settle(); await settle();
    expect(order.filter((o) => o[0] === 'copy')).toEqual([]);
    expect(button.textContent).toBe('This story cannot be sent right now.');
  });
});
