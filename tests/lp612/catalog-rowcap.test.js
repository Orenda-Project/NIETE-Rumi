/**
 * bd-oak77.27 — NO catalogue read may be row-count-dependent.
 *
 * PostgREST answers a select with AT MOST its configured `db-max-rows` and
 * returns NO error when it truncates. Measured 2026-09-07 on BOTH refs of this
 * project — prod `ihzciabopbttygxxgrkm` and staging `rpqkekcfvumypldbejhp`:
 * `GET /rest/v1/niete_lp612_segments?select=segment_id` returns exactly 1000
 * rows with `content-range: 0-999/6618`. The cap is 1000, not "1000 by default".
 *
 * `buildGradeItems` was fixed for this once (bounded `limit(1)` probes) after
 * the grade picker on staging silently offered 6, 7, 8, 10, 11 — grades 9 and
 * 12 had fallen off the end of the first page. Every OTHER read in this module
 * kept the same shape. Rows they pull today, measured on prod:
 *
 *   buildSubjectItems   g10 863 rows (86% of the cap)  ← nearest the cliff
 *   buildChapterItems   g10 Pakistan Studies 172 rows
 *   buildSegmentItems   g10 Pakistan Studies c06 35 rows
 *
 * And the same class is ALREADY over the cliff elsewhere: `niete_lp_assets`
 * holds 1,284 servable v8 rows on both refs and is correct only because
 * `availableLessonIds` pages.
 *
 * The fake below enforces the cap the way the live server does — including on
 * a `.limit(n)` above the cap, which is why "just raise the limit" is not a
 * fix. Each test drops a real menu row against the unbounded code and gets it
 * back against a paged one. It is the cap that does the work, not row order.
 */

const POSTGREST_MAX_ROWS = 1000; // MEASURED on both refs, 2026-09-07

const mockQueries = [];
let mockTable = [];

function mockBuilder(table) {
  const state = { table, filters: [], or: null, limit: null, ranges: [] };
  const rowsNow = () => {
    let rows = mockTable.filter((r) => r.__t === table);
    for (const [c, v] of state.filters) rows = rows.filter((r) => r[c] === v);
    if (state.or) {
      const m = /grade\.eq\.(\d+)/.exec(state.or);
      if (m) {
        const g = Number(m[1]);
        rows = rows.filter((r) => r.grade === g || (r.also_grades || []).includes(g));
      }
    }
    return rows;
  };
  const settle = (from, to) => {
    mockQueries.push({ ...state, ranges: [...state.ranges] });
    const rows = rowsNow();
    // The server ceiling applies to a window as well as to a bare select, and it
    // applies whether or not the caller asked for a limit.
    const start = from == null ? 0 : from;
    const askedEnd = to == null
      ? (state.limit ? start + state.limit - 1 : Infinity)
      : to;
    const end = Math.min(askedEnd, start + POSTGREST_MAX_ROWS - 1);
    return { data: rows.slice(start, end === Infinity ? undefined : end + 1), error: null };
  };
  const b = {
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    in: (c, v) => { state.filters.push([c, v]); return b; },
    or: (expr) => { state.or = expr; return b; },
    order: () => b,
    limit: (n) => { state.limit = n; return b; },
    range: (from, to) => {
      state.ranges.push([from, to]);
      return { then: (res, rej) => Promise.resolve(settle(from, to)).then(res, rej) };
    },
    maybeSingle: () => ({ then: (res, rej) => Promise.resolve({ data: rowsNow()[0] || null, error: null }).then(res, rej) }),
    single: () => ({ then: (res, rej) => Promise.resolve({ data: rowsNow()[0] || null, error: null }).then(res, rej) }),
    then: (res, rej) => Promise.resolve(settle(null, null)).then(res, rej),
  };
  return b;
}

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilder(t)) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Catalog = require('../../bot/shared/services/lp612-catalog.service');

/** Rows for `niete_lp612_segments`, in the physical order the fake serves them. */
function seg(n, over) {
  return Array.from({ length: n }, (_, i) => ({
    __t: 'niete_lp612_segments',
    grade: 10,
    subject: 'Chemistry',
    book_stem: 'grade_10_chemistry',
    chapter_key: 'c01',
    chapter_number: 1,
    chapter_title: 'Chapter one',
    part: null,
    language: 'en',
    order_index: i + 1,
    segment_id: `s${i}`,
    is_current: true,
    is_religious: false,
    ...over,
  }));
}

beforeEach(() => {
  mockQueries.length = 0;
  mockTable = [];
  delete process.env.LP_612_RELIGIOUS_ENABLED;
});

// ── the defect, at the subject screen ───────────────────────────────────────

describe('buildSubjectItems past the cap', () => {
  beforeEach(() => {
    // Grade 10 as it will look one book from now: 1,000 Chemistry rows ahead of
    // 200 Physics rows. Prod is at 863 rows for grade 10 today — 86% of the cap
    // — and the four known-missing books plus any further segmentation crosses it.
    mockTable = [
      ...seg(1100, { subject: 'Chemistry', book_stem: 'grade_10_chemistry' }),
      ...seg(200, { subject: 'Physics', book_stem: 'grade_10_physics', chapter_key: 'c02' }),
    ];
  });

  test('a subject whose rows sit past the cap is STILL offered', async () => {
    const items = await Catalog.buildSubjectItems(10);
    // Sorted, because what is under test is that Physics SURVIVED the 1,000-row cap — not where
    // it sits. The menu's order is core-before-elective (bd-y5vx3) and is pinned in
    // `subject-order.test.js`; this suite must not redden when that policy is edited.
    expect(items.map((i) => i.id).sort()).toEqual(['Chemistry', 'Physics']);
  });

  test('the lesson count on a subject row is the whole subject, not the first page', async () => {
    const items = await Catalog.buildSubjectItems(10);
    const chem = items.find((i) => i.id === 'Chemistry');
    expect(chem['main-content'].metadata).toContain('1100 lessons');
  });

  test('no single read is allowed to be an unbounded whole-grade scan', async () => {
    await Catalog.buildSubjectItems(10);
    for (const q of mockQueries) {
      // Bounded by an explicit limit, or windowed with .range() — never neither.
      expect(q.limit != null || q.ranges.length > 0).toBe(true);
    }
  });
});

// ── the same shape, one screen deeper ───────────────────────────────────────

describe('buildChapterItems past the cap', () => {
  test('a chapter whose rows sit past the cap is still reachable', async () => {
    mockTable = [
      ...seg(1000, { chapter_key: 'c01', chapter_number: 1, chapter_title: 'One' }),
      ...seg(60, { chapter_key: 'c02', chapter_number: 2, chapter_title: 'Two', segment_id: 'x' }),
    ];
    const { total } = await Catalog.buildChapterItems(10, 'Chemistry');
    expect(total).toBe(2);
  });

  test('the lesson count on a chapter row counts the whole chapter', async () => {
    mockTable = seg(1100, { chapter_key: 'c01', chapter_number: 1, chapter_title: 'One' });
    const { items } = await Catalog.buildChapterItems(10, 'Chemistry');
    expect(items[0]['main-content'].description).toBe('1100 lessons');
  });
});

describe('buildSegmentItems past the cap', () => {
  test('a chapter with more segments than the cap reports its true total', async () => {
    mockTable = seg(1200, { chapter_key: 'c01' });
    const { total } = await Catalog.buildSegmentItems(10, 'Chemistry', 'c01');
    expect(total).toBe(1200);
  });

  test('the last page of an over-cap chapter still has rows', async () => {
    mockTable = seg(1200, { chapter_key: 'c01' });
    const { items } = await Catalog.buildSegmentItems(10, 'Chemistry', 'c01', 62);
    expect(items.length).toBeGreaterThan(0);
  });
});

// ── the one-row read stays a one-row read ───────────────────────────────────

describe('segmentById', () => {
  test('asks the server for one row, not for everything that matches', async () => {
    mockTable = seg(3, { segment_id: 'only' }).map((r) => ({ ...r, segment_id: 'only' }));
    const row = await Catalog.segmentById('only');
    expect(row).toBeTruthy();
    expect(mockQueries.every((q) => q.limit === 1 || q.ranges.length > 0)).toBe(true);
  });
});
