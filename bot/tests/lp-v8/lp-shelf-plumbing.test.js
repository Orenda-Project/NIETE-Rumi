/**
 * FEAT-059 / bd-njn7u Phase 1 — make the LP shelf real (TDD, red first).
 *
 * The shelf is the "what was this teacher recently given" record that LP Q&A
 * (Phase 2) reads. Until now lp-shelf.service.js was ported but DEAD — nothing
 * pushed to it. Phase 1 wires it up with zero user-visible behaviour change:
 *
 *   1. deliverV8Lesson pushes an entry (keys, not content) after the voicenote
 *      send resolves — so the entry can say whether she actually heard audio.
 *   2. A voicenote-script reader resolves <r2_key with .txt> fresh at question
 *      time, cached 5 min in-process.
 *   3. flushShelf actually works. The ported service calls redis.del(), but
 *      NIETE's railway-redis wrapper only exposes delete() — the parent bot's
 *      wrapper has del(), NIETE's never did. Every flush since the port has
 *      thrown and been swallowed by callers' try/catch. Code ported without
 *      its dependency, the classic NIETE failure mode.
 *
 * Shelf-entry contract (QA_BUILD_PLAN v2.1 §1.1): lesson_id, grade, subject,
 * subject_label, chapter_number, chapter_title, topic, pages_label, r2_key,
 * content_hash, version_stamp, voicenote_sent, lesson_plan_id, delivered_at.
 * content is NEVER stored — the .txt and the moves resolve fresh by these keys.
 */

/* eslint-disable global-require */

// ─── shared mocks ───────────────────────────────────────────────────────────

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

let mockDownloadResult;               // Buffer | Error — what downloadFromR2 does
const mockDownloadCalls = [];
jest.mock('../../shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((key) => `https://s3.example/bucket/${key}`),
  getPresignedUrl: jest.fn(async (url) => `${url}?X-Amz-Signature=deadbeef`),
  downloadFromR2: jest.fn(async (key) => {
    mockDownloadCalls.push(key);
    if (mockDownloadResult instanceof Error) throw mockDownloadResult;
    return mockDownloadResult;
  }),
}));

let mockVoicenoteResult = true;
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendDocumentByLink: jest.fn(async () => ({ messages: [{ id: 'wamid.doc' }] })),
  sendMessage: jest.fn(async () => true),
  sendVoicenoteFromR2Key: jest.fn(async () => mockVoicenoteResult),
}));

jest.mock('../../shared/services/lp-feedback.service', () => ({
  scheduleFeedbackPrompt: jest.fn(() => {}),
}));

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

// The REAL NIETE railway-redis surface: set/get/expire/delete — and NO del().
// An in-memory store so shelf round-trips behave like the live wrapper
// (set serialises, get parses).
const redisStore = new Map();
const mockRedis = {
  set: jest.fn(async (key, value) => { redisStore.set(key, JSON.stringify(value)); return true; }),
  get: jest.fn(async (key) => {
    const raw = redisStore.get(key);
    if (raw === undefined) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  }),
  expire: jest.fn(async () => true),
  delete: jest.fn(async (key) => { redisStore.delete(key); return true; }),
};
jest.mock('../../shared/services/cache/railway-redis.service', () => mockRedis);

let mockShelfPushError = null;
const mockShelfPushes = [];
jest.mock('../../shared/services/lp-shelf.service', () => ({
  pushToShelf: jest.fn(async (userId, entry) => {
    if (mockShelfPushError) throw mockShelfPushError;
    mockShelfPushes.push({ userId, entry });
  }),
  flushShelf: jest.fn(async () => {}),
  getShelf: jest.fn(async () => []),
}));

const V8Delivery = require('../../shared/services/lp-v8-delivery.service');
const LpFeedback = require('../../shared/services/lp-feedback.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const MockedShelf = require('../../shared/services/lp-shelf.service');

// One deliverable lesson, mirroring delivery.test.js's fixture idiom.
const V8Catalog = require('../../shared/services/lp-v8-catalog.service');
const LESSON_ID = 'grade_1_english_ch1_seg1';
const ASSET = {
  id: 'asset-1',
  lesson_id: LESSON_ID,
  asset_kind: 'lesson',
  r2_key: `lp-cache/v8/${LESSON_ID}/cafebabe1234.pdf`,
  content_hash: 'cafebabe1234',
  version_stamp: 'v8.2026-08-19',
  is_current: true,
};

function seedHappyPath() {
  mockTables.users = [{ id: 'user-1', phone_number: '923001234567', preferred_language: 'ur' }];
  mockTables.niete_lp_assets = [ASSET];
}

let catalogSpy;

beforeAll(() => {
  const hit = V8Catalog.lessonById && V8Catalog.lessonById(LESSON_ID);
  const fixture = {
    lesson: {
      lesson_id: LESSON_ID, segment_index: 1, day_label: 'Day 1',
      topic: 'Greetings and introductions', topic_short: 'Greetings',
      pages_label: 'p. 4–5', section: 'A', pages: [4, 5], lp_type: 'lesson',
      row: { title: 'Hello!' },
    },
    chapter: { number: 1, title: 'Hello!' },
    book: { grade: 1, subject: 'English', subject_key: 'english' },
  };
  // Use the real catalog when it can resolve the id (keeps the test honest on
  // shipped corpora) and the fixture when the catalog file isn't packaged.
  if (!hit) {
    catalogSpy = jest.spyOn(V8Catalog, 'lessonById').mockReturnValue(fixture);
  }
});

beforeEach(() => {
  mockTables.niete_lp_assets = [];
  mockTables.niete_lp_downloads = [];
  mockTables.users = [];
  mockTables.lesson_plans = [];
  mockInserts.niete_lp_downloads = [];
  mockInserts.lesson_plans = [];
  mockShelfPushes.length = 0;
  mockShelfPushError = null;
  mockVoicenoteResult = true;
  mockDownloadResult = Buffer.from('یہ سبق سلام اور تعارف کے بارے میں ہے۔');
  mockDownloadCalls.length = 0;
  redisStore.clear();
  jest.clearAllMocks();
});

// ─── 1.1 push at delivery ───────────────────────────────────────────────────

describe('Phase 1.1 — deliverV8Lesson pushes a shelf entry', () => {
  test('successful delivery pushes ONE entry carrying the exact-version keys', async () => {
    seedHappyPath();
    const res = await V8Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: LESSON_ID });
    expect(res.ok).toBe(true);

    expect(mockShelfPushes).toHaveLength(1);
    const { userId, entry } = mockShelfPushes[0];
    expect(userId).toBe('user-1');
    expect(entry).toMatchObject({
      lesson_id: LESSON_ID,
      grade: 1,
      subject: 'english',
      chapter_number: 1,
      content_hash: 'cafebabe1234',
      version_stamp: 'v8.2026-08-19',
      r2_key: ASSET.r2_key,
      voicenote_sent: true,
    });
    expect(entry.chapter_title).toBeTruthy();
    expect(entry.topic).toBeTruthy();
    expect(entry.delivered_at).toBeTruthy();
    // The lesson_plans row id is what lp_feedback hangs off — the shelf carries
    // it so Q&A telemetry and the survey can be joined later.
    expect(entry.lesson_plan_id).toBe(mockInserts.lesson_plans[0].id);
    // Keys, not content: the entry must never embed the voicenote text.
    expect(JSON.stringify(entry)).not.toContain('سلام اور تعارف');
  });

  test('voicenote failure → entry says voicenote_sent:false (she never heard audio)', async () => {
    seedHappyPath();
    mockVoicenoteResult = false;
    const res = await V8Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: LESSON_ID });
    expect(res.ok).toBe(true);
    expect(mockShelfPushes).toHaveLength(1);
    expect(mockShelfPushes[0].entry.voicenote_sent).toBe(false);
  });

  test('shelf push failure NEVER breaks delivery or the survey', async () => {
    seedHappyPath();
    mockShelfPushError = new Error('redis down');
    const res = await V8Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: LESSON_ID });
    expect(res.ok).toBe(true);
    expect(MockedShelf.pushToShelf).toHaveBeenCalled();
    expect(LpFeedback.scheduleFeedbackPrompt).toHaveBeenCalled();
  });

  test('failed PDF send → nothing reaches the shelf (she has no lesson to ask about)', async () => {
    seedHappyPath();
    WhatsAppService.sendDocumentByLink.mockResolvedValueOnce(null);
    const res = await V8Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: LESSON_ID });
    expect(res.ok).toBe(false);
    expect(mockShelfPushes).toHaveLength(0);
  });
});

// ─── 1.2 voicenote-script reader ────────────────────────────────────────────

describe('Phase 1.2 — voicenote script reader (R2 .txt beside the .ogg)', () => {
  test('resolves the .txt derived from the lesson r2_key and returns its text', async () => {
    const Reader = require('../../shared/services/lp-voicenote-script.service');
    const text = await Reader.getVoicenoteScript({ r2_key: ASSET.r2_key, content_hash: ASSET.content_hash });
    expect(text).toContain('سلام اور تعارف');
    expect(mockDownloadCalls).toEqual([`lp-cache/v8/${LESSON_ID}/cafebabe1234.txt`]);
  });

  test('missing script → null, never a throw (Q&A must degrade, not die)', async () => {
    const Reader = require('../../shared/services/lp-voicenote-script.service');
    mockDownloadResult = new Error('NoSuchKey');
    // A key of its own: the reader's in-process cache is keyed by txt path, and
    // a hit from the previous test would mask the miss this test is about.
    const text = await Reader.getVoicenoteScript({ r2_key: `lp-cache/v8/${LESSON_ID}/deadbeef9999.pdf`, content_hash: 'deadbeef9999' });
    expect(text).toBeNull();
  });

  test('second read inside the cache window never re-fetches from R2', async () => {
    const Reader = require('../../shared/services/lp-voicenote-script.service');
    // A key of its own so the first test's cache entry can't satisfy it.
    const key = { r2_key: `lp-cache/v8/${LESSON_ID}/feedf00d5678.pdf`, content_hash: 'feedf00d5678' };
    const first = await Reader.getVoicenoteScript(key);
    const callsAfterFirst = mockDownloadCalls.length;
    const second = await Reader.getVoicenoteScript(key);
    expect(second).toBe(first);
    expect(mockDownloadCalls.length).toBe(callsAfterFirst);
  });

  test('non-.pdf r2_key (nothing to derive) → null, no R2 call', async () => {
    const Reader = require('../../shared/services/lp-voicenote-script.service');
    const text = await Reader.getVoicenoteScript({ r2_key: 'lp-cache/v8/x/weird.bin', content_hash: 'x' });
    expect(text).toBeNull();
    expect(mockDownloadCalls).toHaveLength(0);
  });
});

// ─── 1.3 the flush actually flushes ─────────────────────────────────────────

describe('Phase 1.3 — flushShelf works against the REAL NIETE redis surface', () => {
  // The mocked wrapper above exposes exactly what railway-redis.service.js
  // exposes: delete(), not del(). The ported shelf calls del() — red until fixed.
  let RealShelf;
  beforeAll(() => {
    jest.unmock('../../shared/services/lp-shelf.service');
    jest.resetModules();
    RealShelf = require('../../shared/services/lp-shelf.service');
  });

  test('flushShelf deletes the shelf key instead of throwing', async () => {
    await RealShelf.pushToShelf('user-9', { lesson_id: 'l1', delivered_at: 'now' });
    expect(await RealShelf.getShelf('user-9')).toHaveLength(1);
    await expect(RealShelf.flushShelf('user-9')).resolves.not.toThrow();
    expect(mockRedis.delete).toHaveBeenCalledWith('lp_shelf:user-9');
    expect(await RealShelf.getShelf('user-9')).toHaveLength(0);
  });

  test('cap-5 FIFO holds: sixth push evicts the oldest', async () => {
    for (let i = 1; i <= 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await RealShelf.pushToShelf('user-9', { lesson_id: `l${i}`, delivered_at: `t${i}` });
    }
    const shelf = await RealShelf.getShelf('user-9');
    expect(shelf.map((e) => e.lesson_id)).toEqual(['l2', 'l3', 'l4', 'l5', 'l6']);
  });
});
