'use strict';
/**
 * The storybooks the next-thing ranker may offer (web-quiz-storybook-next.js): a half-read book first (the hub's own
 * resume rule), then the unread ready books of the child's grade and language in shelf order. `[]` when Stories is off,
 * when the link cannot be built, or on any failure. Books and children are invented ("Testwala").
 */
process.env.WEB_QUIZ_TOKEN_SECRET = 'test-only-secret';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/quiz/web-quiz-hub', () => ({ kidFromHub: async () => null }));
jest.mock('../../../shared/storage/r2', () => ({ presignKey: async (key) => `https://r2.example.test/${key}` }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const F = require('./__fixtures__/stories-testwala');
const Stories = require('../../../shared/services/quiz/web-quiz-stories');
const Next = require('../../../shared/services/quiz/web-quiz-storybook-next');

const KID = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'hub-token';
const NOON_PKT = Date.UTC(2026, 9, 16, 7, 0, 0);
const at = (h) => new Date(NOON_PKT - h * 3600000).toISOString();
const ARGS = { studentId: KID, lang: 'en', grade: 2, token: TOKEN, chip: 'a', now: NOON_PKT };

let fake;
function seed({ on = true, events = [] } = {}) {
  const books = [];
  for (let n = 1; n <= 7; n += 1) books.push(F.book(n));
  books.push(F.book(8, { status: 'draft' }));
  books.push(F.book(9, { lang: 'ur', title: 'کتاب ٹیسٹ والا', slug: 'g2-ur-testwala-9' }));
  books.push(F.book(10, { grade: 3 }));
  fake = makeFake({
    app_settings: on ? [{ key: 'web_quiz_stories', value: true }] : [],
    story_books: books,
    story_events: events,
  });
  Object.assign(supabase, fake);
}
const reads = (table) => fake.calls.filter((c) => c.table === table).length;

beforeEach(() => { Stories._reset(); Next._reset(); });

describe('candidates', () => {
  test('off: [] and nothing read about the child', async () => {
    seed({ on: false });
    expect(await Next.candidates(ARGS)).toEqual([]);
    expect(fake.calls.every((c) => c.table === 'app_settings')).toBe(true);
  });
  test('a half-read book first (rule resume, opens on the reader), then the unread books of the grade and language in shelf order', async () => {
    seed({ events: [
      { child_id: KID, book_id: F.BOOK(1), page_n: 1, event: 'story_page_listened', data: {}, at: at(2) },
      { child_id: KID, book_id: F.BOOK(3), event: 'story_done', data: { pages_listened: 2, pages_read: 0, stars: 1 }, at: at(5) },
    ] });
    const rows = await Next.candidates(ARGS);
    expect(rows[0]).toEqual({
      kind: 'storybook', id: F.BOOK(1), rule: 'resume',
      href: `/h/${TOKEN}?kid=a&lang=en#story/${F.BOOK(1)}`,
      title: 'Book 1 Testwala', title_ur: 'Book 1 Testwala', minutes: 1, art: `/s/${F.BOOK(1)}/cover-aaaa0001.webp`,
    });
    const rest = rows.slice(1);
    expect(rest.every((r) => r.kind === 'storybook' && !r.rule && r.href.endsWith(`#story/${r.id}`))).toBe(true);
    // never the half-read one again, a finished one, a draft, another language or another grade
    const ids = rest.map((r) => r.id);
    [F.BOOK(1), F.BOOK(3), F.BOOK(8), F.BOOK(9), F.BOOK(10)].forEach((id) => expect(ids).not.toContain(id));
    // the shelf's own order (the same child, the same day)
    const order = Stories.shelfOrder([1, 2, 3, 4, 5, 6, 7].map((n) => F.book(n)), { childId: KID, day: Stories.pktDay(NOON_PKT), done: new Set([F.BOOK(3)]), teacher: [] })
      .map((x) => x.id).filter((id) => id !== F.BOOK(1) && id !== F.BOOK(3));
    expect(ids).toEqual(order.slice(0, Next.MAX_UNREAD));
    expect(ids).toHaveLength(3);
  });
  test('Urdu grade 2: the Urdu book only; no words of a test anywhere', async () => {
    seed();
    const rows = await Next.candidates({ ...ARGS, lang: 'ur' });
    expect(rows.map((r) => r.id)).toEqual([F.BOOK(9)]);
    expect(rows[0].href).toBe(`/h/${TOKEN}?kid=a&lang=ur#story/${F.BOOK(9)}`);
    expect(JSON.stringify(rows)).not.toMatch(/\b(test|exam|assessment)\b|امتحان/i);
  });
  test('no link to give (no token or no chip) or no child: []', async () => {
    seed();
    expect(await Next.candidates({ ...ARGS, token: '' })).toEqual([]);
    expect(await Next.candidates({ ...ARGS, chip: null })).toEqual([]);
    expect(await Next.candidates({ ...ARGS, studentId: null })).toEqual([]);
  });
  test('a failing read: [] (never throws)', async () => {
    seed();
    supabase.from = () => { throw new Error('db down'); };
    await expect(Next.candidates(ARGS)).resolves.toEqual([]);
  });
});

