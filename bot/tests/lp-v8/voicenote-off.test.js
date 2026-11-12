/**
 * bd-xxejb / bd-juo829 / bd-hz6ez.12 — the K-5 v8 voice note and the LP Q&A voicenote-script lookup
 * are OFF by default (product decision, 11 Nov 2026). With the code switch off:
 *   - delivering a v8 plan never calls sendVoicenoteFromR2Key,
 *   - getVoicenoteScript never reads R2 (no "script unavailable" log),
 *   - the survey stays PDF-only.
 * Switching it on in code brings the old behaviour back.
 */

const mockTables = { niete_lp_assets: [], niete_lp_downloads: [], users: [], lesson_plans: [] };
const mockInserts = { niete_lp_downloads: [], lesson_plans: [] };

function mockBuilderFor(table) {
  let rows = [...(mockTables[table] || [])];
  const b = {
    select: () => b,
    eq: (col, val) => { rows = rows.filter((r) => String(r[col]) === String(val)); return b; },
    in: (col, vals) => { rows = rows.filter((r) => vals.map(String).includes(String(r[col]))); return b; },
    order: () => b,
    limit: () => Promise.resolve({ data: rows, error: null }),
    range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
    single: () => Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'no rows' } }),
    maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
    insert: (payload) => {
      const arr = Array.isArray(payload) ? payload : [payload];
      for (const p of arr) {
        const row = { id: `${table}-${(mockInserts[table] || []).length + 1}`, ...p };
        (mockInserts[table] = mockInserts[table] || []).push(row);
        mockTables[table] = [...(mockTables[table] || []), row];
      }
      const inserted = (mockInserts[table] || []).slice(-arr.length);
      const ret = {
        select: () => ret,
        single: () => Promise.resolve({ data: inserted[0], error: null }),
        then: (f, r) => Promise.resolve({ data: inserted, error: null }).then(f, r),
      };
      return ret;
    },
    update: () => b,
    then: (f, r) => Promise.resolve({ data: rows, error: null }).then(f, r),
  };
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilderFor(t)) }));

const mockDownloads = [];
jest.mock('../../shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((key) => `https://s3.example/bucket/${key}`),
  getPresignedUrl: jest.fn(async (url) => `${url}?X-Amz-Signature=deadbeef`),
  downloadFromR2: jest.fn(async (key) => { mockDownloads.push(key); return Buffer.from('script'); }),
}));

const mockSends = { docs: [], messages: [], voicenotes: [] };
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendDocumentByLink: jest.fn(async (phone, url, filename, caption) => {
    mockSends.docs.push({ phone, url, filename, caption });
    return { messages: [{ id: 'wamid.X' }] };
  }),
  sendMessage: jest.fn(async (phone, body) => { mockSends.messages.push({ phone, body }); return true; }),
  sendVoicenoteFromR2Key: jest.fn(async (phone, key) => { mockSends.voicenotes.push({ phone, key }); return true; }),
}));

const mockFeedback = { scheduled: [] };
jest.mock('../../shared/services/lp-feedback.service', () => ({
  scheduleFeedbackPrompt: jest.fn((opts) => { mockFeedback.scheduled.push(opts); }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 1 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{
      number: 1, title: 'Hello World!', title_short: 'Hello World!',
      lessons: [{
        lesson_id: 'grade_1_english_ch1_seg3', segment_index: 3, lp_type: 'content',
        day_label: 'Day 3', section: 'Diving Deeper', section_short: 'Diving Deeper',
        topic: 'Introducing Myself', topic_short: 'Introducing Myself',
        pages: [4, 5, 6], pages_label: 'p.4-6',
        row: { title: 'Diving Deeper', description: 'Day 3', metadata: 'Introducing Myself · p.4-6' },
      }],
    }],
  }],
};

const V8Catalog = require('../../shared/services/lp-v8-catalog.service');
const Delivery = require('../../shared/services/lp-v8-delivery.service');

const ASSET = {
  id: 'asset-1',
  lesson_id: 'grade_1_english_ch1_seg3',
  asset_kind: 'lesson',
  catalog_version: 'v8',
  r2_key: 'lp-cache/v8/grade_1_english_ch1_seg3/aabbccddeeff.pdf',
  content_hash: 'aabbccddeeff',
  version_stamp: 'v8-20260816T1650',
  is_current: true,
};
const USER = { id: 'user-1', phone_number: '923001234567', preferred_language: 'ur' };


const Switch = require('../../shared/config/lp-v8-voicenote');
beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => { V8Catalog.__setCatalogForTests(null); Switch.__setForTests(false); });

beforeEach(() => {
  for (const k of Object.keys(mockTables)) mockTables[k] = [];
  for (const k of Object.keys(mockInserts)) mockInserts[k] = [];
  mockSends.docs = []; mockSends.messages = []; mockSends.voicenotes = [];
  mockFeedback.scheduled = []; mockDownloads.length = 0;
  mockTables.users = [USER];
  mockTables.niete_lp_assets = [ASSET];
  Switch.__setForTests(false);
});

const deliver = () => Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });

describe('v8 voicenote OFF by default', () => {
  test('delivery sends the PDF but never the voice note, survey is PDF-only', async () => {
    const res = await deliver();
    expect(res.ok).toBe(true);
    expect(mockSends.docs).toHaveLength(1);
    expect(mockSends.voicenotes).toHaveLength(0);
    expect(mockFeedback.scheduled[0].context.triggerMode).toBe('after_pdf_only');
  });

  test('getVoicenoteScript does not touch R2', async () => {
    const { getVoicenoteScript } = require('../../shared/services/lp-voicenote-script.service');
    expect(await getVoicenoteScript({ r2_key: ASSET.r2_key })).toBeNull();
    expect(mockDownloads).toHaveLength(0);
  });

  test('flag on restores the voice note', async () => {
    Switch.__setForTests(true);
    await deliver();
    expect(mockSends.voicenotes).toHaveLength(1);
  });
});
