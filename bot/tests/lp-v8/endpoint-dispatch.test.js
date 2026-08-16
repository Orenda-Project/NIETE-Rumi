/**
 * FEAT-059 / bd-fg3p4 — Pakistan LP endpoint dispatch (TDD, red first).
 *
 * Two things this must not break:
 *
 *  1. FEAT-080 (Oxbridge 6-12) is LIVE with 70 lesson plans. Grades 6-10 must
 *     keep resolving through lesson_plan_catalog exactly as before.
 *
 *  2. The deploy order is endpoint-first, THEN Flow republish (Meta health-
 *     probes the endpoint before allowing publish — skill rule 9). So for a
 *     window, the NEW endpoint serves the OLD v2 Flow, whose payloads carry no
 *     `step`. Screen-based routing therefore has to keep working.
 */

const mockV8Available = new Set();
const mockV8Downloaded = new Set();
const mockDelivered = [];
jest.mock('../../shared/services/lp-v8-delivery.service', () => ({
  availableLessonIds: jest.fn(async () => mockV8Available),
  downloadedLessonIds: jest.fn(async () => mockV8Downloaded),
  deliverV8Lesson: jest.fn(async (opts) => { mockDelivered.push(opts); return { ok: true }; }),
}));

const mockOxRows = [];
jest.mock('../../shared/services/oxbridge-lp.service', () => ({
  gradeWord: jest.fn((g) => ({ 6: 'Grade Six', 7: 'Grade Seven' }[g] || null)),
  extractTopicFromDescription: jest.fn(() => 'Ox Topic'),
  getById: jest.fn(async (id) => mockOxRows.find((r) => r.id === id) || null),
  deliverOxbridgeLp: jest.fn(async () => true),
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
    if (table === 'users') return mockBuilder([{ id: 'user-1', phone_number: '923001234567', preferred_language: 'en' }]);
    return mockBuilder([]);
  }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true) }));

const V8Catalog = require('../../shared/services/lp-v8-catalog.service');
const EP = require('../../shared/routes/pakistan-lp-endpoint');

const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 24 },
  books: [{
    stem: 'grade_1_english', grade: 1, subject: 'English', subject_key: 'english', rtl: false,
    chapters: [{
      number: 1, title: 'Hello World!', title_short: 'Hello World!',
      // 24 lessons so the pagination path is exercised for real (this mirrors
      // grade_1_maths ch3, the one chapter in the corpus over the 20-row cap).
      lessons: Array.from({ length: 24 }, (_, k) => k + 1).map((i) => ({
        lesson_id: `grade_1_english_ch1_seg${i}`,
        segment_index: i, lp_type: 'content', day_label: `Day ${i}`,
        section: 'Memory Lane', section_short: 'Memory Lane',
        topic: `Topic ${i}`, topic_short: `Topic ${i}`, pages: [i], pages_label: `p.${i}`,
        row: { title: 'Memory Lane', description: `Day ${i}`, metadata: `Topic ${i} · p.${i}` },
      })),
    }],
  }],
};

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

beforeEach(() => {
  mockV8Available.clear();
  for (let i = 1; i <= 24; i += 1) mockV8Available.add(`grade_1_english_ch1_seg${i}`);
  mockV8Downloaded.clear();
  mockDelivered.length = 0;
  mockOxRows.length = 0;
  mockPreGenRows.length = 0;
});

const TOKEN = 'user-1:pakistan-lp:123';

describe('INIT', () => {
  test('lands on the grade picker with NavigationList items', async () => {
    const res = await EP.handlePakistanLpInit(TOKEN);
    expect(res.screen).toBe('SELECT_GRADE');
    expect(Array.isArray(res.data.items)).toBe(true);
    expect(res.data.items.length).toBe(10);
    expect(res.data.items[0]['on-click-action'].payload.step).toBe('grade');
  });
});

describe('v8 path (grades 1-5)', () => {
  test('grade → subject list built from the catalog × availability', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '1' });
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.items.map((i) => i.id)).toEqual(['english']);
  });

  test('subject → chapter list', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_SUBJECT', { step: 'subject', grade: '1', subject: 'english' });
    expect(res.screen).toBe('SELECT_CHAPTER');
    expect(res.data.items.map((i) => i.id)).toEqual(['1']);
  });

  test('chapter → lesson list, with the tick reflecting what she already has', async () => {
    mockV8Downloaded.add('grade_1_english_ch1_seg1');
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', {
      step: 'chapter', grade: '1', subject: 'english', chapter: '1',
    });
    expect(res.screen).toBe('SELECT_LESSON');
    expect(res.data.items[0]['main-content'].title).toBe('✓ Memory Lane');
    expect(res.data.items[1]['main-content'].title).toBe('○ Memory Lane');
  });

  test('a grade with nothing available says so instead of dead-ending', async () => {
    mockV8Available.clear();
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '1' });
    expect(res.data.error).toBeDefined();
    expect(res.data.error.message).toMatch(/prepar|available/i);
  });

  test('lesson tap delivers and returns SUCCESS without waiting on the send', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', {
      step: 'lesson', lesson: 'V8-grade_1_english_ch1_seg2',
    });
    expect(res.screen).toBe('SUCCESS');
    expect(res.data.message).toContain('Topic 2');
    expect(mockDelivered).toHaveLength(1);
    expect(mockDelivered[0]).toMatchObject({ userId: 'user-1', lessonId: 'grade_1_english_ch1_seg2' });
  });

  test('pagination step returns the overflow screen', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', {
      step: 'lesson_page', page: '2', grade: '1', subject: 'english', chapter: '1',
    });
    expect(res.screen).toBe('SELECT_LESSON_MORE');
    expect(Array.isArray(res.data.items)).toBe(true);
  });

  test('an unknown v8 lesson id is refused, and nothing is delivered', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_LESSON', { step: 'lesson', lesson: 'V8-nope' });
    expect(res.data.error).toBeDefined();
    expect(mockDelivered).toEqual([]);
  });
});

describe('Oxbridge path (grades 6-10) — FEAT-080 regression guard', () => {
  test('grade 6 subjects still come from lesson_plan_catalog', async () => {
    mockOxRows.push({ id: 1, grade: 'Grade Six', subject: 'Physics', chapter_title: 'Motion', description: 'd', content_html: '<p/>', source: 'oxbridge', is_active: true });
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '6' });
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.items.map((i) => i.id)).toEqual(['Physics']);
  });

  test('an Oxbridge lesson keeps its OX- id and its own delivery pipeline', async () => {
    mockOxRows.push({ id: 1, grade: 'Grade Six', subject: 'Physics', chapter_title: 'Motion', description: 'd', content_html: '<p/>', source: 'oxbridge', is_active: true });
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', {
      step: 'chapter', grade: '6', subject: 'Physics', chapter: 'Motion',
    });
    expect(res.screen).toBe('SELECT_LESSON');
    expect(res.data.items[0].id).toMatch(/^OX-/);
    // and it must NOT have gone anywhere near the v8 delivery service
    expect(mockDelivered).toEqual([]);
  });

  test('an Oxbridge grade with no rows says so rather than showing an empty screen', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '7' });
    expect(res.data.error).toBeDefined();
  });
});

describe('back-compat with the still-published v2 Flow', () => {
  // Deploy order is endpoint → then republish the Flow (Meta health-probes the
  // endpoint first). For that window the new endpoint serves v2 payloads, which
  // carry a screen but no `step`.
  test('a v2 payload with no step still routes by screen', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { grade: '1' });
    expect(res.screen).toBe('SELECT_SUBJECT');
  });

  test('a v2 subject payload routes by screen too', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_SUBJECT', { grade: '1', subject: 'english' });
    expect(res.screen).toBe('SELECT_CHAPTER');
  });

  test('an unknown screen with no step is an error, not a crash', async () => {
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'MYSTERY', {});
    expect(res.data.error).toBeDefined();
  });
});


describe('legacy pre_generated_lps fallback for grades 1-5 — deploy-day guard', () => {
  // Grades 1-5 are served by pre_generated_lps TODAY. On the day this ships the
  // v8 uploader has not run, so niete_lp_assets is EMPTY. If the v8 path simply
  // replaced the legacy one, every K-5 teacher would open the menu and be told
  // her lesson plans are "being prepared" — losing a working feature. v8 wins
  // where it has content; otherwise the legacy corpus answers as before.
  const PREGEN = {
    id: 'uuid-1',
    curriculum: 'pakistan',
    grade: 1,
    subject: 'English',
    chapter_number: 1,
    chapter_title: 'Hello World!',
    pdf_r2_key_en: 'lessons/g1-en-ch1.pdf',
    generation_status: 'completed',
    is_current: true,
  };

  test('with NO v8 assets, grade 1 still lists its legacy subjects', async () => {
    mockV8Available.clear();
    mockPreGenRows.push(PREGEN);
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '1' });
    expect(res.data.error).toBeUndefined();
    expect(res.screen).toBe('SELECT_SUBJECT');
    expect(res.data.items.map((i) => i.id)).toEqual(['English']);
  });

  test('with NO v8 assets, grade 1 still lists its legacy chapters', async () => {
    mockV8Available.clear();
    mockPreGenRows.push(PREGEN);
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_SUBJECT', { step: 'subject', grade: '1', subject: 'English' });
    expect(res.screen).toBe('SELECT_CHAPTER');
    expect(res.data.items).toHaveLength(1);
  });

  test('with NO v8 assets, a legacy chapter still yields a PK- lesson row', async () => {
    mockV8Available.clear();
    mockPreGenRows.push(PREGEN);
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_CHAPTER', {
      step: 'chapter', grade: '1', subject: 'English', chapter: '1',
    });
    expect(res.screen).toBe('SELECT_LESSON');
    expect(res.data.items[0].id).toMatch(/^PK-/);
    expect(mockDelivered).toEqual([]);
  });

  test('once v8 HAS content it wins — the legacy corpus is not consulted', async () => {
    mockPreGenRows.push(PREGEN);
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '1' });
    expect(res.data.items.map((i) => i.id)).toEqual(['english']);   // v8 subject_key, not 'English'
  });

  test('neither corpus has anything → a friendly message, never an empty screen', async () => {
    mockV8Available.clear();
    const res = await EP.handlePakistanLpDataExchange(TOKEN, 'SELECT_GRADE', { step: 'grade', grade: '1' });
    expect(res.data.error).toBeDefined();
  });
});
