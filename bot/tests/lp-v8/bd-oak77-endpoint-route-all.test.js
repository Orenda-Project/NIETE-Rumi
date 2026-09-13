/**
 * bd-oak77.4 — the Flow endpoint under LP_612_ROUTE_ALL / LP_612_ROUTE_K5.
 *
 * LEAK 2: `selectGrade` falls back from the 6-12 corpus to the OLD Oxbridge picker's subjects when
 * a 6-12 grade has no segments. That fallback is the old picker being reachable by another name, so
 * with LP_612_ROUTE_ALL on it is suppressed and she gets the honest "nothing for this class yet".
 *
 * And the K-5 switch: LP_612_ROUTE_K5 ships FALSE, so grades 1-5 keep the FEAT-059 v8 corpus. The
 * test for `true` exists so the operator's answer is a flag flip with a proven behaviour behind it,
 * not a rebuild — and so the switch is not a capability with no caller (pre-merge class Q).
 *
 * Every assertion drives the real `selectGrade` line with supabase, R2 and the catalog services
 * mocked at the boundary.
 */

const mockV8Available = new Set();
jest.mock('../../shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: jest.fn(async () => mockV8Available),
  downloadedLessonIds: jest.fn(async () => new Set()),
  deliverV8Lesson: jest.fn(async () => ({ ok: true })),
}));

const mockOxRows = [];
jest.mock('../../shared/services/oxbridge-lp.service', () => ({
  gradeWord: jest.fn((g) => ({ 6: 'Grade Six', 7: 'Grade Seven', 9: 'Grade Nine' }[g] || null)),
  extractTopicFromDescription: jest.fn(() => 'Ox Topic'),
  getById: jest.fn(async () => null),
  deliverOxbridgeLp: jest.fn(async () => true),
}));

let mockLp612Subjects = [];
jest.mock('../../shared/services/lp612-catalog.service', () => ({
  buildGradeItems: jest.fn(async () => []),
  buildSubjectItems: jest.fn(async () => mockLp612Subjects),
  buildChapterItems: jest.fn(async () => []),
  buildSegmentItems: jest.fn(async () => []),
  segmentById: jest.fn(async () => null),
  TABLE: 'niete_lp612_segments',
}));

function mockBuilder(rows) {
  let out = [...rows];
  const b = {
    select: () => b,
    eq: (col, val) => { out = out.filter((r) => String(r[col]) === String(val)); return b; },
    order: () => b,
    limit: () => Promise.resolve({ data: out, error: null }),
    range: (from, to) => Promise.resolve({ data: out.slice(from, to + 1), error: null }),
    single: () => Promise.resolve({ data: out[0] || null, error: null }),
    maybeSingle: () => Promise.resolve({ data: out[0] || null, error: null }),
    then: (f, r) => Promise.resolve({ data: out, error: null }).then(f, r),
  };
  return b;
}
const mockPreGenRows = [];
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => {
    if (table === 'pre_generated_lps') return mockBuilder(mockPreGenRows);
    if (table === 'lesson_plan_catalog') return mockBuilder(mockOxRows);
    if (table === 'users') return mockBuilder([{ id: 'user-1', phone_number: '923365709413', preferred_language: 'en' }]);
    return mockBuilder([]);
  }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true) }));

const V8Catalog = require('../../shared/services/lp-v8-catalog.service');
const Lp612Catalog = require('../../shared/services/lp612-catalog.service');
const EP = require('../../shared/routes/pakistan-lp-endpoint');

const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 3 },
  books: [{
    stem: 'grade_3_english', grade: 3, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{
      number: 1, title: 'Hello World!', title_short: 'Hello World!',
      lessons: [1, 2, 3].map((i) => ({
        lesson_id: `grade_3_english_ch1_seg${i}`,
        segment_index: i, lp_type: 'content', day_label: `Day ${i}`,
        section: 'Memory Lane', section_short: 'Memory Lane',
        topic: `Topic ${i}`, topic_short: `Topic ${i}`, pages: [i], pages_label: `p.${i}`,
        row: { title: 'Memory Lane', description: `Day ${i}`, metadata: `Topic ${i} · p.${i}` },
      })),
    }],
  }],
};

const TOKEN = 'user-1:pakistan-lp:123';
const ENV = ['LP_612_ENABLED', 'LP_612_ROUTE_ALL', 'LP_612_ROUTE_K5'];

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => { V8Catalog.__setCatalogForTests(null); ENV.forEach((k) => delete process.env[k]); });

beforeEach(() => {
  jest.clearAllMocks();
  ENV.forEach((k) => delete process.env[k]);
  mockV8Available.clear();
  [1, 2, 3].forEach((i) => mockV8Available.add(`grade_3_english_ch1_seg${i}`));
  mockOxRows.length = 0;
  mockPreGenRows.length = 0;
  mockLp612Subjects = [];
});

const grade = (g) => EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: String(g) });

describe('LEAK 2 — the endpoint stops falling back to the old Oxbridge picker', () => {
  test('WITHOUT ROUTE_ALL: a 6-12 grade with no segments still gets Oxbridge subjects (today)', async () => {
    process.env.LP_612_ENABLED = 'true';
    mockOxRows.push({ id: 'ox-1', source: 'oxbridge', is_active: true, grade: 'Grade Nine', subject: 'Biology', chapter_title: 'Cells', description: '', content_html: '' });
    const res = await grade(9);
    expect(Lp612Catalog.buildSubjectItems).toHaveBeenCalledWith(9);
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.subjects.map((s) => s.id)).toEqual(['Biology']);
  });

  test('WITH ROUTE_ALL: the Oxbridge fallback is suppressed and she is told honestly', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';
    mockOxRows.push({ id: 'ox-1', source: 'oxbridge', is_active: true, grade: 'Grade Nine', subject: 'Biology', chapter_title: 'Cells', description: '', content_html: '' });
    const res = await grade(9);
    expect(res.screen).toBeUndefined();
    expect(res.data.error.message).toMatch(/No lesson plans available for Grade 9 yet/);
    expect(res.data.error.message).not.toMatch(/Biology/);
  });

  test('WITH ROUTE_ALL and segments present, the 6-12 menu answers normally', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';
    mockLp612Subjects = [{ id: 'biology', title: 'Biology' }];
    const res = await grade(9);
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.items).toEqual(mockLp612Subjects);
    expect(res.data.grade_display).toBe('Grade 9');
  });

  test('ROUTE_ALL never touches grades outside 6-12 — grade 3 keeps its v8 subjects', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';
    const res = await grade(3);
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.items.map((i) => i.id)).toEqual(['english']);
    expect(Lp612Catalog.buildSubjectItems).not.toHaveBeenCalled();
  });
});

describe('LP_612_ROUTE_K5 — built, shipped false', () => {
  test('default (false): grade 3 is served by the FEAT-059 v8 corpus', async () => {
    process.env.LP_612_ENABLED = 'true';
    const res = await grade(3);
    expect(res.data.items.map((i) => i.id)).toEqual(['english']);
    expect(Lp612Catalog.buildSubjectItems).not.toHaveBeenCalled();
  });

  test('true: grade 3 is handed to the 6-12 catalogue instead', async () => {
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_K5 = 'true';
    mockLp612Subjects = [{ id: 'biology', title: 'Biology' }];
    const res = await grade(3);
    expect(Lp612Catalog.buildSubjectItems).toHaveBeenCalledWith(3);
    expect(res.data.items).toEqual(mockLp612Subjects);
  });

  test('true + ROUTE_ALL: a K-5 teacher is told plainly there is nothing for her class', async () => {
    // This is the honest consequence the operator is deciding about: the 62 books are 6-12.
    process.env.LP_612_ENABLED = 'true';
    process.env.LP_612_ROUTE_ALL = 'true';
    process.env.LP_612_ROUTE_K5 = 'true';
    mockLp612Subjects = [];
    const res = await grade(3);
    expect(res.data.error.message).toMatch(/No lesson plans available for Grade 3 yet/);
  });

  test('K5 switch is inert while LP_612_ENABLED is off', async () => {
    process.env.LP_612_ROUTE_K5 = 'true';
    const res = await grade(3);
    expect(Lp612Catalog.buildSubjectItems).not.toHaveBeenCalled();
    expect(res.data.items.map((i) => i.id)).toEqual(['english']);
  });
});
