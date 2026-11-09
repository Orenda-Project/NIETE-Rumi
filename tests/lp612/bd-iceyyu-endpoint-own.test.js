'use strict';
/**
 * bd-iceyyu — the lesson-plan Flow endpoint with "Make my own" (lp612-own-offer.js).
 *
 *   flag off  the chapter's lesson screen is byte-for-byte today's, and the catalogue is asked exactly as before
 *   flag on   page 1 opens with the Make my own row, and the catalogue keeps a row free for it (lead: 1)
 *   the tap   ONE link message (sendOwnLink), and the Flow closes on SUCCESS saying the button is in the chat
 */

const LESSONS = [{ id: 'seg-1', 'main-content': { title: 'Forces' } }];
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  buildGradeItems: jest.fn().mockResolvedValue([]),
  buildSubjectItems: jest.fn().mockResolvedValue([]),
  buildChapterItems: jest.fn().mockResolvedValue({ items: [], hasMore: false, total: 0, page: 1 }),
  buildSegmentItems: jest.fn(),
  segmentById: jest.fn(),
}));
jest.mock('../../bot/shared/services/lp612-serving.service', () => ({ requestLesson: jest.fn() }));
jest.mock('../../bot/shared/services/lp612-own-offer', () => ({
  STEP: 'lp612_own',
  isOfferedTo: jest.fn(async () => false),
  ownRow: jest.fn(() => ({ id: 'lp612_own', 'main-content': { title: 'Make my own' } })),
  sendOwnLink: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendCtaUrl: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ buildR2PublicUrl: (k) => k, getPresignedUrl: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/book-curriculum.service', () => ({
  ICT: 'ict', curriculumForUser: jest.fn(async () => 'ict'), forUser: jest.fn(async () => 'ict'),
}));
const mockUser = { phone_number: '923345027774', preferred_language: 'ur' };
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

const Catalog = require('../../bot/shared/services/lp612-catalog.service');
const Offer = require('../../bot/shared/services/lp612-own-offer');
const EP = require('../../bot/shared/routes/pakistan-lp-endpoint');

const TOKEN = 'user-1:flowtok';
const chapterTap = { step: 'lp612_chapter', grade: '7', subject: 'Physics', chapter_key: 'c01', book_stem: 'g7_physics' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.LP_612_ENABLED = 'true';
  Catalog.buildSegmentItems.mockResolvedValue({ items: [...LESSONS], hasMore: false, total: 1, page: 1 });
  Offer.isOfferedTo.mockResolvedValue(false);
  Offer.sendOwnLink.mockResolvedValue(true);
});
afterAll(() => { delete process.env.LP_612_ENABLED; });

describe('the chapter\'s lesson screen', () => {
  test('flag off: today\'s items, and the catalogue asked with today\'s arguments (no lead)', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', chapterTap);
    expect(res.screen).toBe('SELECT_LESSON');
    expect(res.data.items).toEqual(LESSONS);
    const args = Catalog.buildSegmentItems.mock.calls[0];
    expect(args.slice(0, 5)).toEqual([7, 'Physics', 'c01', 1, 'g7_physics']);
    expect(args.some((a) => a && typeof a === 'object' && 'lead' in a)).toBe(false);
    expect(Offer.ownRow).not.toHaveBeenCalled();
  });

  test('flag on: Make my own is the FIRST row, and the catalogue keeps a row free for it', async () => {
    Offer.isOfferedTo.mockResolvedValue(true);
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', chapterTap);
    expect(res.data.items[0].id).toBe('lp612_own');
    expect(res.data.items.slice(1)).toEqual(LESSONS);
    expect(Offer.isOfferedTo).toHaveBeenCalledWith('user-1');
    const args = Catalog.buildSegmentItems.mock.calls[0];
    expect(args[5]).toEqual(expect.objectContaining({ lead: 1 }));
    expect(Offer.ownRow).toHaveBeenCalledWith(expect.objectContaining({ grade: 7, subject: 'Physics', chapterKey: 'c01' }));
  });

  test('flag on, Urdu book: the row is asked for in RTL', async () => {
    Offer.isOfferedTo.mockResolvedValue(true);
    Catalog.buildSegmentItems.mockResolvedValue({ items: [...LESSONS], hasMore: false, total: 1, page: 1, rtl: true });
    await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', chapterTap);
    expect(Offer.ownRow).toHaveBeenCalledWith(expect.objectContaining({ rtl: true }));
  });

  test('page 2 never carries the row; its lead rides back from the More row', async () => {
    Offer.isOfferedTo.mockResolvedValue(true);
    await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', {
      step: 'lp612_segment_page', grade: '7', subject: 'Physics', chapter_key: 'c01', page: '2', lead: '1',
    });
    expect(Offer.ownRow).not.toHaveBeenCalled();
    expect(Catalog.buildSegmentItems.mock.calls[0][5]).toEqual(expect.objectContaining({ lead: 1 }));
  });

  test('page 2 of a flag-off chapter: today\'s arguments', async () => {
    await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', {
      step: 'lp612_segment_page', grade: '7', subject: 'Physics', chapter_key: 'c01', page: '2',
    });
    const args = Catalog.buildSegmentItems.mock.calls[0];
    expect(args.some((a) => a && typeof a === 'object' && 'lead' in a)).toBe(false);
  });
});

describe('tapping Make my own', () => {
  const tap = { step: 'lp612_own', grade: '7', subject: 'Physics', chapter_key: 'c01' };

  test('one link, sent to her, in her language; the Flow closes on SUCCESS', async () => {
    Offer.isOfferedTo.mockResolvedValue(true);
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', tap);
    expect(res.screen).toBe('SUCCESS');
    expect(res.data.message).toMatch(/بٹن/);
    expect(Offer.sendOwnLink).toHaveBeenCalledTimes(1);
    expect(Offer.sendOwnLink).toHaveBeenCalledWith({
      userId: 'user-1', phone: '923345027774', language: 'ur', grade: 7, subject: 'Physics', chapterKey: 'c01',
    });
  });

  test('a row left in scrollback after the flag went off: refused, nothing sent', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', tap);
    expect(res.data.error).toBeDefined();
    expect(Offer.sendOwnLink).not.toHaveBeenCalled();
  });

  test('a malformed tap: refused, nothing sent', async () => {
    Offer.isOfferedTo.mockResolvedValue(true);
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', { ...tap, grade: '3' });
    expect(res.data.error).toBeDefined();
    expect(Offer.sendOwnLink).not.toHaveBeenCalled();
  });

  test('the link failed to send: the Flow says so instead of pointing at a button that is not there', async () => {
    Offer.isOfferedTo.mockResolvedValue(true);
    Offer.sendOwnLink.mockResolvedValue(false);
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', tap);
    expect(res.data.error).toBeDefined();
  });
});
