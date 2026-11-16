'use strict';
/**
 * Make my own on the WhatsApp lesson list for grades 1-5 (the v8 lane).
 *
 *   flag off  the chapter's lesson screen is today's, and the catalogue is asked exactly as before
 *   flag on   page 1 opens with the Make my own row, and the catalogue keeps a row free for it (lead 1)
 *   the tap   ONE link message for a 1-5 chapter, even with the 6-12 lane switched off
 */

jest.mock('../../bot/shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: jest.fn(async () => mockAvailable),
  downloadedLessonIds: jest.fn(async () => new Set()),
  deliverV8Lesson: jest.fn(),
}));
jest.mock('../../bot/shared/services/lp612-own-offer', () => ({
  STEP: 'lp612_own',
  isOfferedTo: jest.fn(async () => false),
  ownRow: jest.fn(() => ({ id: 'lp612_own', 'main-content': { title: 'Make my own' } })),
  sendOwnLink: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/services/teacher-books.service', () => ({ bookKeysForUser: jest.fn(async () => null) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendCtaUrl: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ buildR2PublicUrl: (k) => k, getPresignedUrl: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const mockUser = { phone_number: '920000000000', preferred_language: 'ur' };
function mockBuilder() {
  const b = {
    select: () => b, eq: () => b, in: () => b, or: () => b, order: () => b, limit: () => b, range: () => b,
    single: () => Promise.resolve({ data: mockUser, error: null }),
    maybeSingle: () => Promise.resolve({ data: mockUser, error: null }),
    then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => mockBuilder()) }));

const lessons = (n) => Array.from({ length: n }, (_, k) => ({
  lesson_id: `grade_3_urdu_ch4_seg${k + 1}`,
  row: { title: `سبق ${k + 1}`, description: 'd', metadata: 'm' },
}));
const CATALOG = {
  catalog_version: 'v8',
  books: [{
    stem: 'grade_3_urdu', grade: 3, subject: 'Urdu', subject_key: 'urdu', rtl: true,
    chapters: [{ number: 4, title: 'Ch four', title_short: 'Ch four', lessons: lessons(24) }],
  }],
};
const mockAvailable = new Set(CATALOG.books[0].chapters[0].lessons.map((l) => l.lesson_id));

const V8 = require('../../bot/shared/services/lp-v8-catalog.service');
const Offer = require('../../bot/shared/services/lp612-own-offer');
const EP = require('../../bot/shared/routes/pakistan-lp-endpoint');

const TOKEN = 'user-1:flowtok';
const chapterTap = { step: 'chapter', grade: '3', subject: 'urdu', chapter: '4' };
let spy;

beforeAll(() => V8.__setCatalogForTests(CATALOG));
afterAll(() => V8.__setCatalogForTests(null));
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.LP_612_ENABLED;
  Offer.isOfferedTo.mockResolvedValue(false);
  Offer.sendOwnLink.mockResolvedValue(true);
  spy = jest.spyOn(V8, 'buildLessonItems');
});
afterEach(() => spy.mockRestore());

describe('the 1-5 chapter\'s lesson screen', () => {
  test('flag off: today\'s screen, catalogue asked with today\'s arguments', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', chapterTap);
    expect(res.screen).toBe('SELECT_LESSON');
    expect(res.data.items).toHaveLength(20);
    expect(res.data.items[0].id).toMatch(/^V8-/);
    expect(spy.mock.calls[0]).toHaveLength(6);   // no shelf, no lead: today's call
    expect(Offer.ownRow).not.toHaveBeenCalled();
  });

  test('flag on: Make my own is the FIRST row, 18 lessons and More still fit in 20', async () => {
    Offer.isOfferedTo.mockResolvedValue(true);
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', chapterTap);
    const ids = res.data.items.map((i) => i.id);
    expect(ids[0]).toBe('lp612_own');
    expect(ids).toHaveLength(20);
    expect(ids.filter((i) => i.startsWith('V8-'))).toHaveLength(18);
    expect(Offer.isOfferedTo).toHaveBeenCalledWith('user-1');
    expect(Offer.ownRow).toHaveBeenCalledWith({ grade: 3, subject: 'urdu', chapterKey: '4', rtl: true });
  });

  test('page 2 never carries the row; its lead rides back from the More row', async () => {
    Offer.isOfferedTo.mockResolvedValue(true);
    const first = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', chapterTap);
    const more = first.data.items[first.data.items.length - 1]['on-click-action'].payload;
    expect(more).toEqual(expect.objectContaining({ step: 'lesson_page', lead: '1' }));
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', more);
    expect(Offer.ownRow).toHaveBeenCalledTimes(1);
    expect(res.data.items.map((i) => i.id)).toHaveLength(6);
  });
});

describe('tapping Make my own on a 1-5 chapter', () => {
  const tap = { step: 'lp612_own', grade: '3', subject: 'urdu', chapter_key: '4' };

  test('one link, even with the 6-12 lane off; the Flow closes on SUCCESS', async () => {
    Offer.isOfferedTo.mockResolvedValue(true);
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', tap);
    expect(res.screen).toBe('SUCCESS');
    expect(Offer.sendOwnLink).toHaveBeenCalledWith({
      userId: 'user-1', phone: '920000000000', language: 'ur', grade: 3, subject: 'urdu', chapterKey: '4',
    });
  });

  test('not offered to her: refused, nothing sent', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', tap);
    expect(res.data.error).toBeDefined();
    expect(Offer.sendOwnLink).not.toHaveBeenCalled();
  });

  test('a 6-12 row with the 6-12 lane off is still refused', async () => {
    Offer.isOfferedTo.mockResolvedValue(true);
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', { ...tap, grade: '7', chapter_key: 'c01' });
    expect(res.data.error).toBeDefined();
    expect(Offer.sendOwnLink).not.toHaveBeenCalled();
  });
});
