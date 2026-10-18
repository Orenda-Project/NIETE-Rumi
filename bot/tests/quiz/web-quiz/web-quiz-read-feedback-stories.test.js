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
  test('another phone (the hub refuses it): no body at all, so no reading and no speed', async () => {
    seed({ rf: true, events: READS });
    mockKidFromHub.mockResolvedValue(null);
    await expect(done()).rejects.toMatchObject({ status: expect.any(Number) });
  });
});
