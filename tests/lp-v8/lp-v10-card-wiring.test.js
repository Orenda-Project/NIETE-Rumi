/**
 * v10 coaching test (bd-v0toag.50.1): the card reaches the teacher where the plan does.
 *
 * WhatsApp (deliverV8Lesson) and the app's Open (lessonPdfUrl, which share reuses) send the asset
 * lp-v10-card.servedFor returns. The download row stays on the v9 lesson asset, the plan of record
 * that grading and the quiz key off. Answer keys and ch3-8 group A never ask for a card.
 */
const mockTables = {};
const mockInserts = [];
function mockBuilderFor(table) {
  let rows = [...(mockTables[table] || [])];
  const b = {
    select: () => b,
    eq: (col, val) => { rows = rows.filter((r) => String(r[col]) === String(val)); return b; },
    in: () => b,
    not: () => b,
    order: () => b,
    limit: () => b,
    single: () => Promise.resolve({ data: rows[0] || null, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
    insert: (payload) => {
      mockInserts.push({ table, payload });
      const ret = { select: () => ret, single: () => Promise.resolve({ data: { id: 'x', ...payload }, error: null }),
        then: (f, r) => Promise.resolve({ data: [payload], error: null }).then(f, r) };
      return ret;
    },
    update: () => b,
    then: (f, r) => Promise.resolve({ data: rows, error: null }).then(f, r),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilderFor(t)) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((key) => `https://s3.example/bucket/${key}`),
  getPresignedUrl: jest.fn(async (url) => `${url}?sig`),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendDocumentByLink: jest.fn(async () => ({ messages: [{ id: 'w' }] })),
  sendMessage: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/services/lp-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/coaching/thing-to-try', () => ({
  planCaption: jest.fn(async ({ caption }) => caption), sendsPriorReminder: jest.fn(),
}));
const mockCard = { servedFor: jest.fn() };
jest.mock('../../bot/shared/services/lp-v10-card.service', () => ({ servedFor: (...a) => mockCard.servedFor(...a) }));
const mockLpAb = { groupFor: jest.fn(async () => null) };
jest.mock('../../bot/shared/services/lp-ab-ch310.service', () => {
  const real = jest.requireActual('../../bot/shared/services/lp-ab-ch310.service');
  return { ...real, groupFor: (...a) => mockLpAb.groupFor(...a) };
});

const WA = require('../../bot/shared/services/whatsapp.service');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const Delivery = require('../../bot/shared/services/lp-v8-delivery.service');
const Browse = require('../../bot/shared/services/lp-v8-browse.service');

const LESSON = 'grade_1_english_ch4_seg2';
const CATALOG = {
  catalog_version: 'v8', counts: { books: 1, chapters: 1, lessons: 1 },
  books: [{ stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{ number: 4, title: 'C4', title_short: 'C4', lessons: [{
      lesson_id: LESSON, segment_index: 2, lp_type: 'content', day_label: 'Day 2', section: 'S',
      section_short: 'S', topic: 'T', topic_short: 'T', pages: [1], pages_label: 'p.1',
      row: { title: 'S', description: 'D', metadata: 'M' },
    }] }] }],
};
const V9 = { id: 'a-v9', lesson_id: LESSON, asset_kind: 'lesson', r2_key: 'v9.pdf', content_hash: 'h9',
  version_stamp: 's9', is_current: true, created_at: '2026-10-01' };
const CARD = { id: 'a-card', lesson_id: LESSON, asset_kind: 'card', r2_key: 'card.pdf', content_hash: 'hc',
  version_stamp: 'v10card', is_current: true, created_at: '2026-10-14' };

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

beforeEach(() => {
  jest.clearAllMocks();
  mockInserts.length = 0;
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockTables.users = [{ id: 'u1', phone_number: '923001234567', preferred_language: 'en', school_id: 's1' }];
  mockTables.app_settings = [];
  mockTables.niete_lp_assets = [V9];
  mockCard.servedFor.mockImplementation(async ({ lesson }) => lesson);
  mockLpAb.groupFor.mockResolvedValue(null);
});

const sentUrl = () => WA.sendDocumentByLink.mock.calls[0][1];
const download = () => mockInserts.find((i) => i.table === 'niete_lp_downloads').payload;

describe('WhatsApp plan send', () => {
  test('the card servedFor returns is sent; the download stays on the v9 lesson', async () => {
    mockCard.servedFor.mockResolvedValue(CARD);
    await Delivery.deliverV8Lesson({ userId: 'u1', lessonId: LESSON });
    expect(mockCard.servedFor).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', lessonId: LESSON, lesson: expect.objectContaining({ id: 'a-v9' }), channel: 'whatsapp',
    }));
    expect(sentUrl()).toContain('card.pdf');
    expect(download()).toMatchObject({ asset_id: 'a-v9', version_stamp: 's9', content_hash: 'h9', status: 'sent' });
  });

  test('servedFor hands back the lesson: the v9 PDF, as today', async () => {
    await Delivery.deliverV8Lesson({ userId: 'u1', lessonId: LESSON });
    expect(sentUrl()).toContain('v9.pdf');
  });

  test('servedFor returning nothing falls back to the v9 lesson', async () => {
    mockCard.servedFor.mockResolvedValue(null);
    await Delivery.deliverV8Lesson({ userId: 'u1', lessonId: LESSON });
    expect(sentUrl()).toContain('v9.pdf');
  });
});

describe('app Open (and share)', () => {
  test('lesson: the card URL for a v10 teacher', async () => {
    mockCard.servedFor.mockResolvedValue(CARD);
    const out = await Browse.lessonPdfUrl(LESSON, 'lesson', 'u1');
    expect(out.url).toContain('card.pdf');
    expect(mockCard.servedFor).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', channel: 'app' }));
  });

  test('lesson: the v9 URL otherwise', async () => {
    expect((await Browse.lessonPdfUrl(LESSON, 'lesson', 'u1')).url).toContain('v9.pdf');
  });

  test('answer key: never asks for a card', async () => {
    mockTables.niete_lp_assets = [{ ...V9, id: 'a-key', asset_kind: 'answer_key', r2_key: 'key.pdf' }];
    const out = await Browse.lessonPdfUrl(LESSON, 'answer_key', 'u1');
    expect(out.url).toContain('key.pdf');
    expect(mockCard.servedFor).not.toHaveBeenCalled();
  });
});
