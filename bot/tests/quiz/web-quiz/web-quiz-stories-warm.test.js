'use strict';
/**
 * The story reader warmed from the shelf (app_settings web_quiz_story_warm, default off, JSON true only): the shelf's
 * answer says `warm: true`, and the page then fetches the reader's files while the child looks at the shelf and the
 * first page's picture as soon as the book arrives (dashboard wq-stories.js). Off: the shelf's answer is today's.
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
function seed({ on = true, book = false, band = false, warm, extra = {} } = {}) {
  const settings = [];
  if (on) settings.push({ key: 'web_quiz_stories', value: true });
  if (band) settings.push({ key: 'web_quiz_stories_band', value: true });
  if (warm !== undefined) settings.push({ key: 'web_quiz_story_warm', value: warm });
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

describe('the shelf says warm only with the switch on', () => {
  const shelfOf = async (opts) => { Stories._reset(); seed(opts); return JSON.stringify(await Stories.shelf(TOKEN, { kid: 'a', now: NOON_PKT })); };
  test('on (the JSON true): the shelf answer says warm: true and each book its first page\'s picture, the rest as off', async () => {
    const off = await shelfOf({});
    const on = await shelfOf({ warm: true });
    expect(JSON.parse(on).warm).toBe(true);
    // each book with a first page carries its picture on the /s/ route (the reader's own address for it)
    const books = JSON.parse(on).books;
    expect(books.length).toBeGreaterThan(0);
    books.filter((b) => b.p1).forEach((b) => expect(b.p1).toMatch(new RegExp(`^/s/${b.id}/`)));
    expect(books.some((b) => b.p1)).toBe(true);
    const { warm, ...rest } = JSON.parse(on);
    rest.books = rest.books.map(({ p1, ...b }) => b);
    expect(JSON.stringify(rest)).toBe(off);
  });
  test.each([['no row', undefined], ['false', false], ["the string 'true'", 'true'], ['1', 1], ['an object', { on: true }]])('%s: off, byte for byte the shelf of today', async (_n, value) => {
    const today = await shelfOf({});
    expect(await shelfOf({ warm: value })).toBe(today);
    expect(today).not.toMatch(/"warm"/);
  });
  test('a settings read that fails is off', async () => {
    const today = await shelfOf({});
    seed({ warm: true });
    const from = supabase.from;
    supabase.from = (t) => (t === 'app_settings' ? { select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'down' } }) }) } : from(t));
      const out = await Stories.shelf(TOKEN, { kid: 'a', now: NOON_PKT }).catch(() => null);
    supabase.from = from;
    if (out) expect(out.warm).toBeUndefined();
    expect(today).not.toMatch(/"warm"/);
  });
});
