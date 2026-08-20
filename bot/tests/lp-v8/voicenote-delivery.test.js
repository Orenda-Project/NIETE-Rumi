/**
 * FEAT-059 / bd-vw0aj — v8 voicenote delivery + the survey it gates (TDD, red first).
 *
 * The teacher gets the lesson PDF, then ~1s later the voice note as a WhatsApp VOICE MESSAGE
 * (waveform + speed control), then the survey — and the survey only asks about the voice note
 * when a voice note actually arrived.
 *
 * The failure modes this locks down are ones this deployment has already paid for elsewhere:
 *   - a voicenote failure must NEVER cost the teacher her PDF or her survey (soft-fail, the
 *     Rawalpindi Phase-5B rule);
 *   - the survey must not claim a voice note that never sent — Rawalpindi schedules the survey off
 *     the PDF on a fixed timer and can put it AHEAD of the audio;
 *   - the voicenote key is the LP key with .ogg, so a re-rendered LP (new content_hash) silently
 *     has no voicenote rather than a stale one describing a lesson that changed.
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

jest.mock('../../shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((key) => `https://s3.example/bucket/${key}`),
  getPresignedUrl: jest.fn(async (url) => `${url}?X-Amz-Signature=deadbeef`),
}));

const mockSends = { docs: [], messages: [], voicenotes: [] };
let mockVoicenoteResult = true;              // what sendVoicenoteFromR2Key resolves to
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendDocumentByLink: jest.fn(async (phone, url, filename, caption) => {
    mockSends.docs.push({ phone, url, filename, caption });
    return { messages: [{ id: 'wamid.X' }] };
  }),
  sendMessage: jest.fn(async (phone, body) => { mockSends.messages.push({ phone, body }); return true; }),
  sendVoicenoteFromR2Key: jest.fn(async (phone, key) => {
    mockSends.voicenotes.push({ phone, key });
    if (mockVoicenoteResult instanceof Error) throw mockVoicenoteResult;
    return mockVoicenoteResult;
  }),
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

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

beforeEach(() => {
  for (const k of Object.keys(mockTables)) mockTables[k] = [];
  for (const k of Object.keys(mockInserts)) mockInserts[k] = [];
  mockSends.docs = []; mockSends.messages = []; mockSends.voicenotes = [];
  mockFeedback.scheduled = [];
  mockVoicenoteResult = true;
  mockTables.users = [USER];
  mockTables.niete_lp_assets = [ASSET];
});

const deliver = () => Delivery.deliverV8Lesson({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg3' });

describe('v8 voicenote — delivery', () => {
  test('sends the voice note at the LP key with .ogg, after the PDF', async () => {
    await deliver();

    expect(mockSends.docs).toHaveLength(1);
    expect(mockSends.voicenotes).toHaveLength(1);
    // Convention path: same stem as the PDF, so it is bound to THIS content_hash.
    expect(mockSends.voicenotes[0].key)
      .toBe('lp-cache/v8/grade_1_english_ch1_seg3/aabbccddeeff.ogg');
    expect(mockSends.voicenotes[0].phone).toBe('923001234567');
  });

  test('a voicenote failure never costs the teacher her PDF or her survey', async () => {
    mockVoicenoteResult = new Error('R2 down');

    const res = await deliver();

    expect(res.ok).toBe(true);                       // the PDF is the deliverable
    expect(mockSends.docs).toHaveLength(1);
    expect(mockFeedback.scheduled).toHaveLength(1);  // survey still fires
  });
});

describe('v8 voicenote — the survey it gates', () => {
  test('a delivered voicenote makes the survey ask about BOTH artefacts', async () => {
    await deliver();

    expect(mockFeedback.scheduled).toHaveLength(1);
    expect(mockFeedback.scheduled[0].context.triggerMode).toBe('after_voice_note');
  });

  test('no voicenote sent → survey must NOT claim one', async () => {
    mockVoicenoteResult = false;                     // e.g. no .ogg uploaded for this version

    await deliver();

    expect(mockFeedback.scheduled[0].context.triggerMode).toBe('after_pdf_only');
  });

  test('a voicenote that THREW also leaves the survey PDF-only', async () => {
    mockVoicenoteResult = new Error('upload rejected');

    await deliver();

    expect(mockFeedback.scheduled[0].context.triggerMode).toBe('after_pdf_only');
  });

  test('the lesson_plans row records the same trigger_mode the survey was given', async () => {
    await deliver();

    const lp = mockInserts.lesson_plans[0];
    expect(lp.content.trigger_mode).toBe('after_voice_note');
  });
});
