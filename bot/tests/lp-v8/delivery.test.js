/**
 * FEAT-059 / bd-fg3p4 + bd-zc9k7 — v8 delivery service (TDD, red first).
 *
 * Mocks Supabase / R2 / WhatsApp / lp-feedback so the whole delivery path runs
 * without a network. The cases that matter are the ones that have actually gone
 * wrong on this deployment before: the raw-vs-presigned R2 URL (bd-2054), and a
 * failed send leaving no row at all (bd-2407).
 */

// ─── Mocks (order-sensitive: mock BEFORE require) ─────────────────────────

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
    // The id-set readers page with .range() because PostgREST caps responses at
    // db-max-rows (1000 live) and truncates without an error — see
    // tests/lp-v8/live-schema-limits.test.js.
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

const mockR2 = { presignCalls: [], publicCalls: [] };
jest.mock('../../shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((key) => { mockR2.publicCalls.push(key); return `https://s3.example/bucket/${key}`; }),
  getPresignedUrl: jest.fn(async (url) => { mockR2.presignCalls.push(url); return `${url}?X-Amz-Signature=deadbeef`; }),
}));

const mockSends = { docs: [], messages: [] };
let mockSendResult = { messages: [{ id: 'wamid.X' }] };
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendDocumentByLink: jest.fn(async (phone, url, filename, caption) => {
    mockSends.docs.push({ phone, url, filename, caption });
    if (mockSendResult instanceof Error) throw mockSendResult;
    return mockSendResult;
  }),
  sendMessage: jest.fn(async (phone, body) => { mockSends.messages.push({ phone, body }); return true; }),
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
  catalog_version: 'v8',   // NOT NULL DEFAULT 'v8' in migration 018
  r2_key: 'lp-cache/v8/grade_1_english_ch1_seg3/aabbccddeeff.pdf',
  content_hash: 'aabbccddeeff',
  version_stamp: 'v8-20260816T1650',
  is_current: true,
};
const USER = { id: 'user-1', phone_number: '923001234567', preferred_language: 'en' };

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

beforeEach(() => {
  for (const k of Object.keys(mockTables)) mockTables[k] = [];
  for (const k of Object.keys(mockInserts)) mockInserts[k] = [];
  mockR2.presignCalls = []; mockR2.publicCalls = [];
  mockSends.docs = []; mockSends.messages = [];
  mockFeedback.scheduled = [];
  mockSendResult = { messages: [{ id: 'wamid.X' }] };
  mockTables.users = [USER];
  mockTables.niete_lp_assets = [ASSET];
});

describe('deliverV8Lesson — happy path', () => {
  test('sends the PDF and records a sent row', async () => {
    const res = await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    expect(res.ok).toBe(true);
    expect(mockSends.docs).toHaveLength(1);

    const row = mockInserts.niete_lp_downloads[0];
    expect(row.status).toBe('sent');
    expect(row.lesson_id).toBe('grade_1_english_ch1_seg3');
    expect(row.asset_id).toBe('asset-1');
    expect(row.version_stamp).toBe('v8-20260816T1650');
    expect(row.content_hash).toBe('aabbccddeeff');
    expect(row.grade).toBe(1);
    expect(row.subject).toBe('english');
    expect(row.chapter_number).toBe(1);
    expect(row.segment_index).toBe(3);
  });

  test('delivers via a PRESIGNED url — never the raw R2 public url (bd-2054 guard)', async () => {
    // buildR2PublicUrl returns the S3-endpoint URL, which is NOT anonymously
    // fetchable: Meta gets HTTP 400 and the send fails silently. It must always
    // be wrapped in getPresignedUrl.
    await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    expect(mockR2.presignCalls).toHaveLength(1);
    expect(mockSends.docs[0].url).toContain('X-Amz-Signature');
    expect(mockSends.docs[0].url).not.toBe('https://s3.example/bucket/lp-cache/v8/grade_1_english_ch1_seg3/aabbccddeeff.pdf');
  });

  test('the filename names the lesson, not the hash', async () => {
    await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    const { filename } = mockSends.docs[0];
    expect(filename).toMatch(/\.pdf$/);
    expect(filename).toContain('Day 3');
    expect(filename).not.toContain('aabbccddeeff');
    expect(filename).not.toMatch(/[<>:"/\\|?*]/);
    expect(filename.length).toBeLessThanOrEqual(64);
  });

  test('schedules the feedback quiz with the v8 variant, pdf-only', async () => {
    await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    expect(mockFeedback.scheduled).toHaveLength(1);
    const s = mockFeedback.scheduled[0];
    expect(s.userId).toBe('user-1');
    expect(s.phone).toBe('923001234567');
    expect(s.lessonPlanId).toBeTruthy();
    // Voicenotes are not live for NIETE — the quiz asks about the LP only,
    // but the shape is ready for the voicenote follow-up.
    expect(s.context.lpVariant).toBe('niete_v8_segment');
    expect(s.context.triggerMode).toBe('after_pdf_only');
  });

  test('writes a lesson_plans row using ONLY base-schema columns', async () => {
    // The live NIETE schema could not be read from the build environment, and
    // bot/database/schema.sql shows lesson_plans in its original 11-column form.
    // Nothing here may depend on a column migration 018 does not create.
    await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    const lp = mockInserts.lesson_plans[0];
    expect(Object.keys(lp).sort()).toEqual(['content', 'grade', 'id', 'subject', 'topic', 'type', 'user_id']);
    expect(lp.content.v8.lesson_id).toBe('grade_1_english_ch1_seg3');
    expect(lp.content.v8.content_hash).toBe('aabbccddeeff');
    expect(lp.content.v8.r2_key).toBe(ASSET.r2_key);
  });
});

describe('deliverV8Lesson — failure paths', () => {
  test('a send failure records a FAILED row and schedules no feedback', async () => {
    mockSendResult = new Error('Meta 400');
    const res = await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    expect(res.ok).toBe(false);
    const row = mockInserts.niete_lp_downloads[0];
    expect(row.status).toBe('failed');
    expect(row.error_text).toContain('Meta 400');
    expect(mockFeedback.scheduled).toEqual([]);
  });

  test('a falsy send response is a failure, not a success', async () => {
    mockSendResult = false;
    const res = await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    expect(res.ok).toBe(false);
    expect(mockInserts.niete_lp_downloads[0].status).toBe('failed');
  });

  test('a failed delivery still tells the teacher something — never silence', async () => {
    mockSendResult = new Error('Meta 400');
    await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    expect(mockSends.messages.length).toBeGreaterThan(0);
    expect(mockSends.messages[mockSends.messages.length - 1].phone).toBe('923001234567');
  });

  test('no phone on file → failed row, no throw', async () => {
    mockTables.users = [];
    const res = await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    expect(res.ok).toBe(false);
    expect(mockInserts.niete_lp_downloads[0].status).toBe('failed');
    expect(mockSends.docs).toEqual([]);
  });

  test('no current asset → nothing is sent and nothing is invented', async () => {
    mockTables.niete_lp_assets = [];
    const res = await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no.*asset/i);
    expect(mockSends.docs).toEqual([]);
  });

  test('a lesson_id the catalog does not know is refused', async () => {
    const res = await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'not_a_lesson' });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/unknown lesson/i);
    expect(mockSends.docs).toEqual([]);
  });
});

describe('availability + tick lookups', () => {
  test('availableLessonIds returns only is_current assets', async () => {
    mockTables.niete_lp_assets = [
      ASSET,
      { ...ASSET, id: 'asset-old', content_hash: 'old', is_current: false },
      { ...ASSET, id: 'asset-2', lesson_id: 'grade_1_english_ch1_seg4', is_current: true },
    ];
    const set = await Delivery.availableLessonIds();
    expect([...set].sort()).toEqual(['grade_1_english_ch1_seg3', 'grade_1_english_ch1_seg4']);
  });

  test('downloadedLessonIds only counts SENT rows, any version', async () => {
    mockTables.niete_lp_downloads = [
      { user_id: 'user-1', lesson_id: 'a', status: 'sent' },
      { user_id: 'user-1', lesson_id: 'b', status: 'failed' },
      { user_id: 'user-2', lesson_id: 'c', status: 'sent' },
    ];
    const set = await Delivery.downloadedLessonIds('user-1');
    expect([...set]).toEqual(['a']);
  });

  test('an empty download history is an empty set, not a throw', async () => {
    expect([...(await Delivery.downloadedLessonIds('nobody'))]).toEqual([]);
  });
});

describe('feedback round-trip — the lesson_plans.content contract (bd-zc9k7)', () => {
  // lp-feedback.service.handleFeedbackButton snapshots context off
  // lesson_plans.content at the TOP level (meta.chapter_number, meta.grade,
  // meta.lp_variant, …). If the v8 delivery only nests them under content.v8,
  // every v8 feedback row lands with NULLs — a wiring gap that no amount of
  // "the service is ported" would have caught.
  const TOP_LEVEL_KEYS = ['chapter_number', 'segment_number', 'lp_variant', 'grade', 'subject'];

  test('content carries the keys the feedback reader actually reads', async () => {
    await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    const { content } = mockInserts.lesson_plans[0];
    for (const k of TOP_LEVEL_KEYS) {
      expect(content).toHaveProperty(k);
      expect(content[k]).not.toBeNull();
    }
    expect(content.chapter_number).toBe(1);
    expect(content.segment_number).toBe(3);
    expect(content.lp_variant).toBe('niete_v8_segment');
    expect(content.grade).toBe(1);
    expect(content.subject).toBe('english');
  });

  test('the v8 detail block is still there for provenance', async () => {
    await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    const { content } = mockInserts.lesson_plans[0];
    expect(content.v8.lesson_id).toBe('grade_1_english_ch1_seg3');
    expect(content.v8.content_hash).toBe('aabbccddeeff');
  });

  test('trigger_mode is after_pdf_only — voicenotes are not live for NIETE', async () => {
    await Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });
    expect(mockInserts.lesson_plans[0].content.trigger_mode).toBe('after_pdf_only');
  });
});
