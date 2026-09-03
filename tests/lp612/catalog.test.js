/**
 * The 6-12 menu: grade -> subject -> chapter -> subtopic.
 *
 * Three things are load-bearing and each has a test that fails without it:
 *
 *  1. The religious hold is applied at the QUERY, not at the last step. If
 *     Islamiat segments were filtered only when a lesson is tapped, the subject
 *     would still be listed and the teacher would tap into a screen that
 *     refuses her. Held content is invisible, not broken.
 *
 *  2. Every row payload carries the whole path. Meta does not ride screen data
 *     along with a NavigationList tap (bd-hd2wy, learned on the K-5 lane), so a
 *     row that omits `grade` produces a chapter screen that cannot be built.
 *
 *  3. Titles are clipped in CODE POINTS. An Urdu menu_title is well under 30
 *     bytes' worth of characters and well over 30 bytes; clipping on `.length`
 *     of a JS string is not the same measure Meta applies, and an over-cap row
 *     fails the whole screen silently.
 */

const mockDbCalls = [];
let mockRows = [];

function mockBuilder(table) {
  const state = { table, filters: [], order: null, columns: null };
  const b = {
    select: (c) => { state.columns = c; return b; },
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    in: (c, v) => { state.filters.push([c, v]); return b; },
    // PostgREST `or=(grade.eq.N,also_grades.cs.{N})`: a row matches on its own grade OR by
    // listing that grade in also_grades — the Grade 9-10 practicals book is one row in two menus.
    or: (expr) => { state.or = expr; return b; },
    limit: () => b,
    order: (c, o) => { state.order = [c, o]; return b; },
    limit: () => b,
    then: (res, rej) => {
      mockDbCalls.push({ ...state });
      // Apply the eq() filters the service actually sets, so the fake behaves
      // like a table rather than like a bag of rows. It filters ONLY on columns
      // the fixture defines: a row that does not model `is_current` is not
      // claiming to be non-current, and filtering it out would just make every
      // test here depend on fixture bookkeeping.
      //
      // This matters beyond tidiness. While the filters were ignored, a query
      // narrowed to one grade returned rows of every grade — so a bounded
      // per-grade read looked identical to an unbounded scan, and the suite
      // could not have told the two apart.
      let rows = mockRows.filter((r) => state.filters.every(
        ([c, v]) => r[c] === undefined || r[c] === v,
      ));
      if (state.or) {
        const m = /grade\.eq\.(\d+)/.exec(state.or);
        if (m) {
          const g = Number(m[1]);
          rows = rows.filter((r) => r.grade === undefined
            || r.grade === g || (r.also_grades || []).includes(g));
        }
      }
      return Promise.resolve({ data: rows, error: null }).then(res, rej);
    },
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Catalog = require('../../bot/shared/services/lp612-catalog.service');

const seg = (over = {}) => ({
  segment_id: 'grade_9_chemistry.c01.p007-008',
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  language: 'en',
  chapter_number: 1,
  chapter_title: 'Nature of Chemistry in Science',
  chapter_key: 'c01',
  subtopic_title: 'Definition of chemistry and its branches',
  menu_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  order_index: 1,
  lp_type: 'content',
  is_religious: false,
  ...over,
});

beforeEach(() => {
  mockDbCalls.length = 0;
  mockRows = [];
  delete process.env.LP_612_RELIGIOUS_ENABLED;
});

// ── 1. the religious hold ───────────────────────────────────────────────────

describe('the religious hold is applied at the query', () => {
  test('subjects are fetched with is_religious = false while the hold stands', async () => {
    mockRows = [seg()];
    await Catalog.buildSubjectItems(9);
    const call = mockDbCalls.find((c) => c.table === 'niete_lp612_segments');
    expect(call.filters).toContainEqual(['is_religious', false]);
  });

  test('the is_religious filter is dropped once the operator releases it', async () => {
    process.env.LP_612_RELIGIOUS_ENABLED = 'true';
    mockRows = [seg()];
    await Catalog.buildSubjectItems(9);
    const call = mockDbCalls.find((c) => c.table === 'niete_lp612_segments');
    expect(call.filters.map(([c]) => c)).not.toContain('is_religious');
  });

  test('every level applies the same hold — not just the first', async () => {
    for (const run of [
      () => Catalog.buildSubjectItems(9),
      () => Catalog.buildChapterItems(9, 'Chemistry'),
      () => Catalog.buildSegmentItems(9, 'Chemistry', 'c01'),
    ]) {
      mockDbCalls.length = 0;
      mockRows = [seg()];
      await run();
      expect(mockDbCalls[0].filters).toContainEqual(['is_religious', false]);
    }
  });

  test('only current segments are ever offered', async () => {
    mockRows = [seg()];
    await Catalog.buildSubjectItems(9);
    expect(mockDbCalls[0].filters).toContainEqual(['is_current', true]);
  });
});

// ── 2. payloads carry the whole path ────────────────────────────────────────

describe('row payloads carry everything the next step needs', () => {
  test('a subject row carries grade and subject', async () => {
    mockRows = [seg()];
    const items = await Catalog.buildSubjectItems(9);
    expect(items[0]['on-click-action'].payload).toEqual({
      step: 'lp612_subject', grade: '9', subject: 'Chemistry',
    });
  });

  test('a chapter row carries grade, subject and chapter_key', async () => {
    mockRows = [seg()];
    const items = await Catalog.buildChapterItems(9, 'Chemistry');
    expect(items[0]['on-click-action'].payload).toEqual({
      step: 'lp612_chapter', grade: '9', subject: 'Chemistry', chapter_key: 'c01',
    });
  });

  test('a subtopic row carries the segment id — the only thing serving needs', async () => {
    mockRows = [seg()];
    const { items } = await Catalog.buildSegmentItems(9, 'Chemistry', 'c01');
    expect(items[0]['on-click-action'].payload).toEqual({
      step: 'lp612_segment', segment_id: 'grade_9_chemistry.c01.p007-008',
    });
  });

  test('the More row carries the whole path plus the next page', async () => {
    mockRows = Array.from({ length: 25 }, (_, i) =>
      seg({ segment_id: `grade_9_chemistry.c01.s${i}`, order_index: i + 1 }));
    const { items, hasMore } = await Catalog.buildSegmentItems(9, 'Chemistry', 'c01');
    expect(hasMore).toBe(true);
    expect(items).toHaveLength(20);
    expect(items[19]['on-click-action'].payload).toEqual({
      step: 'lp612_segment_page', grade: '9', subject: 'Chemistry', chapter_key: 'c01', page: '2',
    });
  });
});

// ── 3. code points, not bytes ───────────────────────────────────────────────

describe('WhatsApp caps are measured in code points', () => {
  test('an over-long Urdu menu_title is clipped to 30 CODE POINTS', async () => {
    const urdu = 'اسلامی تعلیمات اور معاشرتی زندگی کے بنیادی اصول اور ان کا اطلاق';
    mockRows = [seg({ menu_title: urdu, language: 'ur' })];
    const { items } = await Catalog.buildSegmentItems(9, 'Chemistry', 'c01');
    const title = items[0]['main-content'].title;
    expect([...title].length).toBeLessThanOrEqual(30);
    // and the point of the test: it is NOT clipped on byte length
    expect(Buffer.byteLength(title, 'utf8')).toBeGreaterThan(30);
  });

  test('every rendered row obeys title 30 / description 20 / metadata 80', async () => {
    mockRows = [seg({
      menu_title: 'A'.repeat(60),
      subtopic_title: 'B'.repeat(200),
      chapter_title: 'C'.repeat(200),
      subject: 'D'.repeat(60),
    })];
    const levels = [
      await Catalog.buildSubjectItems(9),
      await Catalog.buildChapterItems(9, 'D'.repeat(60)),
      (await Catalog.buildSegmentItems(9, 'D'.repeat(60), 'c01')).items,
    ];
    for (const items of levels) {
      for (const it of items) {
        const mc = it['main-content'];
        expect([...String(mc.title)].length).toBeLessThanOrEqual(30);
        if (mc.description) expect([...String(mc.description)].length).toBeLessThanOrEqual(20);
        if (mc.metadata) expect([...String(mc.metadata)].length).toBeLessThanOrEqual(80);
      }
    }
  });
});

// ── shape ───────────────────────────────────────────────────────────────────

describe('menu shape', () => {
  test('subjects are de-duplicated across a book\'s many segments', async () => {
    mockRows = [seg(), seg({ segment_id: 'x.c01.p1' }), seg({ subject: 'Physics' })];
    const items = await Catalog.buildSubjectItems(9);
    expect(items.map((i) => i.id)).toEqual(['Chemistry', 'Physics']);
  });

  test('chapters are de-duplicated and ordered by chapter number', async () => {
    mockRows = [
      seg({ chapter_key: 'c02', chapter_number: 2, chapter_title: 'Two' }),
      seg({ chapter_key: 'c01', chapter_number: 1, chapter_title: 'One' }),
      seg({ chapter_key: 'c02', chapter_number: 2, chapter_title: 'Two' }),
    ];
    const items = await Catalog.buildChapterItems(9, 'Chemistry');
    expect(items.map((i) => i.id)).toEqual(['c01', 'c02']);
  });

  test('grades with no corpus do not appear in the grade picker', async () => {
    mockRows = [seg({ grade: 9 }), seg({ grade: 11, segment_id: 'g11' })];
    const items = await Catalog.buildGradeItems();
    expect(items.map((i) => i.id)).toEqual(['9', '11']);
    expect(items[0]['on-click-action'].payload).toEqual({ step: 'grade', grade: '9' });
  });

  test('a segment lookup returns the row the serving path will author from', async () => {
    mockRows = [seg()];
    const row = await Catalog.segmentById('grade_9_chemistry.c01.p007-008');
    expect(row.segment_id).toBe('grade_9_chemistry.c01.p007-008');
    expect(mockDbCalls[0].filters).toContainEqual(['segment_id', 'grade_9_chemistry.c01.p007-008']);
  });

  test('segmentById does NOT silently apply the religious hold — the caller decides', async () => {
    // Serving must be able to LOAD a held segment in order to refuse it with a
    // real message. A filter here would turn the refusal into "not found".
    // The id must match what is looked up: the fake now applies eq() filters,
    // so a fixture whose segment_id is not the one requested is correctly a miss.
    mockRows = [seg({ is_religious: true, segment_id: 'x' })];
    const row = await Catalog.segmentById('x');
    expect(row.is_religious).toBe(true);
    expect(mockDbCalls[0].filters.map(([c]) => c)).not.toContain('is_religious');
  });
});
