'use strict';
/**
 * Grades 1-5 catalogue plan (deliverV8Lesson), reached from a Flow tap already made: with her programme on
 * lp_whatsapp_pdf_off the PDF is not sent — the app link goes instead, with no "preparing" line, no download row and
 * no survey. Anyone else (no row, a malformed value, the other programme listed) gets exactly today's PDF.
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
jest.mock('../../bot/shared/services/lp-v10-card.service', () => ({ servedFor: jest.fn(async ({ lesson }) => lesson) }));
jest.mock('../../bot/shared/services/lp-ab-ch310.service', () => {
  const real = jest.requireActual('../../bot/shared/services/lp-ab-ch310.service');
  return { ...real, groupFor: jest.fn(async () => null) };
});
jest.mock('../../bot/shared/services/lp-whatsapp-off', () => require('../fixtures/lp-whatsapp-off-fake').module);
const mockLink = jest.fn();
jest.mock('../../bot/shared/services/app-redirect.service', () => ({ sendLessonPlanLink: (...a) => mockLink(...a) }));

const Fake = require('../fixtures/lp-whatsapp-off-fake');
const WA = require('../../bot/shared/services/whatsapp.service');
const LpFeedback = require('../../bot/shared/services/lp-feedback.service');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const Delivery = require('../../bot/shared/services/lp-v8-delivery.service');

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
const PHONE = '920000000001';

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

beforeEach(() => {
  jest.clearAllMocks();
  Fake.reset();
  mockLink.mockReset().mockResolvedValue(true);
  mockInserts.length = 0;
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockTables.users = [Fake.ICT_TEACHER, Fake.GB_TEACHER].map((id) => ({ id, phone_number: PHONE, preferred_language: 'ur' }));
  mockTables.niete_lp_assets = [V9];
});

describe.each(Fake.PER_TEACHER)('lp_whatsapp_pdf_off %s (%j), %s teacher', (_label, value, _who, userId, off) => {
  test(off ? 'no PDF: the app link, no download row, no survey' : 'today: the PDF goes', async () => {
    Fake.setPdfOff(value);
    const res = await Delivery.deliverV8Lesson({ userId, lessonId: LESSON });
    if (off) {
      expect(WA.sendDocumentByLink).not.toHaveBeenCalled();
      expect(WA.sendMessage).not.toHaveBeenCalled();
      expect(mockLink).toHaveBeenCalledWith(expect.objectContaining({ userId, from: PHONE, language: 'ur', plan: `k5:${LESSON}` }));
      expect(mockInserts.find((i) => i.table === 'niete_lp_downloads')).toBeUndefined();
      expect(LpFeedback.scheduleFeedbackPrompt).not.toHaveBeenCalled();
      expect(res).toEqual(expect.objectContaining({ ok: true, appLink: true }));
    } else {
      expect(mockLink).not.toHaveBeenCalled();
      expect(WA.sendDocumentByLink).toHaveBeenCalledTimes(1);
      expect(res.ok).toBe(true);
    }
  });
});

test('off, and the link could not go: still no PDF; not ok, so the Flow lets her next tap through', async () => {
  Fake.setPdfOff(['ict']);
  mockLink.mockResolvedValue(false);
  const res = await Delivery.deliverV8Lesson({ userId: Fake.ICT_TEACHER, lessonId: LESSON });
  expect(WA.sendDocumentByLink).not.toHaveBeenCalled();
  expect(res).toEqual(expect.objectContaining({ ok: false, appLink: false }));
});
