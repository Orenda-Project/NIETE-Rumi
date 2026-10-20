'use strict';
/**
 * A storybook read aloud is answered at the book's end (app_settings web_quiz_read_feedback): story_done carries
 * `reading` — the words the child read across the book, the words on the pages read, the reading time, the speed
 * when the read was long enough to be honest, and the child's own last book's speed — worked out from the child's
 * own page reads, never the page's numbers. The book payload says `read_fb: 1` so the reader loads the moment.
 * Off: story_done and the book are today's, byte for byte, and no speed is kept.
 */
process.env.WEB_QUIZ_TOKEN_SECRET = 'test-only-secret';

jest.mock('../../../shared/config/supabase', () => ({}));
const mockKidFromHub = jest.fn();
jest.mock('../../../shared/services/quiz/web-quiz-hub', () => ({ kidFromHub: (...a) => mockKidFromHub(...a) }));
jest.mock('../../../shared/storage/r2', () => ({ presignKey: async (key) => `https://r2.example.test/${key}?sig=1` }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const F = require('./__fixtures__/stories-testwala');
const Stories = require('../../../shared/services/quiz/web-quiz-stories');
const RF = require('../../../shared/services/quiz/web-quiz-read-feedback');

const KID = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'hub-token';
const clone = (v) => JSON.parse(JSON.stringify(v));
let fake;
function seed({ rf, events = [] } = {}) {
  const settings = [{ key: 'web_quiz_stories', value: true }];
  if (rf !== undefined) settings.push({ key: RF.KEY, value: rf });
  fake = makeFake({
    app_settings: settings,
    story_books: [F.book(1), F.book(2)],
    story_pages: clone([F.P2, F.P1, F.P3]),
    story_page_voices: clone([F.VOICE_P1, F.VOICE_P1_OLD]),
    story_questions: clone(F.QUESTIONS),
    story_events: clone(events),
  });
  Object.assign(supabase, fake);
}
beforeEach(() => {
  Stories._reset(); RF._reset();
  require('../../../shared/services/quiz/web-quiz-book')._resetCache();
  mockKidFromHub.mockReset();
  mockKidFromHub.mockImplementation(async (token) => (token === TOKEN ? { studentId: KID, grade: '2', rootId: null } : null));
});

const at = (h) => new Date(Date.UTC(2026, 9, 17, h)).toISOString();
const read = (page, words_read, words_total, ms, h = 1) => ({ child_id: KID, book_id: F.BOOK(1), page_n: page, event: 'story_page_read', data: { words_total, words_read, skipped: words_total - words_read, ms }, at: at(h) });
// a page read twice: the better read counts; a read under 10 % is not a read (the stories rule)
const READS = [read(1, 8, 10, 6000), read(1, 10, 10, 7000, 2), read(2, 9, 12, 9000), read(3, 1, 14, 2000)];
const LAST_BOOK = { child_id: KID, book_id: F.BOOK(2), page_n: null, event: 'story_done', data: { pages_listened: 0, pages_read: 3, stars: 2, wcpm: 40 }, at: at(0) };
const done = () => Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_done', data: { pages_listened: 0, pages_read: 2 } });

describe('off (absent, false, the string "true"): story_done and the book are today\'s', () => {
  test.each([['absent', undefined], ['false', false], ['the string "true"', 'true']])('%s', async (_n, rf) => {
    seed({ rf, events: [...READS, LAST_BOOK] });
    const out = await done();
    expect(out).not.toHaveProperty('reading');
    const kept = fake.db.story_events.filter((e) => e.event === 'story_done' && e.book_id === F.BOOK(1));
    expect(kept).toHaveLength(1);
    expect(kept[0].data).toEqual({ pages_listened: 0, pages_read: 2, stars: expect.any(Number) });
    expect(await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' })).not.toHaveProperty('read_fb');
  });
});

describe('on', () => {
  test('story_done: the book\'s words, time and speed from the child\'s own best read of each page, and the last book\'s speed', async () => {
    seed({ rf: true, events: [...READS, LAST_BOOK] });
    const out = await done();
    // pages 1 (10 of 10, 7 s) and 2 (9 of 12, 9 s); page 3 (1 of 14) is under 10 % and does not count
    expect(out.reading).toEqual({ words_read: 19, words_total: 22, ms: 16000, wcpm: 71, prev_wcpm: 40 });
    // the speed is kept on the book's done row, so the next book can say "faster than last time"
    const row = fake.db.story_events.find((e) => e.event === 'story_done' && e.book_id === F.BOOK(1));
    expect(row.data.wcpm).toBe(71);
    expect((await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' })).read_fb).toBe(1);
  });
  test('a short book read (under 15 words or 6 s): words and time, never a speed; no last book: no comparison', async () => {
    seed({ rf: true, events: [read(1, 5, 10, 4000)] });
    const out = await done();
    expect(out.reading).toEqual({ words_read: 5, words_total: 10, ms: 4000, wcpm: null, prev_wcpm: null });
    expect(fake.db.story_events.find((e) => e.event === 'story_done').data).not.toHaveProperty('wcpm');
  });
  test('a listened-only book: no reading (nothing was read aloud)', async () => {
    seed({ rf: true, events: [{ child_id: KID, book_id: F.BOOK(1), page_n: 1, event: 'story_page_listened', data: { ms: 9000, completed: true }, at: at(1) }] });
    const out = await Stories.event(TOKEN, { kid: 'a', book_id: F.BOOK(1), event: 'story_done', data: { pages_listened: 1, pages_read: 0 } });
    expect(out).not.toHaveProperty('reading');
  });
  test('the speed only on an honest read: 15 words AND 6 s (14 words in a minute, or 30 words in 5.9 s: no speed)', async () => {
    for (const [w, ms] of [[14, 60000], [30, 5900]]) {
      seed({ rf: true, events: [read(1, w, 40, ms)] });
      expect((await done()).reading).toMatchObject({ words_read: w, ms, wcpm: null });
    }
    seed({ rf: true, events: [read(1, 15, 40, 6000)] });
    expect((await done()).reading.wcpm).toBe(150);
  });
  test('"last time" is the child\'s newest book with a speed, never an older one', async () => {
    const doneRow = (book, wcpm, h) => ({ child_id: KID, book_id: F.BOOK(book), page_n: null, event: 'story_done', data: { pages_listened: 0, pages_read: 2, stars: 2, wcpm }, at: at(h) });
    seed({ rf: true, events: [...READS, doneRow(2, 25, 0), { ...doneRow(2, 55, 1), at: new Date(Date.UTC(2026, 9, 17, 0, 30)).toISOString() }] });
    expect((await done()).reading.prev_wcpm).toBe(55);
  });
  test('the book\'s end answers THIS open of the book: a read from an earlier open (yesterday) is not today\'s, and its speed is not kept as today\'s', async () => {
    const opened = (h) => ({ child_id: KID, book_id: F.BOOK(1), page_n: null, event: 'story_opened', data: { grade: 2, lang: 'en' }, at: at(h) });
    // yesterday (before this open): pages 1 and 2 read well; today: only page 3, 9 of 14 words in 8 s
    seed({ rf: true, events: [read(1, 10, 10, 7000, 0), read(2, 12, 12, 9000, 0), opened(3), read(3, 9, 14, 8000, 4)] });
    // the database sends back only the columns asked for (the fake sends every one): a read that forgets `at` is caught
    const from = supabase.from;
    supabase.from = (t) => {
      const q = from(t);
      if (t !== 'story_events') return q;
      const sel = q.select;
      q.select = (cols, ...rest) => {
        const b = sel.call(q, cols, ...rest);
        if (!cols || cols === '*') return b;
        const keep = String(cols).split(',').map((c) => c.trim());
        const then = b.then.bind(b);
        b.then = (ok, bad) => then((r) => ok({ ...r, data: Array.isArray(r.data) ? r.data.map((row) => Object.fromEntries(keep.filter((k) => k in row).map((k) => [k, row[k]]))) : r.data }), bad);
        return b;
      };
      return q;
    };
    const out = await done();
    expect(out.reading).toEqual({ words_read: 9, words_total: 14, ms: 8000, wcpm: null, prev_wcpm: null });
    expect(fake.db.story_events.find((e) => e.event === 'story_done').data).not.toHaveProperty('wcpm');
    // no open on record (an older page): every read of the book, as before
    seed({ rf: true, events: [read(1, 10, 10, 7000, 0), read(3, 9, 14, 8000, 4)] });
    expect((await done()).reading.words_read).toBe(19);
  });
  test('another phone (the hub refuses it): no body at all, so no reading and no speed', async () => {
    seed({ rf: true, events: READS });
    mockKidFromHub.mockResolvedValue(null);
    await expect(done()).rejects.toMatchObject({ status: expect.any(Number) });
  });
});

// app_settings web_quiz_read_sheet (default off, JSON true only; only with the reading moment on): the book says
// `read_sheet: 1`, so Your turn draws the page's printed band and its picture as one sheet (wq-moment.js art). It rides
// the reading moment's own settings read: on adds no read. Off: the book is today's, key for key.
describe('web_quiz_read_sheet: the book says read_sheet: 1', () => {
  const SHEET = 'web_quiz_read_sheet';
  const reads = () => { let n = 0; const from = supabase.from; supabase.from = (t) => { if (t === 'app_settings') n += 1; return from(t); }; return () => n; };
  const bookWith = async (rf, sheet) => {
    seed({ rf }); Stories._reset(); RF._reset();
    if (sheet !== undefined) fake.db.app_settings.push({ key: SHEET, value: sheet });
    const n = reads();
    return { out: clone(await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' })), n: n() };
  };
  test('on (JSON true) with the reading moment on: read_sheet: 1, otherwise the same book, with the same settings reads', async () => {
    const off = await bookWith(true, undefined);
    const on = await bookWith(true, true);
    expect(off.out).not.toHaveProperty('read_sheet');
    expect(on.out.read_sheet).toBe(1);
    delete on.out.read_sheet;
    expect(on.out).toEqual(off.out);
    expect(on.n).toBe(off.n);
  });
  test('off (false, the string "true", 1, an object), or the reading moment off: no key', async () => {
    for (const v of [false, 'true', 1, { on: true }]) expect([v, 'read_sheet' in (await bookWith(true, v)).out]).toEqual([v, false]);
    for (const rf of [undefined, false]) expect([rf, 'read_sheet' in (await bookWith(rf, true)).out]).toEqual([rf, false]);
  });
});

// app_settings web_quiz_read_sheet_fit (default off, JSON true only; only with the one sheet on): the book says
// `read_sheet: 2`, so a page whose picture would be left out draws it as its own card in the room left, and Jugnu's hint
// is never wider than the picture (wq-moment.js art one 2). The same settings read. Off: read_sheet: 1, as today.
describe('web_quiz_read_sheet_fit: the book says read_sheet: 2', () => {
  const reads = () => { let n = 0; const from = supabase.from; supabase.from = (t) => { if (t === 'app_settings') n += 1; return from(t); }; return () => n; };
  const bookWith = async (rf, sheet, fit) => {
    seed({ rf }); Stories._reset(); RF._reset();
    if (sheet !== undefined) fake.db.app_settings.push({ key: 'web_quiz_read_sheet', value: sheet });
    if (fit !== undefined) fake.db.app_settings.push({ key: 'web_quiz_read_sheet_fit', value: fit });
    const n = reads();
    return { out: clone(await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' })), n: n() };
  };
  test('on (JSON true) with the one sheet on: read_sheet: 2, otherwise the same book, with the same settings reads', async () => {
    const off = await bookWith(true, true, undefined);
    const on = await bookWith(true, true, true);
    expect(off.out.read_sheet).toBe(1);
    expect(on.out.read_sheet).toBe(2);
    on.out.read_sheet = 1;
    expect(on.out).toEqual(off.out);
    expect(on.n).toBe(off.n);
  });
  test('off (false, the string "true", 1, an object): read_sheet: 1; the one sheet or the reading moment off: no key', async () => {
    for (const v of [false, 'true', 1, { on: true }]) expect([v, (await bookWith(true, true, v)).out.read_sheet]).toEqual([v, 1]);
    for (const s of [undefined, false]) expect([s, 'read_sheet' in (await bookWith(true, s, true)).out]).toEqual([s, false]);
    expect('read_sheet' in (await bookWith(false, true, true)).out).toBe(false);
  });
});

// app_settings web_quiz_read_sheet_trim (default off, JSON true only; only with the fit on): the book says `read_sheet: 3`,
// so the picture drawn as its own card is trimmed to its drawing (wq-moment.js art one 3). The same settings read.
// Off: read_sheet: 2 with the fit on, as today.
describe('web_quiz_read_sheet_trim: the book says read_sheet: 3', () => {
  const reads = () => { let n = 0; const from = supabase.from; supabase.from = (t) => { if (t === 'app_settings') n += 1; return from(t); }; return () => n; };
  const bookWith = async (fit, trim) => {
    seed({ rf: true }); Stories._reset(); RF._reset();
    fake.db.app_settings.push({ key: 'web_quiz_read_sheet', value: true });
    if (fit !== undefined) fake.db.app_settings.push({ key: 'web_quiz_read_sheet_fit', value: fit });
    if (trim !== undefined) fake.db.app_settings.push({ key: 'web_quiz_read_sheet_trim', value: trim });
    const n = reads();
    return { out: clone(await Stories.book(F.BOOK(1), TOKEN, { kid: 'a' })), n: n() };
  };
  test('on (JSON true) with the fit on: read_sheet: 3, otherwise the same book, with the same settings reads', async () => {
    const off = await bookWith(true, undefined);
    const on = await bookWith(true, true);
    expect(off.out.read_sheet).toBe(2);
    expect(on.out.read_sheet).toBe(3);
    on.out.read_sheet = 2;
    expect(on.out).toEqual(off.out);
    expect(on.n).toBe(off.n);
  });
  test('off (false, the string "true", 1): read_sheet: 2; the fit off: read_sheet: 1 whatever the trim', async () => {
    for (const v of [false, 'true', 1]) expect([v, (await bookWith(true, v)).out.read_sheet]).toEqual([v, 2]);
    for (const f of [undefined, false]) expect([f, (await bookWith(f, true)).out.read_sheet]).toEqual([f, 1]);
  });
});
