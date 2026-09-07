/**
 * bd-oak77.27 — the endpoint's OWN reads must not be row-count-dependent either.
 *
 * `lp612-catalog.service.js` is not the only place the Flow endpoint reads a set
 * and reduces it in JS. Two fallback corpora do exactly the same thing:
 *
 *   fetchPakistanRows   -> `pre_generated_lps` -> distinct(subject) / distinct(chapter_title)
 *   fetchOxbridgeRows   -> `lesson_plan_catalog` -> distinct(subject) / distinct(chapter_title)
 *
 * Both then filter and de-duplicate the returned rows in JS, so a read truncated
 * at the server's `db-max-rows` (1000 — MEASURED on both refs 2026-09-07) does
 * not error; it produces a subject or chapter list that is quietly missing rows.
 *
 * Live sizes today are small (`pre_generated_lps` pakistan/current = 304 rows,
 * `lesson_plan_catalog` oxbridge/active = 70), which is exactly the position
 * `buildSubjectItems` was in when the lane was built against three books. The
 * fix is the shape of the query, not the current size of the table.
 *
 * These fallbacks are what a teacher gets when `LP_612_ENABLED` is off — the
 * rollback lever in the go package — so they must be correct at any corpus size.
 */

const POSTGREST_MAX_ROWS = 1000; // MEASURED on ihzciabopbttygxxgrkm and rpqkekcfvumypldbejhp

jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({
  buildGradeItems: jest.fn().mockResolvedValue([]),
  buildSubjectItems: jest.fn().mockResolvedValue([]),
  buildChapterItems: jest.fn().mockResolvedValue({ items: [], hasMore: false, total: 0, page: 1 }),
  buildSegmentItems: jest.fn().mockResolvedValue({ items: [], hasMore: false, total: 0, page: 1 }),
}));
jest.mock('../../bot/shared/services/lp612-serving.service', () => ({ requestLesson: jest.fn() }));
jest.mock('../../bot/shared/services/oxbridge-lp.service', () => ({
  gradeWord: (g) => `Grade ${g}`, deliverOxbridgeLp: jest.fn(),
}));
jest.mock('../../bot/shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: jest.fn().mockResolvedValue(new Set()),
  downloadedLessonIds: jest.fn().mockResolvedValue(new Set()),
  deliverV8Lesson: jest.fn(),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendDocumentByLink: jest.fn(),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: (k) => k, getPresignedUrl: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const tables = { pre_generated_lps: [], lesson_plan_catalog: [] };
const seen = [];

function mockBuilder(table) {
  const state = { table, filters: [], limit: null, ranges: [] };
  const rowsNow = () => {
    let rows = tables[table] || [];
    for (const [c, v] of state.filters) rows = rows.filter((r) => String(r[c]) === String(v));
    return rows;
  };
  const settle = (from, to) => {
    seen.push({ ...state, ranges: [...state.ranges] });
    const rows = rowsNow();
    const start = from == null ? 0 : from;
    const askedEnd = to == null ? Infinity : to;
    // The server's ceiling, applied silently and with no error — the defect.
    const end = Math.min(askedEnd, start + POSTGREST_MAX_ROWS - 1);
    return { data: rows.slice(start, end + 1), error: null };
  };
  const one = () => Promise.resolve({
    data: { phone_number: '923001234567', preferred_language: 'en' }, error: null,
  });
  const b = {
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    in: () => b,
    or: () => b,
    order: () => b,
    limit: (n) => { state.limit = n; return b; },
    range: (from, to) => {
      state.ranges.push([from, to]);
      return { then: (res, rej) => Promise.resolve(settle(from, to)).then(res, rej) };
    },
    single: one,
    maybeSingle: one,
    then: (res, rej) => Promise.resolve(settle(null, null)).then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));

const Endpoint = require('../../bot/shared/routes/pakistan-lp-endpoint');

beforeEach(() => {
  jest.clearAllMocks();
  seen.length = 0;
  tables.pre_generated_lps = [];
  tables.lesson_plan_catalog = [];
  delete process.env.LP_612_ENABLED;
  delete process.env.LP_612_ROUTE_ALL;
});

// ── the Oxbridge fallback (grades 6-10 with no 6-12 segments) ───────────────

describe('fetchOxbridgeRows past the cap', () => {
  test('a subject whose rows sit past the cap is still offered', async () => {
    tables.lesson_plan_catalog = [
      ...Array.from({ length: 1000 }, (_, i) => ({
        id: `a${i}`, source: 'oxbridge', is_active: true,
        grade: 'Grade 9', subject: 'Physics', chapter_title: `Ch ${i}`,
      })),
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `b${i}`, source: 'oxbridge', is_active: true,
        grade: 'Grade 9', subject: 'Biology', chapter_title: `Bio ${i}`,
      })),
    ];
    const res = await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_GRADE', {
      step: 'grade', grade: '9',
    });
    expect(res.data.subjects.map((s) => s.id)).toEqual(['Biology', 'Physics']);
  });

  test('no read of the catalog table is an unbounded scan', async () => {
    tables.lesson_plan_catalog = [{
      id: 'a', source: 'oxbridge', is_active: true,
      grade: 'Grade 9', subject: 'Physics', chapter_title: 'One',
    }];
    await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_GRADE', { step: 'grade', grade: '9' });
    const reads = seen.filter((q) => q.table === 'lesson_plan_catalog');
    expect(reads.length).toBeGreaterThan(0);
    for (const q of reads) expect(q.limit != null || q.ranges.length > 0).toBe(true);
  });
});

// ── the K-5 legacy corpus (grades 1-5, no v8 assets) ────────────────────────

describe('fetchPakistanRows past the cap', () => {
  test('a subject whose rows sit past the cap is still offered', async () => {
    const row = (i, subject) => ({
      id: `p${subject}${i}`, curriculum: 'pakistan', is_current: true,
      grade: 3, subject, chapter_number: i, chapter_title: `Ch ${i}`,
      pdf_r2_key_en: 'k.pdf', pdf_r2_key_ur: null, generation_status: 'completed',
    });
    tables.pre_generated_lps = [
      ...Array.from({ length: 1000 }, (_, i) => row(i, 'Urdu')),
      ...Array.from({ length: 40 }, (_, i) => row(i, 'Maths')),
    ];
    const res = await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_GRADE', {
      step: 'grade', grade: '3',
    });
    expect(res.data.subjects.map((s) => s.id)).toEqual(['Maths', 'Urdu']);
  });

  test('no read of the pre-gen table is an unbounded scan', async () => {
    tables.pre_generated_lps = [{
      id: 'p1', curriculum: 'pakistan', is_current: true,
      grade: 3, subject: 'Urdu', chapter_number: 1, chapter_title: 'One',
      pdf_r2_key_en: 'k.pdf', generation_status: 'completed',
    }];
    await Endpoint.handlePakistanLpDataExchange('u1:tok', 'SELECT_GRADE', { step: 'grade', grade: '3' });
    const reads = seen.filter((q) => q.table === 'pre_generated_lps');
    expect(reads.length).toBeGreaterThan(0);
    for (const q of reads) expect(q.limit != null || q.ranges.length > 0).toBe(true);
  });
});
