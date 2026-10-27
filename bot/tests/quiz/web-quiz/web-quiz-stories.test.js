'use strict';
/**
 * Stories for the child (web-quiz-stories.js, switch `web_quiz_stories`): the shelf, the book, the events.
 * Supabase, R2's presign and the hub's "who is this child" are the boundaries and are faked; the rest runs for real.
 * Books, pages, children and voices are invented ("Testwala", __fixtures__/stories-testwala.js).
 */
process.env.WEB_QUIZ_TOKEN_SECRET = 'test-only-secret';

jest.mock('../../../shared/config/supabase', () => ({}));
const mockKidFromHub = jest.fn();
jest.mock('../../../shared/services/quiz/web-quiz-hub', () => ({ kidFromHub: (...a) => mockKidFromHub(...a) }));
const mockPresign = jest.fn(async (key) => `https://r2.example.test/${key}?sig=1`);
jest.mock('../../../shared/storage/r2', () => ({ presignKey: (...a) => mockPresign(...a) }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const F = require('./__fixtures__/stories-testwala');
const Stories = require('../../../shared/services/quiz/web-quiz-stories');

const KID = '44444444-4444-4444-8444-444444444444';
const KID_B = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'hub-token';
const DAY = 86400000;
const NOON_PKT = Date.UTC(2026, 9, 16, 7, 0, 0); // 12:00 PKT, 16 Oct 2026

let fake;
const clone = (v) => JSON.parse(JSON.stringify(v));
function seed({ on = true, book = false, band = false, extra = {} } = {}) {
  const settings = [];
  if (on) settings.push({ key: 'web_quiz_stories', value: true });
  if (band) settings.push({ key: 'web_quiz_stories_band', value: true });
  if (book) {
    ['web_quiz_hub', 'web_quiz_challenge', 'web_quiz_challenge_v2', 'web_quiz_challenge_book'].forEach((key) => settings.push({ key, value: true }));
  }
  const books = [F.book(1)];
  for (let n = 2; n <= 7; n += 1) books.push(F.book(n));
  books.push(F.book(8, { status: 'draft' }));                       // a draft: never on the shelf, never opened
  books.push(F.book(9, { lang: 'ur', title: 'کتاب ٹیسٹ والا', slug: 'g2-ur-testwala-9' }));
  books.push(F.book(10, { grade: 3 }));
  fake = makeFake({
    app_settings: settings,
    story_books: books,
    story_pages: clone([F.P2, F.P1, F.P3]),
    story_page_voices: clone([F.VOICE_P1, F.VOICE_P1_OLD]),
    story_questions: clone(F.QUESTIONS),
    story_events: [],
    ...extra,
  });
  Object.assign(supabase, fake);
}

beforeEach(() => {
  Stories._reset();
  require('../../../shared/services/quiz/web-quiz-book')._resetCache();
  mockKidFromHub.mockReset();
  mockKidFromHub.mockImplementation(async (token, chip) => (token === TOKEN ? { studentId: chip === 'b' ? KID_B : KID, grade: '2', rootId: null } : null));
  mockPresign.mockClear();
});

const status = async (p) => { try { await p; return 200; } catch (e) { return e.status || 500; } };
const body = async (p) => { try { await p; return null; } catch (e) { return e.body; } };

describe('the switch: off is closed everywhere', () => {
  test('off: shelf, book and event answer 404 stories_off and read nothing about the child', async () => {
    seed({ on: false });
    expect(await body(Stories.shelf(TOKEN, { kid: 'a' }))).toEqual({ error: 'stories_off' });
    expect(await status(Stories.book(F.BOOK(1), TOKEN, { kid: 'a' }))).toBe(404);
    expect(await status(Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_opened', data: {} }))).toBe(404);
    expect(mockKidFromHub).not.toHaveBeenCalled();
    expect(fake.db.story_events).toHaveLength(0);
  });
  test('a settings read that fails is off', async () => {
    seed();
    supabase.from = () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'down' } }) }) });
    expect(await status(Stories.shelf(TOKEN, { kid: 'a' }))).toBe(404);
  });
  test('only a literal true turns it on', async () => {
    seed({ on: false });
    fake.db.app_settings.push({ key: 'web_quiz_stories', value: 'yes' });
    expect(await Stories.storiesOn()).toBe(false);
    Stories._reset();
    fake.db.app_settings = [{ key: 'web_quiz_stories', value: false }];
    expect(await Stories.storiesOn()).toBe(false);
    // app_settings.value is jsonb: the flip writes the boolean; a JSON string "true" is not it.
    Stories._reset();
    fake.db.app_settings = [{ key: 'web_quiz_stories', value: 'true' }];
    expect(await Stories.storiesOn()).toBe(false);
    expect(await status(Stories.shelf(TOKEN, { kid: 'a' }))).toBe(404);
    Stories._reset();
    fake.db.app_settings = [{ key: 'web_quiz_stories', value: true }, { key: 'web_quiz_stories_band', value: 'true' }];
    expect(await Stories.storiesOn()).toBe(true);
    expect((await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' })).pages[0].text_band).toBeNull();
  });
  test('hubBits: {} off, {stories:{on:1}} on', async () => {
    seed({ on: false });
    expect(await Stories.hubBits()).toEqual({});
    Stories._reset();
    seed();
    expect(await Stories.hubBits()).toEqual({ stories: { on: 1 } });
  });
  test('hubBits with a child: resume = the newest half-read ready book of the last 7 days, on its next page', async () => {
    seed();
    const at = (h) => new Date(NOON_PKT - h * 3600000).toISOString();
    fake.db.story_events.push(
      { child_id: KID, book_id: F.BOOK(2), page_n: 1, event: 'story_page_listened', data: {}, at: at(30) },
      { child_id: KID, book_id: F.BOOK(1), page_n: 1, event: 'story_page_listened', data: {}, at: at(2) },
      { child_id: KID, book_id: F.BOOK(3), page_n: 2, event: 'story_page_read', data: {}, at: at(1) },
      { child_id: KID, book_id: F.BOOK(3), event: 'story_done', data: { pages_listened: 1, pages_read: 0, stars: 1 }, at: at(0.5) },       // finished: never resumed
      { child_id: KID, book_id: F.BOOK(8), page_n: 1, event: 'story_page_read', data: {}, at: at(0.2) }, // draft: never
      { child_id: KID_B, book_id: F.BOOK(4), page_n: 1, event: 'story_page_read', data: {}, at: at(0.1) },
    );
    expect(await Stories.hubBits({ studentId: KID, now: NOON_PKT })).toEqual({ stories: { on: 1, resume: { book_id: F.BOOK(1), title: 'Book 1 Testwala', cover: `/s/${F.BOOK(1)}/cover-aaaa0001.webp`, page_n: 2, pages: 2 } } });
  });
  test('hubBits: a miss row (a page with no voice, written at book open) is not progress: it never picks the book or moves its page', async () => {
    seed();
    const at = (h) => new Date(NOON_PKT - h * 3600000).toISOString();
    fake.db.story_events.push(
      { child_id: KID, book_id: F.BOOK(1), page_n: 1, event: 'story_page_listened', data: {}, at: at(2) },
      { child_id: KID, book_id: F.BOOK(2), page_n: 2, event: 'story_page_listened', data: { miss: true }, at: at(1) },
      { child_id: KID, book_id: F.BOOK(1), page_n: 2, event: 'story_page_listened', data: { miss: true }, at: at(0.5) },
    );
    expect((await Stories.hubBits({ studentId: KID, now: NOON_PKT })).stories.resume).toEqual(expect.objectContaining({ book_id: F.BOOK(1), page_n: 2 }));
    Stories._reset(); seed();
    fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(2), page_n: 2, event: 'story_page_listened', data: { miss: true }, at: at(1) });
    expect(await Stories.hubBits({ studentId: KID, now: NOON_PKT })).toEqual({ stories: { on: 1 } });
  });
  test('hubBits: five half-read books whose newest three went back to draft cost ONE story_books read; the newest ready one wins', async () => {
    seed();
    const at = (h) => new Date(NOON_PKT - h * 3600000).toISOString();
    [1, 2, 3, 4, 5].forEach((n) => fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(n), page_n: 1, event: 'story_page_read', data: {}, at: at(n) }));
    fake.db.story_books.filter((b) => [F.BOOK(1), F.BOOK(2), F.BOOK(3)].includes(b.id)).forEach((b) => { b.status = 'draft'; });
    const before = fake.calls.filter((c) => c.table === 'story_books').length;
    const out = await Stories.hubBits({ studentId: KID, now: NOON_PKT });
    expect(out.stories.resume).toEqual(expect.objectContaining({ book_id: F.BOOK(4), page_n: 2 }));
    expect(fake.calls.filter((c) => c.table === 'story_books').length - before).toBe(1);
  });
  test('hubBits: nothing half-read in 7 days → no resume key', async () => {
    seed();
    fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(1), page_n: 1, event: 'story_page_read', data: {}, at: new Date(NOON_PKT - 8 * DAY).toISOString() });
    expect(await Stories.hubBits({ studentId: KID, now: NOON_PKT })).toEqual({ stories: { on: 1 } });
  });
  test('the page rows may carry the band as columns (band_file, band_w, band_h, band_box) instead of text_band', async () => {
    seed({ band: true });
    const p1 = fake.db.story_pages.find((p) => p.n === 1);
    delete p1.text_band;
    Object.assign(p1, { band_file: 'p01-band-cccc0009.webp', band_w: 1440, band_h: 200, band_box: [0, 860, 720, 100] });
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(out.pages[0].text_band).toEqual({ url: `/s/${F.BOOK(1)}/p01-band-cccc0009.webp`, w: 1440, h: 200, box: [0, 860, 720, 100] });
  });
  test('a hub link that names nobody on this phone opens nothing (401)', async () => {
    seed();
    expect(await status(Stories.shelf('other-token', { kid: 'a' }))).toBe(401);
  });
});

describe('the shelf', () => {
  test('lists only ready books of the grade and language, with covers on the /s/ route and no draft', async () => {
    seed();
    const out = await Stories.shelf(TOKEN, { kid: 'a', now: NOON_PKT });
    expect(out.grade).toBe(2);
    expect(out.lang).toBe('en');
    expect(out.grades).toEqual([1, 2, 3, 4, 5]);
    const ids = out.books.map((b) => b.id);
    expect(ids).toHaveLength(7);
    expect(ids).not.toContain(F.BOOK(8));
    expect(ids).not.toContain(F.BOOK(9));
    expect(ids).not.toContain(F.BOOK(10));
    const b1 = out.books.find((b) => b.id === F.BOOK(1));
    expect(b1).toEqual(expect.objectContaining({ title: 'Book 1 Testwala', grade: 2, lang: 'en', dir: 'ltr', pages: 2, minutes: 1.5,
      cover: `/s/${F.BOOK(1)}/cover-aaaa0001.webp`, done: false, from_teacher: false }));
    expect(out.books.map((b) => b.shelf_position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThanOrEqual(6 * 1024);
  });
  test('g and l pick another shelf; Urdu books are rtl', async () => {
    seed();
    const ur = await Stories.shelf(TOKEN, { kid: 'a', l: 'ur', now: NOON_PKT });
    expect(ur.books.map((b) => [b.id, b.dir])).toEqual([[F.BOOK(9), 'rtl']]);
    const g3 = await Stories.shelf(TOKEN, { kid: 'a', g: '3', now: NOON_PKT });
    expect(g3.grade).toBe(3);
    expect(g3.books.map((b) => b.id)).toEqual([F.BOOK(10)]);
  });
  test('order: from the teacher first, then unfinished shuffled per (child, PKT day), finished last', async () => {
    seed();
    fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(3), event: 'story_done', data: { pages_listened: 1, pages_read: 0, stars: 1 }, at: new Date(NOON_PKT - DAY).toISOString() });
    // Another child's finish never marks this child's shelf.
    fake.db.story_events.push({ child_id: KID_B, book_id: F.BOOK(4), event: 'story_done', data: { pages_listened: 1, pages_read: 0, stars: 1 }, at: new Date(NOON_PKT - DAY).toISOString() });
    const out = await Stories.shelf(TOKEN, { kid: 'a', t: F.BOOK(6), now: NOON_PKT });
    const ids = out.books.map((b) => b.id);
    expect(ids[0]).toBe(F.BOOK(6));
    expect(out.books[0].from_teacher).toBe(true);
    expect(ids[ids.length - 1]).toBe(F.BOOK(3));
    expect(out.books[ids.length - 1].done).toBe(true);
    expect(out.books.find((b) => b.id === F.BOOK(4)).done).toBe(false);
  });
  test('the shuffle is stable for a child within a PKT day and moves across days and children', async () => {
    seed();
    const order = async (kid, now) => (await Stories.shelf(TOKEN, { kid, now })).books.map((b) => b.id).join();
    const a1 = await order('a', NOON_PKT);
    expect(await order('a', NOON_PKT + 3 * 3600000)).toBe(a1);          // later the same PKT day
    const days = [];
    for (let d = 1; d <= 5; d += 1) days.push(await order('a', NOON_PKT + d * DAY));
    expect(days.some((o) => o !== a1)).toBe(true);
    const kids = [await order('b', NOON_PKT)];
    expect(kids.some((o) => o !== a1)).toBe(true);
  });
  test('the PKT day turns at 19:00 UTC, not at midnight UTC', () => {
    expect(Stories.pktDay(Date.UTC(2026, 9, 16, 18, 59))).toBe(Stories.pktDay(Date.UTC(2026, 9, 16, 0, 1)));
    expect(Stories.pktDay(Date.UTC(2026, 9, 16, 19, 0))).not.toBe(Stories.pktDay(Date.UTC(2026, 9, 16, 18, 59)));
  });
  test('a teacher id that is not on this shelf is ignored; junk is ignored', async () => {
    seed();
    const out = await Stories.shelf(TOKEN, { kid: 'a', t: `${F.BOOK(10)},not-a-uuid`, now: NOON_PKT });
    expect(out.books.every((b) => b.from_teacher === false)).toBe(true);
  });
});

describe('the book', () => {
  test('pages in order with words × the current voice timings merged by i, boxes kept, audio on the /s/ route', async () => {
    seed({ band: true });
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(out).toEqual(expect.objectContaining({ id: F.BOOK(1), title: 'Book 1 Testwala', lang: 'en', dir: 'ltr', grade: 2, cover: `/s/${F.BOOK(1)}/cover-aaaa0001.webp` }));
    expect(out.pages.map((p) => p.n)).toEqual([1, 2, 3]);
    const p1 = out.pages[0];
    expect(p1.image).toEqual({ url: `/s/${F.BOOK(1)}/p01-bbbb0001.webp`, w: 720, h: 1080 });
    expect(p1.text_band).toEqual({ url: `/s/${F.BOOK(1)}/p01-band-cccc0001.webp`, w: 1440, h: 200, box: [0, 860, 720, 100] });
    expect(p1.words[1]).toEqual({ i: 1, t: 'Testwala', s_ms: 520, e_ms: 1100, box: [170, 880, 120, 40] });
    expect(p1.audio).toEqual({ url: `/s/${F.BOOK(1)}/a01-dddd0001.ogg`, ms: 3200 });
    expect(p1.boxes_ok).toBe(true);
    expect(JSON.stringify(out)).not.toContain('old00001');
    expect(mockPresign).not.toHaveBeenCalled();
    expect(out.pace_wpm).toBe(94);
  });
  test('a voice marked quality "low" (word times not trusted) reaches the page so the player sweeps the line instead', async () => {
    seed();
    fake.db.story_page_voices[0].quality = 'low';
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(out.pages[0].quality).toBe('low');
    expect(out.pages[1]).not.toHaveProperty('quality');
  });
  test('a page with no voice yet has audio null and words without times; a word with no box has no box key', async () => {
    seed();
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    const p2 = out.pages[1];
    expect(p2.audio).toBeNull();
    expect(p2.boxes_ok).toBe(false);
    expect(p2.text_band).toBeNull();
    expect(p2.words[0]).toEqual({ i: 0, t: 'The' });
    expect(p2.words[1]).toEqual({ i: 1, t: 'kite', box: [200, 900, 60, 40] });
    expect(out.pages[2].is_picture).toBe(true);
  });
  test('questions: only reviewed, in order, options as {t, img?}; the answer is never sent', async () => {
    seed();
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(out.questions).toEqual([
      { n: 1, kind: 'literal', q: 'What does Sami Testwala see?', options: [{ t: 'A kite' }, { t: 'A cat' }, { t: 'A bus' }], page_ref: 1, audio: null },
      { n: 2, kind: 'inference', q: 'Where does the kite go?', options: [{ t: 'Down' }, { t: 'Up high', img: `/s/${F.BOOK(1)}/q2o1-eeee0001.webp` }, { t: 'Home' }], page_ref: 2, audio: null },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/answer_i|review_status|"answer"/);
  });
  test('per-line boxes pass through when the page has them ({i0, i1, box}); absent or junk → no key', async () => {
    seed();
    fake.db.story_pages.find((p) => p.n === 2).lines = [{ i0: 0, i1: 1, box: [80, 890, 400, 50], src: 'words' }, { i0: 2, i1: 3, src: 'ocr' }, { i0: 'x' }, { i0: 1, i1: 2, box: [1, 2] }];
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    // a line with no reliable box keeps its word range (the reader sweeps it without zooming)
    expect(out.pages[1].lines).toEqual([{ i0: 0, i1: 1, box: [80, 890, 400, 50] }, { i0: 2, i1: 3 }, { i0: 1, i1: 2 }]);
    expect(out.pages[0]).not.toHaveProperty('lines');
  });
  test('the questions sprite: {url, clips} on /s/ when the book has one; absent otherwise', async () => {
    seed();
    expect(await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' })).not.toHaveProperty('questions_sprite');
    fake.db.story_books[0].questions_sprite = { file: 'qs-abcd1234.ogg', clips: { q1: { s_ms: 0, e_ms: 2200 }, q1o1: { s_ms: 2350, e_ms: 3300 } } };
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(out.questions_sprite).toEqual({ url: `/s/${F.BOOK(1)}/qs-abcd1234.ogg`, clips: { q1: { s_ms: 0, e_ms: 2200 }, q1o1: { s_ms: 2350, e_ms: 3300 } } });
  });
  test('question audio: {q, o[]} on the /s/ route when the clips exist, null otherwise', async () => {
    seed();
    fake.db.story_questions[0].audio = { q: 'q1-ffff0001.webp'.replace('webp', 'ogg'), o: ['q1o1-ffff0002.ogg', 'q1o2-ffff0003.ogg', 'q1o3-ffff0004.ogg'] };
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(out.questions[0].audio).toEqual({ q: `/s/${F.BOOK(1)}/q1-ffff0001.ogg`, o: [`/s/${F.BOOK(1)}/q1o1-ffff0002.ogg`, `/s/${F.BOOK(1)}/q1o2-ffff0003.ogg`, `/s/${F.BOOK(1)}/q1o3-ffff0004.ogg`] });
    expect(out.questions[1].audio).toBeNull();
  });
  test('a draft book, an unknown id and a junk id are 404 not_found', async () => {
    seed();
    expect(await body(Stories.book(F.BOOK(8), TOKEN, { kid: 'a' }))).toEqual({ error: 'not_found' });
    expect(await status(Stories.book('5b0000ff-0000-4000-8000-000000000000', TOKEN, { kid: 'a' }))).toBe(404);
    expect(await status(Stories.book('../../etc', TOKEN, { kid: 'a' }))).toBe(404);
  });
  test('the text band is held back unless its own switch is on (the words are never shown twice)', async () => {
    seed();
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(out.pages[0].text_band).toBeNull();
    expect(JSON.stringify(out)).not.toContain('band-cccc');
  });
  test('audio stored under story/<env>/<book>/ is served by the /s/ route, unsigned', async () => {
    seed();
    fake.db.story_page_voices[0].audio_key = `story/sandbox/${F.BOOK(1)}/a01-dddd0001.ogg`;
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(out.pages[0].audio).toEqual({ url: `/s/${F.BOOK(1)}/a01-dddd0001.ogg`, ms: 3200 });
    expect(mockPresign).not.toHaveBeenCalled();
  });
  test('a text page with no voice: audio null, and the server keeps one story_page_listened {miss:true} for it (never for a picture page)', async () => {
    seed();
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(out.pages[1].audio).toBeNull();
    const misses = fake.db.story_events.filter((e) => e.event === 'story_page_listened');
    expect(misses).toEqual([expect.objectContaining({ child_id: KID, book_id: F.BOOK(1), page_n: 2, data: { miss: true } })]);
    await Stories.bookData(F.BOOK(1));
    expect(fake.db.story_events.filter((e) => e.event === 'story_page_listened')).toHaveLength(1);
  });
  test('one miss row per page per child per PKT day: a reopen the same day adds none, the next day adds one', async () => {
    seed();
    fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(1), page_n: 2, event: 'story_page_listened', data: { miss: true }, at: new Date().toISOString() });
    await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(fake.db.story_events.filter((e) => e.event === 'story_page_listened')).toHaveLength(1);
    fake.db.story_events[0].at = new Date(Date.now() - 2 * DAY).toISOString();
    await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(fake.db.story_events.filter((e) => e.event === 'story_page_listened')).toHaveLength(2);
  });
  test('a book payload stays within 25 KB', async () => {
    seed({ band: true });
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThanOrEqual(25 * 1024);
  });
  test('one audio path: a key outside story/ is never signed; that page has no audio and no word times', async () => {
    seed();
    fake.db.story_page_voices[0].audio_key = 'readalong/sandbox/elsewhere/a01-dddd0001.ogg';
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(out.pages[0].audio).toBeNull();
    expect(out.pages[0].words.some((w) => w.s_ms != null)).toBe(false);
    expect(mockPresign).not.toHaveBeenCalled();
  });
  test('lr3: true only when the live reader v3 AND realtime switches are both the boolean true, read in the one settings query', async () => {
    const cases = [
      [[], false],
      [[['web_quiz_live_read_v3', true]], false],
      [[['web_quiz_challenge_realtime', true]], false],
      [[['web_quiz_live_read_v3', true], ['web_quiz_challenge_realtime', 'true']], false],
      [[['web_quiz_live_read_v3', false], ['web_quiz_challenge_realtime', true]], false],
      [[['web_quiz_live_read_v3', true], ['web_quiz_challenge_realtime', true]], true],
    ];
    for (const [extra, want] of cases) {
      Stories._reset(); seed();
      extra.forEach(([key, value]) => fake.db.app_settings.push({ key, value }));
      const before = fake.calls.filter((c) => c.table === 'app_settings').length;
      const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
      expect(out.lr3).toBe(want);
      expect(fake.calls.filter((c) => c.table === 'app_settings').length - before).toBe(1);
    }
  });
  test('lrr (web_quiz_lr_repeat): only the boolean true with live reading on, in the same one settings query; absent, the string "true" or anything else is off and the payload has no lrr key', async () => {
    const LR = [['web_quiz_live_read_v3', true], ['web_quiz_challenge_realtime', true]];
    const cases = [
      [LR, false],
      [[...LR, ['web_quiz_lr_repeat', 'true']], false],
      [[...LR, ['web_quiz_lr_repeat', false]], false],
      [[...LR, ['web_quiz_lr_repeat', null]], false],
      [[...LR, ['web_quiz_lr_repeat', 1]], false],
      [[['web_quiz_lr_repeat', true]], false],   // live reading off
      [[...LR, ['web_quiz_lr_repeat', true]], true],
    ];
    for (const [extra, want] of cases) {
      Stories._reset(); seed();
      extra.forEach(([key, value]) => fake.db.app_settings.push({ key, value }));
      const before = fake.calls.filter((c) => c.table === 'app_settings').length;
      const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' }); // eslint-disable-line no-await-in-loop
      expect(Object.prototype.hasOwnProperty.call(out, 'lrr')).toBe(want);
      if (want) expect(out.lrr).toBe(true);
      expect(fake.calls.filter((c) => c.table === 'app_settings').length - before).toBe(1);
    }
  });
  test('lr3_keep (the mic notice\'s words): whether Jugnu keeps passage recordings, only when lr3 is on, in the one settings query', async () => {
    const LR = [['web_quiz_live_read_v3', true], ['web_quiz_challenge_realtime', true]];
    const cases = [
      [[], undefined],                                                    // lr3 off: the payload is today's (no key)
      [[['web_quiz_challenge_keep_audio', true]], undefined],
      [LR, false],
      [[...LR, ['web_quiz_challenge_keep_audio', false]], false],
      [[...LR, ['web_quiz_challenge_keep_audio', true]], true],
    ];
    seed(); await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' }); // the Book's own switch read, cached for the loop
    for (const [extra, want] of cases) {
      Stories._reset(); seed();
      extra.forEach(([key, value]) => fake.db.app_settings.push({ key, value }));
      const before = fake.calls.filter((c) => c.table === 'app_settings').length;
      const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
      if (want === undefined) expect(Object.prototype.hasOwnProperty.call(out, 'lr3_keep')).toBe(false);
      else expect(out.lr3_keep).toBe(want);
      expect(fake.calls.filter((c) => c.table === 'app_settings').length - before).toBe(1);
    }
  });
  test('steady (the reader\'s stall setting): the book says steady:1 only when web_quiz_stories_steady is the boolean true; off, the book has no key at all (byte-identical); one settings query', async () => {
    const cases = [[[], false], [[['web_quiz_stories_steady', 'true']], false], [[['web_quiz_stories_steady', false]], false], [[['web_quiz_stories_steady', true]], true]];
    for (const [extra, want] of cases) {
      Stories._reset(); seed();
      extra.forEach(([key, value]) => fake.db.app_settings.push({ key, value }));
      const before = fake.calls.filter((c) => c.table === 'app_settings').length;
      const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
      if (want) expect(out.steady).toBe(1); else expect(Object.prototype.hasOwnProperty.call(out, 'steady')).toBe(false);
      expect(fake.calls.filter((c) => c.table === 'app_settings').length - before).toBe(1);
    }
  });
  test('steady on: a draft or unknown book answers 404 gone (the reader says the story is not here any more); off it stays not_found', async () => {
    seed(); fake.db.app_settings.push({ key: 'web_quiz_stories_steady', value: true });
    expect(await body(Stories.book(F.BOOK(8), TOKEN, { kid: 'a' }))).toEqual({ error: 'gone' });
    expect(await body(Stories.book('5b0000ff-0000-4000-8000-000000000000', TOKEN, { kid: 'a' }))).toEqual({ error: 'gone' });
    Stories._reset(); seed({ on: false }); fake.db.app_settings.push({ key: 'web_quiz_stories_steady', value: true });
    expect(await body(Stories.book(F.BOOK(8), TOKEN, { kid: 'a' }))).toEqual({ error: 'stories_off' });
  });
  test('the share card: no card_v3 key while the card module is absent or off', async () => {
    seed();
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(Object.prototype.hasOwnProperty.call(out, 'card_v3')).toBe(false);
  });
  test('the share card: card_v3 when the card module says so', async () => {
    seed();
    Stories._cardField(async () => ({ card_v3: true }));
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(out.card_v3).toBe(true);
    Stories._cardField(null);
  });
  test('mergeWords: a silent word (a stage direction the voice skips) keeps its place and box, carries silent:true and never a timing', () => {
    const out = Stories.mergeWords(
      [{ i: 0, t: 'Sami', box: [1, 2, 3, 4] }, { i: 1, t: '(smiling)', silent: true, box: [5, 6, 7, 8] }, { i: 2, t: 'waves.' }, { i: 3, t: 'Testwala', silent: 'yes' }],
      [{ i: 0, s_ms: 0, e_ms: 300 }, { i: 1, s_ms: 300, e_ms: 600 }, { i: 2, s_ms: 600, e_ms: 900 }, { i: 3, s_ms: 900, e_ms: 1200 }],
    );
    // zero-length at the next spoken word's start: the player's times stay in order and the later word is the lit one
    expect(out).toEqual([
      { i: 0, t: 'Sami', s_ms: 0, e_ms: 300, box: [1, 2, 3, 4] },
      { i: 1, t: '(smiling)', silent: true, s_ms: 600, e_ms: 600, box: [5, 6, 7, 8] },
      { i: 2, t: 'waves.', s_ms: 600, e_ms: 900 },
      { i: 3, t: 'Testwala', s_ms: 900, e_ms: 1200 },
    ]);
    // a silent word last on the page sits at the end of the voice; a page with no timings stays untimed
    const end = Stories.mergeWords([{ i: 0, t: 'Go.' }, { i: 1, t: '(exits)', silent: true }], [{ i: 0, s_ms: 0, e_ms: 400 }], 1500);
    expect(end[1]).toEqual({ i: 1, t: '(exits)', silent: true, s_ms: 1500, e_ms: 1500 });
    expect(Stories.mergeWords([{ i: 0, t: 'Go.' }, { i: 1, t: '(exits)', silent: true }], [])).toEqual([{ i: 0, t: 'Go.' }, { i: 1, t: '(exits)', silent: true }]);
  });
  test('mergeWords: a word printed differently from its stored spelling keeps its alt (strings only, at most 3); a word without one is unchanged', () => {
    const out = Stories.mergeWords([{ i: 0, t: 'My' }, { i: 1, t: 'mum', alt: ['mom', '', 7, 'ma', 'mama', 'mummy'] }], [{ i: 0, s_ms: 0, e_ms: 200 }, { i: 1, s_ms: 250, e_ms: 600 }]);
    expect(out).toEqual([{ i: 0, t: 'My', s_ms: 0, e_ms: 200 }, { i: 1, t: 'mum', s_ms: 250, e_ms: 600, alt: ['mom', 'ma', 'mama'] }]);
    expect(Stories.mergeWords([{ i: 0, t: 'My', alt: [] }], [])).toEqual([{ i: 0, t: 'My' }]);   // nothing to add: no key
  });
  test('mergeWords: timings joined by i, not by position', () => {
    const w = Stories.mergeWords([{ i: 0, t: 'a' }, { i: 1, t: 'b', box: [1, 2, 3, 4] }], [{ i: 1, s_ms: 10, e_ms: 20 }, { i: 0, s_ms: 0, e_ms: 5 }]);
    expect(w).toEqual([{ i: 0, t: 'a', s_ms: 0, e_ms: 5 }, { i: 1, t: 'b', s_ms: 10, e_ms: 20, box: [1, 2, 3, 4] }]);
  });
});

describe('events', () => {
  test('story_opened is kept with the child, the book and only the allowed numbers', async () => {
    seed();
    const out = await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_opened', data: { shelf_position: 3, from_teacher: false, grade: 2, lang: 'en', name: 'Sami' } });
    expect(out).toEqual({ ok: true });
    expect(fake.db.story_events).toHaveLength(1);
    expect(fake.db.story_events[0]).toEqual(expect.objectContaining({ child_id: KID, book_id: F.BOOK(1), event: 'story_opened', page_n: null,
      data: { shelf_position: 3, from_teacher: false, grade: 2, lang: 'en' } }));
  });
  test('story_opened from a teacher link keeps the share code (the teacher report joins on it); a junk code is dropped', async () => {
    seed();
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_opened', data: { shelf_position: 1, from_teacher: true, code: 'AB12CD' } });
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_opened', data: { code: 'x y<script>' } });
    expect(fake.db.story_events[0].data).toEqual({ shelf_position: 1, from_teacher: true, code: 'AB12CD' });
    expect(fake.db.story_events[1].data).toEqual({});
  });
  test('story_page_listened may say the page had no voice yet (miss)', async () => {
    seed();
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 2, event: 'story_page_listened', data: { miss: true } });
    expect(fake.db.story_events[0].data).toEqual({ miss: true });
  });
  test('story_page_read keeps numbers only (never a transcript)', async () => {
    seed();
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_read', data: { words_total: 5, words_read: 4, skipped: 1, ms: 3000, ended: 'last_word', transcript_final: 'sami sees a kite' } });
    expect(fake.db.story_events[0].page_n).toBe(1);
    expect(fake.db.story_events[0].data).toEqual({ words_total: 5, words_read: 4, skipped: 1, ms: 3000, ended: 'last_word' });
  });
  test('an unknown event, a draft book or a bad page is 400/404 and writes nothing', async () => {
    seed();
    expect(await status(Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_hacked', data: {} }))).toBe(400);
    expect(await status(Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(8), event: 'story_opened', data: {} }))).toBe(404);
    expect(await status(Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 99, event: 'story_page_read', data: {} }))).toBe(400);
    expect(fake.db.story_events).toHaveLength(0);
  });
  test('story_questions_done is checked on the server: correct, total and effort stars back', async () => {
    seed();
    const out = await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_questions_done', data: { answers: [0, 2] } });
    expect(out).toEqual({ ok: true, correct: 1, total: 2, stars: expect.any(Number), by_kind: { literal: [1, 1], inference: [0, 1] } });
    expect(fake.db.story_events[0].data).toEqual(expect.objectContaining({ correct: 1, total: 2, stars: out.stars }));
  });
  test('story_answer checks one tap (for "Look back") and keeps no row; the answer itself never comes back', async () => {
    seed();
    expect(await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_answer', data: { n: 2, pick: 0 } })).toEqual({ ok: true, right: false });
    expect(await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_answer', data: { n: 2, pick: 1 } })).toEqual({ ok: true, right: true });
    expect(await status(Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_answer', data: { n: 3, pick: 2 } }))).toBe(400); // a draft question
    expect(fake.db.story_events).toHaveLength(0);
  });
  test('story_questions_done returns by_kind as [right, total] per kind (the teacher\'s report reads it; the child screen never shows it)', async () => {
    seed();
    const out = await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_questions_done', data: { answers: [0, 0] } });
    expect(out.by_kind).toEqual({ literal: [1, 1], inference: [0, 1] });
    expect(fake.db.story_events[0].data.by_kind).toEqual({ literal: [1, 1], inference: [0, 1] });
  });
  test('a second miss shows the answer kindly ({show}); a first miss never does', async () => {
    seed();
    expect(await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_answer', data: { n: 2, i: 0 } })).toEqual({ ok: true, right: false });
    expect(await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_answer', data: { n: 2, i: 2, try: 2, first: 0 } })).toEqual({ ok: true, right: false, show: 1 });
    // A "second try" without a wrong first try (missing, the right one, the same tile, not an option) reveals nothing.
    for (const first of [undefined, null, 1, 2, 7, 'x']) {
      expect(await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_answer', data: { n: 2, i: 2, try: 2, first } })).toEqual({ ok: true, right: false }); // eslint-disable-line no-await-in-loop
    }
    expect(await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_answer', data: { n: 2, i: 1, try: 2 } })).toEqual({ ok: true, right: true });
  });
  test('answers as tries per question ([first, second?]): right by the second try counts, by_kind too', async () => {
    seed();
    const out = await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_questions_done', data: { answers: [[2, 0], [1]] } });
    expect(out).toMatchObject({ correct: 2, total: 2, by_kind: { literal: [1, 1], inference: [1, 1] } });
  });
  test('story_page_read keeps which came first and the skipped word positions (numbers only)', async () => {
    seed();
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_read', data: { words_total: 5, words_read: 3, first: 'read', skipped_words: [1, 3, 'x', 999999] } });
    expect(fake.db.story_events[0].data).toEqual({ words_total: 5, words_read: 3, first: 'read', skipped_words: [1, 3] });
  });
  test('story_page_read keeps how many words said again were absorbed (a bounded count only); junk is dropped', async () => {
    seed();
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_read', data: { words_total: 5, words_read: 5, absorbed: 2, heard: 'plays plays' } });
    expect(fake.db.story_events[0].data).toEqual({ words_total: 5, words_read: 5, absorbed: 2 });
    for (const absorbed of [-1, 1.5, '3', 'x', true, [2]]) {
      await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_read', data: { words_total: 5, absorbed } }); // eslint-disable-line no-await-in-loop
    }
    expect(fake.db.story_events.slice(1).map((r) => r.data)).toEqual(Array(6).fill({ words_total: 5 }));
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_read', data: { absorbed: 999999 } });
    expect(fake.db.story_events[7].data).toEqual({ absorbed: 2000 });
  });
  test('the public shelf: no token, no child, only ready books of the grade × language in catalogue order, covers only', async () => {
    seed();
    const out = await Stories.shelfPublic({ g: '2', l: 'en' });
    expect(out.grade).toBe(2); expect(out.lang).toBe('en');
    expect(out.books.map((b) => b.id)).toEqual([1, 2, 3, 4, 5, 6, 7].map(F.BOOK));
    expect(Object.keys(out.books[0]).sort()).toEqual(['cover', 'dir', 'grade', 'id', 'lang', 'minutes', 'pages', 'title']);
    expect(mockKidFromHub).not.toHaveBeenCalled();
  });
  test('the public shelf is closed with the switch off', async () => {
    seed({ on: false });
    expect(await body(Stories.shelfPublic({ g: '2' }))).toEqual({ error: 'stories_off' });
  });
  test('story_answer accepts the contract\'s {n, i} as well as {n, pick}', async () => {
    seed();
    expect(await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_answer', data: { n: 1, i: 0 } })).toEqual({ ok: true, right: true });
  });
  test('effort stars: one for listening, one for reading aloud, one for answering — never for being right', () => {
    expect(Stories.effortStars({ listened: 0, read: 0, answered: false })).toBe(0);
    expect(Stories.effortStars({ listened: 2, read: 0, answered: false })).toBe(1);
    expect(Stories.effortStars({ listened: 2, read: 1, answered: false })).toBe(2);
    expect(Stories.effortStars({ listened: 2, read: 1, answered: true })).toBe(3);
  });
  test('stars on story_questions_done count the child\'s effort on this book, whatever the answers', async () => {
    seed();
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_listened', data: { ms: 3000, completed: true } });
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_read', data: { words_total: 5, words_read: 5 } });
    const wrong = await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_questions_done', data: { answers: [2, 2] } });
    expect(wrong.correct).toBe(0);
    expect(wrong.stars).toBe(3);
  });
  test('sticker once: the first story_done of a book gives the sticker when the Book is on, never again', async () => {
    seed({ book: true });
    fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(1), page_n: 1, event: 'story_page_listened', data: {}, at: new Date().toISOString() });
    fake.db.story_events.push({ child_id: KID_B, book_id: F.BOOK(1), page_n: 1, event: 'story_page_read', data: { words_total: 5, words_read: 4 }, at: new Date().toISOString() });
    const first = await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_done', data: { pages_listened: 3, pages_read: 1, stars: 3 } });
    expect(first).toEqual({ ok: true, sticker: true });
    const again = await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_done', data: {} });
    expect(again).toEqual({ ok: true, sticker: false });
    // Another child finishing the same book gets their own.
    const other = await Stories.event(TOKEN, { kid: 'b', book_id: F.BOOK(1), event: 'story_done', data: {} });
    expect(other.sticker).toBe(true);
    expect(fake.db.story_events.filter((e) => e.event === 'story_done')).toHaveLength(3);
  });
  test('story_done keeps effort stars counted from the child\'s own events, never the page\'s claim', async () => {
    seed();
    fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(1), page_n: 1, event: 'story_page_listened', data: {}, at: new Date().toISOString() });
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_done', data: { pages_listened: 9, pages_read: 9, stars: 3 } });
    expect(fake.db.story_events.find((e) => e.event === 'story_done').data).toEqual({ pages_listened: 1, pages_read: 0, stars: 1 });
  });
  test('a page read with under 10 % of its words heard, or a voiceless "listen", is not effort: no sticker, no star for it', async () => {
    seed({ book: true });
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_read', data: { words_total: 12, words_read: 1 } });
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 2, event: 'story_page_listened', data: { miss: true } });
    const out = await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_done', data: {} });
    expect(out).toEqual({ ok: true, sticker: false });
    expect(fake.db.story_events.some((e) => e.event === 'story_done')).toBe(false);
  });
  test('an older story_done row with no effort in it is not counted: no Book sticker, no shelf tick, not the first, no resume hidden', async () => {
    seed({ book: true });
    const at = new Date().toISOString();
    fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(1), event: 'story_done', data: { pages_listened: 0, pages_read: 0, stars: 0 }, at });
    fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(1), event: 'story_done', data: {}, at });
    expect(await Stories.stickersFor(KID)).toEqual([]);
    expect((await Stories.shelf(TOKEN, { kid: 'a' })).books.find((b) => b.id === F.BOOK(1)).done).toBe(false);
    fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(1), page_n: 1, event: 'story_page_listened', data: {}, at });
    expect((await Stories.hubBits({ studentId: KID })).stories.resume).toEqual(expect.objectContaining({ book_id: F.BOOK(1) }));
    expect(await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_done', data: {} })).toEqual({ ok: true, sticker: true });
  });
  test('page_n is a page of the book (1..pages): 0 and pages+1 are refused', async () => {
    seed();
    expect(await status(Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 0, event: 'story_page_read', data: {} }))).toBe(400);
    expect(await status(Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 3, event: 'story_page_read', data: {} }))).toBe(400);
    expect(await status(Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 2, event: 'story_page_read', data: {} }))).toBe(200);
  });
  test('skipped_words keeps at most 10 word places', async () => {
    seed();
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_read', data: { words_total: 40, words_read: 10, skipped_words: Array.from({ length: 30 }, (_, i) => i) } });
    expect(fake.db.story_events[0].data.skipped_words).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  test('a finish with nothing listened or read keeps no story_done row: no Book sticker, no shelf tick, a later real finish still earns it', async () => {
    seed({ book: true });
    const out = await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_done', data: {} });
    expect(out).toEqual({ ok: true, sticker: false });
    expect(fake.db.story_events.some((e) => e.event === 'story_done')).toBe(false);
    expect(await Stories.stickersFor(KID)).toEqual([]);
    const shelf = await Stories.shelf(TOKEN, { kid: 'a' });
    expect(shelf.books.find((b) => b.id === F.BOOK(1)).done).toBe(false);
    await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_listened', data: {} });
    const real = await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_done', data: {} });
    expect(real).toEqual({ ok: true, sticker: true });
    expect(fake.db.story_events.filter((e) => e.event === 'story_done')).toHaveLength(1);
  });
  test('no sticker while the Book is off', async () => {
    seed({ book: false });
    const out = await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_done', data: {} });
    expect(out).toEqual({ ok: true, sticker: false });
  });
  test('stickersFor: the child\'s first finish of each ready book, newest first, with its title', async () => {
    seed();
    fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(2), event: 'story_done', data: { pages_listened: 1, pages_read: 0, stars: 1 }, at: '2026-10-15T10:00:00Z' });
    fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(1), event: 'story_done', data: { pages_listened: 1, pages_read: 0, stars: 1 }, at: '2026-10-16T10:00:00Z' });
    fake.db.story_events.push({ child_id: KID, book_id: F.BOOK(1), event: 'story_done', data: { pages_listened: 1, pages_read: 0, stars: 1 }, at: '2026-10-16T11:00:00Z' });
    expect(await Stories.stickersFor(KID)).toEqual([
      { book_id: F.BOOK(1), title: 'Book 1 Testwala', cover: `/s/${F.BOOK(1)}/cover-aaaa0001.webp` },
      { book_id: F.BOOK(2), title: 'Book 2 Testwala', cover: `/s/${F.BOOK(2)}/cover-aaaa0002.webp` },
    ]);
  });
});

describe('pageReadable (the live-read key asks before it spends)', () => {
  test('true only for a text page of a ready book with Stories on', async () => {
    seed();
    expect(await Stories.pageReadable(F.BOOK(1), 1)).toBe(true);
    expect(await Stories.pageReadable(F.BOOK(1), 3)).toBe(false);   // a picture page: no words to read
    expect(await Stories.pageReadable(F.BOOK(1), 9)).toBe(false);   // no such page
    expect(await Stories.pageReadable(F.BOOK(8), 1)).toBe(false);   // a draft book
    expect(await Stories.pageReadable('junk', 1)).toBe(false);
  });
  test('false with Stories off, without reading any book', async () => {
    seed({ on: false });
    const before = fake.calls.length;
    expect(await Stories.pageReadable(F.BOOK(1), 1)).toBe(false);
    expect(fake.calls.slice(before).some((c) => c.table !== 'app_settings')).toBe(false);
  });
});

describe('the switch read: one failing key never turns stories off', () => {
  const { OFF_VALUES, throwOn } = require('../../helpers/switch-off-matrix');
  const ALL_ON = [['web_quiz_stories_steady', true], ['web_quiz_live_read_v3', true], ['web_quiz_challenge_realtime', true], ['web_quiz_challenge_keep_audio', true]];
  // Count the stories switch reads (an app_settings `.in('key', …)` naming `web_quiz_stories`), failed ones too.
  function counting(from) {
    const reads = { n: 0 };
    supabase.from = (t) => {
      const b = from(t);
      if (t === 'app_settings' && typeof b.in === 'function') {
        const within = b.in;
        b.in = (c, vs) => { if (c === 'key' && [].concat(vs).includes('web_quiz_stories')) reads.n += 1; return within.call(b, c, vs); };
      }
      return b;
    };
    return reads;
  }
  function seedAllOn() {
    seed({ band: true });
    ALL_ON.forEach(([key, value]) => fake.db.app_settings.push({ key, value }));
  }
  const view = (out) => ({ band: out.pages[0].text_band !== null, steady: out.steady === 1, lr3: out.lr3, keep: Object.prototype.hasOwnProperty.call(out, 'lr3_keep') ? out.lr3_keep : 'none' });

  test('normal path: everything on is one read, then cached', async () => {
    seedAllOn();
    const reads = counting(fake.from);
    expect(view(await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' }))).toEqual({ band: true, steady: true, lr3: true, keep: true });
    expect(await status(Stories.shelf(TOKEN, { kid: 'a', now: NOON_PKT }))).toBe(200);
    expect(reads.n).toBe(1);
  });
  test('normal path: stories off is one read (the recorded constant), then cached', async () => {
    seed({ on: false });
    const reads = counting(fake.from);
    expect(await body(Stories.shelf(TOKEN, { kid: 'a' }))).toEqual({ error: 'stories_off' });
    expect(await body(Stories.book(F.BOOK(1), TOKEN, { kid: 'a' }))).toEqual({ error: 'stories_off' });
    expect(reads.n).toBe(1);
  });
  // [key that fails to read, what the book says, settings reads]: the read is tried again without each rider, the last
  // first (the voice as mp3, the reader's polish, the text lens, the warmed reader, keep-audio, Your turn's word rules, then Slower's two), then without the live reader's two, then the main switch alone; the keys left
  // out are off, the rest read as before.
  test.each([
    // (web_quiz_story_mp3 is the last rider: every count below it is one read more than before it rode along)
    ['web_quiz_challenge_keep_audio', { band: true, steady: true, lr3: true, keep: false }, 6],
    ['web_quiz_live_read_v3', { band: true, steady: true, lr3: false, keep: 'none' }, 10],
    ['web_quiz_challenge_realtime', { band: true, steady: true, lr3: false, keep: 'none' }, 10],
    ['web_quiz_stories_band', { band: false, steady: false, lr3: false, keep: 'none' }, 11],
    ['web_quiz_stories_steady', { band: false, steady: false, lr3: false, keep: 'none' }, 11],
    ['web_quiz_stories_text_lens', { band: true, steady: true, lr3: true, keep: true }, 4],
    ['web_quiz_stories_polish', { band: true, steady: true, lr3: true, keep: true }, 3],
    ['web_quiz_story_mp3', { band: true, steady: true, lr3: true, keep: true }, 2],
  ])('a failed read naming %s keeps the shelf and the book on', async (key, want, n) => {
    seedAllOn();
    const reads = counting(throwOn(fake.from, key));
    expect(await status(Stories.shelf(TOKEN, { kid: 'a', now: NOON_PKT }))).toBe(200);
    expect(reads.n).toBe(n);
    expect(view(await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' }))).toEqual(want);
    expect(await Stories.hubBits()).toEqual({ stories: { on: 1 } });
    expect(reads.n).toBe(n); // cached: the book and the hub read nothing more
  });
  test('the text lens (web_quiz_stories_text_lens): the book says tx: 1 only for the JSON true; any other value, or no row, no key', async () => {
    for (const [value, want] of [[true, 1], ['true', undefined], [1, undefined], [null, undefined]]) {
      Stories._reset(); seedAllOn();
      if (value !== null) fake.db.app_settings.push({ key: 'web_quiz_stories_text_lens', value });
      const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
      expect([value, out.tx]).toEqual([value, want]);
    }
  });
  test('the reader polish (web_quiz_stories_polish): the book says pl: 1 only for the JSON true; any other value, or no row, no key', async () => {
    for (const [value, want] of [[true, 1], ['true', undefined], [1, undefined], [null, undefined]]) {
      Stories._reset(); seedAllOn();
      if (value !== null) fake.db.app_settings.push({ key: 'web_quiz_stories_polish', value });
      const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
      expect([value, out.pl, Object.prototype.hasOwnProperty.call(out, 'pl')]).toEqual([value, want, want !== undefined]);
    }
  });
  test('a failed read naming web_quiz_stories itself is off: shelf and book 404 stories_off, cached', async () => {
    seedAllOn();
    const reads = counting(throwOn(fake.from, 'web_quiz_stories'));
    expect(await body(Stories.shelf(TOKEN, { kid: 'a' }))).toEqual({ error: 'stories_off' });
    expect(await body(Stories.book(F.BOOK(1), TOKEN, { kid: 'a' }))).toEqual({ error: 'stories_off' });
    expect(await Stories.hubBits()).toEqual({});
    expect(reads.n).toBe(11);   // every rider dropped in turn (the voice as mp3 the first), then the main switch alone
    expect(mockKidFromHub).not.toHaveBeenCalled();
  });
  test('the fallback reads stories as strictly as the normal path: every OFF value of web_quiz_stories is off', async () => {
    for (const [label, value] of [...OFF_VALUES, ['"true"', 'true']]) {
      for (const key of ['web_quiz_challenge_keep_audio', 'web_quiz_stories_band']) {
        Stories._reset(); seedAllOn();
        fake.db.app_settings = fake.db.app_settings.filter((r) => r.key !== 'web_quiz_stories');
        if (value !== null) fake.db.app_settings.push({ key: 'web_quiz_stories', value });
        counting(throwOn(fake.from, key));
        expect([label, key, await body(Stories.shelf(TOKEN, { kid: 'a' }))]).toEqual([label, key, { error: 'stories_off' }]);
      }
    }
  });
});

describe('a phone that cannot play Ogg Opus: the book says mp3 (app_settings web_quiz_story_mp3)', () => {
  test('on (JSON true): the book carries mp3: 1 (the reader then asks for each voice as .mp3); the voice URLs are unchanged', async () => {
    seed({ extra: {} });
    fake.db.app_settings.push({ key: 'web_quiz_story_mp3', value: true });
    const out = await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' });
    expect(out.mp3).toBe(1);
    expect(out.pages[0].audio.url).toMatch(/\.ogg$/);
  });
  test('GOLDEN: absent, false or the string "true" → no key', async () => {
    for (const v of [undefined, false, 'true']) {
      Stories._reset();
      seed();
      if (v !== undefined) fake.db.app_settings.push({ key: 'web_quiz_story_mp3', value: v });
      expect(await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' })).not.toHaveProperty('mp3');
    }
  });
});
