/**
 * The grade picker must not be computed by scanning the whole table.
 *
 * PostgREST answers an unbounded select with AT MOST its configured max-rows
 * (1,000 by default). `buildGradeItems` derived its DISTINCT grade list in JS
 * from `select('grade')` over every servable row — which is correct for the
 * three books the lane was built against (198 segments) and WRONG the moment
 * the corpus passes a thousand.
 *
 * Caught on staging with the real corpus loaded (4,565 servable rows): the menu
 * offered grades 6, 7, 8, 10, 11 — grade 9 and grade 12 had simply fallen off
 * the end of the first page and vanished. No error, no log, no empty screen;
 * two entire grades absent from a picker that looked perfectly normal.
 *
 * The fake below enforces the cap the way PostgREST does, so this test fails
 * against the scan and passes against a bounded query. It is the cap, not the
 * mock's row order, that does the work.
 */

const POSTGREST_MAX_ROWS = 1000;

const mockQueries = [];
let mockTable = [];

function mockBuilder() {
  const state = { filters: [], limit: null };
  const b = {
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    in: (c, v) => { state.filters.push([c, v]); return b; },
    order: () => b,
    limit: (n) => { state.limit = n; return b; },
    then: (res, rej) => {
      mockQueries.push({ ...state });
      let rows = mockTable;
      for (const [c, v] of state.filters) rows = rows.filter((r) => r[c] === v);
      // The server's ceiling applies whether or not the caller asked for a limit.
      const cap = state.limit ? Math.min(state.limit, POSTGREST_MAX_ROWS) : POSTGREST_MAX_ROWS;
      return Promise.resolve({ data: rows.slice(0, cap), error: null }).then(res, rej);
    },
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => mockBuilder()) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Catalog = require('../../bot/shared/services/lp612-catalog.service');

/** A corpus shaped like the real one: thousands of rows, grades interleaved so
 *  that the last grades sort past the cap. */
function loadCorpus() {
  mockTable = [];
  for (const grade of [6, 7, 8, 9, 10, 11, 12]) {
    for (let i = 0; i < 700; i++) {
      mockTable.push({
        grade,
        subject: 'Chemistry',
        chapter_key: 'c01',
        language: 'en',
        is_current: true,
        is_religious: false,
      });
    }
  }
}

beforeEach(() => {
  mockQueries.length = 0;
  loadCorpus();
  delete process.env.LP_612_RELIGIOUS_ENABLED;
});

describe('the grade picker at full corpus size', () => {
  test('every grade that has segments is offered', async () => {
    const items = await Catalog.buildGradeItems();
    expect(items.map((i) => i.id)).toEqual(['6', '7', '8', '9', '10', '11', '12']);
  });

  test('grade 12 — the one furthest past the cap — is present', async () => {
    const items = await Catalog.buildGradeItems();
    expect(items.map((i) => i.id)).toContain('12');
  });

  test('a grade with NO segments is still not offered', async () => {
    // The rule the original code got right and which must survive the fix:
    // an empty grade dead-ends, because there is no fallback corpus behind it.
    mockTable = mockTable.filter((r) => r.grade !== 11);
    const items = await Catalog.buildGradeItems();
    expect(items.map((i) => i.id)).not.toContain('11');
    expect(items.map((i) => i.id)).toContain('12');
  });

  test('the religious hold still applies to the picker', async () => {
    // A grade whose ONLY segments are held must not be offered.
    mockTable = mockTable.map((r) => (r.grade === 7 ? { ...r, is_religious: true } : r));
    const items = await Catalog.buildGradeItems();
    expect(items.map((i) => i.id)).not.toContain('7');
  });

  test('no single query tries to pull the whole table', async () => {
    await Catalog.buildGradeItems();
    // Every read is either bounded by an explicit limit or narrowed to one
    // grade. An unbounded whole-table scan is the defect itself.
    for (const q of mockQueries) {
      const narrowed = q.filters.some(([c]) => c === 'grade');
      expect(narrowed || q.limit).toBeTruthy();
    }
  });
});
