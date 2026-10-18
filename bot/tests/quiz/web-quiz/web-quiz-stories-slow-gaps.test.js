'use strict';
/**
 * The storybook's "Slower" as gaps between phrases (app_settings `web_quiz_stories_slow_gaps`, only a literal true):
 * on, the book says `slow_gaps: true` and the reader waits between phrases instead of slowing the voice; off (or any
 * other value), the book's payload is exactly what it was before the switch existed (no new key).
 * Supabase, R2's presign and the hub are faked; books are invented ("Testwala", __fixtures__/stories-testwala.js).
 */
process.env.WEB_QUIZ_TOKEN_SECRET = 'test-only-secret';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/quiz/web-quiz-hub', () => ({ kidFromHub: async (token) => (token === 'hub-token' ? { studentId: '44444444-4444-4444-8444-444444444444', grade: '2', rootId: null } : null) }));
jest.mock('../../../shared/storage/r2', () => ({ presignKey: async (key) => `https://r2.example.test/${key}?sig=1` }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const F = require('./__fixtures__/stories-testwala');
const Stories = require('../../../shared/services/quiz/web-quiz-stories');

const clone = (v) => JSON.parse(JSON.stringify(v));
function seed(extraSettings = []) {
  Object.assign(supabase, makeFake({
    app_settings: [{ key: 'web_quiz_stories', value: true }, ...extraSettings],
    story_books: [F.book(1)],
    story_pages: clone([F.P2, F.P1, F.P3]),
    story_page_voices: clone([F.VOICE_P1, F.VOICE_P1_OLD]),
    story_questions: clone(F.QUESTIONS),
    story_events: [],
  }));
}
async function bookWith(settings) {
  Stories._reset();
  seed(settings);
  return Stories.book(F.BOOK(1), 'hub-token', { kid: 'a' });
}

describe('web_quiz_stories_slow_gaps', () => {
  test('on (a literal true): the book says slow_gaps, for the child and for the teacher preview', async () => {
    const out = await bookWith([{ key: 'web_quiz_stories_slow_gaps', value: true }]);
    expect(out.slow_gaps).toBe(true);
    expect((await Stories.bookData(F.BOOK(1))).slow_gaps).toBe(true);
  });
  test('off, absent or not a literal true: the payload is byte-identical to the payload without the switch', async () => {
    const base = JSON.stringify(await bookWith([]));
    expect(base).not.toContain('slow_gaps');
    for (const value of [false, 'true', 1, null, { on: true }]) {
      expect(JSON.stringify(await bookWith([{ key: 'web_quiz_stories_slow_gaps', value }]))).toBe(base);
    }
  });
  test('with stories off the switch opens nothing (404 stories_off)', async () => {
    Stories._reset();
    Object.assign(supabase, makeFake({ app_settings: [{ key: 'web_quiz_stories_slow_gaps', value: true }], story_books: [F.book(1)], story_pages: [], story_page_voices: [], story_questions: [], story_events: [] }));
    await expect(Stories.bookData(F.BOOK(1))).rejects.toMatchObject({ status: 404 });
  });
});

// The page-listened row says when the child listened with Slower on (`slow: 1`), only with the switch on; off, the row is
// exactly today's (the read of Slower on vs off goes to the retention numbers).
describe('story_page_listened says slow: 1, only with web_quiz_stories_slow_gaps on', () => {
  async function listened(settings, data) {
    Stories._reset();
    seed(settings);
    await Stories.event('hub-token', { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_listened', data });
    return supabase.db.story_events.map((r) => r.data);
  }
  const ON = [{ key: 'web_quiz_stories_slow_gaps', value: true }];
  test('on + Slower on: slow: 1 is kept with the page\'s numbers', async () => {
    expect(await listened(ON, { ms: 5200, completed: true, slow: 1 })).toEqual([{ ms: 5200, completed: true, slow: 1 }]);
  });
  test('on, anything but the number 1 is dropped', async () => {
    for (const slow of [true, '1', 2, 0, 'yes']) expect(await listened(ON, { ms: 10, completed: false, slow })).toEqual([{ ms: 10, completed: false }]);
  });
  test('off, absent or not a literal true: slow is dropped and the row is byte-identical to today\'s', async () => {
    const base = JSON.stringify(await listened([], { ms: 5200, completed: true }));
    for (const settings of [[], [{ key: 'web_quiz_stories_slow_gaps', value: false }], [{ key: 'web_quiz_stories_slow_gaps', value: 'true' }]]) {
      expect(JSON.stringify(await listened(settings, { ms: 5200, completed: true, slow: 1 }))).toBe(base);
    }
  });
  test('other events never keep slow', async () => {
    Stories._reset();
    seed(ON);
    await Stories.event('hub-token', { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_read', data: { ms: 10, slow: 1 } });
    expect(supabase.db.story_events[0].data).toEqual({ ms: 10 });
  });
});

// The Slower numbers from settings (`web_quiz_stories_slow_ms`, read in the same settings read): with the gaps switch
// on, a valid {sentence: [target, least], comma: [target, least]} goes to the book as slow_gaps; absent or junk, the
// book keeps `true` (the player's own 700/500 · 400/250). Off, the payload is unchanged whatever the numbers say.
describe('web_quiz_stories_slow_ms: the Slower numbers', () => {
  const GAPS = { key: 'web_quiz_stories_slow_gaps', value: true };
  const ms = (value) => ({ key: 'web_quiz_stories_slow_ms', value });
  const OK = { sentence: [900, 600], comma: [500, 300] };
  test('absent: slow_gaps is true', async () => {
    expect((await bookWith([GAPS])).slow_gaps).toBe(true);
  });
  test('valid: the book carries the numbers', async () => {
    expect((await bookWith([GAPS, ms(OK)])).slow_gaps).toEqual(OK);
    expect((await bookWith([GAPS, ms({ sentence: [0, 0], comma: [2000, 2000] })])).slow_gaps).toEqual({ sentence: [0, 0], comma: [2000, 2000] });
  });
  test.each([
    ['a string', '{"sentence":[900,600],"comma":[500,300]}'],
    ['a negative', { sentence: [900, -1], comma: [500, 300] }],
    ['least above target', { sentence: [500, 600], comma: [500, 300] }],
    ['over 2,000', { sentence: [2001, 600], comma: [500, 300] }],
    ['not an int', { sentence: [900.5, 600], comma: [500, 300] }],
    ['comma missing', { sentence: [900, 600] }],
    ['three numbers', { sentence: [900, 600, 1], comma: [500, 300] }],
    ['true', true],
  ])('junk (%s): slow_gaps stays true', async (_l, value) => {
    expect((await bookWith([GAPS, ms(value)])).slow_gaps).toBe(true);
  });
  test('only the two numbers are sent (a stray field is not)', async () => {
    expect((await bookWith([GAPS, ms({ ...OK, note: 'x' })])).slow_gaps).toEqual(OK);
  });
  test('gaps off: the numbers change nothing (byte-identical payload)', async () => {
    const base = JSON.stringify(await bookWith([]));
    expect(JSON.stringify(await bookWith([ms(OK)]))).toBe(base);
    expect(JSON.stringify(await bookWith([{ key: 'web_quiz_stories_slow_gaps', value: false }, ms(OK)]))).toBe(base);
  });
});

// A read that names a rider and fails must not change its host: the stories switch (and the other keys of the read)
// read again alone, the failed rider is off. Normal path: one settings read, as before.
describe('the combined settings read: a failing rider never turns stories off', () => {
  const { throwOn } = require('../../helpers/switch-off-matrix');
  const GAPS = { key: 'web_quiz_stories_slow_gaps', value: true };
  const MS = { key: 'web_quiz_stories_slow_ms', value: { sentence: [900, 600], comma: [500, 300] } };
  async function bookFailing(settings, key) {
    Stories._reset();
    seed(settings);
    supabase.from = throwOn(supabase.from, key);
    return Stories.book(F.BOOK(1), 'hub-token', { kid: 'a' });
  }
  test('the gaps key\'s read throws: stories stay on and the book is today\'s (no slow_gaps)', async () => {
    const base = JSON.stringify(await bookWith([]));
    expect(JSON.stringify(await bookFailing([GAPS, MS], 'web_quiz_stories_slow_gaps'))).toBe(base);
  });
  test('the numbers\' read throws: stories on, gaps on, the numbers fall back to true', async () => {
    expect((await bookFailing([GAPS, MS], 'web_quiz_stories_slow_ms')).slow_gaps).toBe(true);
  });
  test('the stories key\'s own read throws: stories off (404), as today', async () => {
    await expect(bookFailing([GAPS, MS], 'web_quiz_stories')).rejects.toMatchObject({ status: 404 });
  });
  test('never a throw out of flags(), and the answer is cached (no read storm)', async () => {
    Stories._reset();
    seed([GAPS]);
    supabase.from = throwOn(supabase.from, 'web_quiz_stories_slow_ms');
    const f = await Stories.flags();
    expect(f.on).toBe(true);
    expect(f.gaps).toBe(true);
    const n = supabase.calls.filter((c) => c.table === 'app_settings').length;
    await Stories.flags();
    expect(supabase.calls.filter((c) => c.table === 'app_settings').length).toBe(n);
  });
});

// Cold (nothing read first), keys absent: every route that reads the stories settings still reads app_settings
// exactly as often as before the two keys joined the read.
describe('cold reads per route, the keys absent', () => {
  const reads = () => supabase.calls.filter((c) => c.table === 'app_settings').length;
  const cold = async (fn) => { Stories._reset(); seed([]); const before = reads(); await fn().catch(() => {}); return reads() - before; };
  test.each([
    ['hubBits', () => Stories.hubBits({ studentId: '44444444-4444-4444-8444-444444444444' }), 1],
    ['shelf', () => Stories.shelf('hub-token', { kid: 'a' }), 1],
    ['shelfPublic', () => Stories.shelfPublic({ g: 1, l: 'en' }), 1],
    ['book', () => Stories.book(F.BOOK(1), 'hub-token', { kid: 'a' }), 1],
    ['bookData', () => Stories.bookData(F.BOOK(1)), 1],
    ['event (page listened)', () => Stories.event('hub-token', { kid: 'a', book_id: F.BOOK(1), page_n: 1, event: 'story_page_listened', data: { ms: 5, completed: true } }), 1],
    ['pageReadable', () => Stories.pageReadable(F.BOOK(1), 1), 1],
  ])('%s: %i read(s) less than or equal the base', async (_l, fn, base) => {
    expect(await cold(fn)).toBe(base);
  });
});
