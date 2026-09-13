/**
 * The 6-12 corpus, in a shape a browser can render.
 *
 * The sibling of the K-5 browse service, and it exists for the same reason: the Flow's own
 * `build*Items()` return WhatsApp NavigationList rows — titles clipped to 30 code points, 20
 * rows a page. 6-12 subtopic titles are the actual teaching objective and routinely run past
 * 30 characters, so handing those builders to a browser would truncate the one field a teacher
 * chooses by.
 *
 * WHAT THESE TESTS PIN, in rough order of how much it would cost to get wrong:
 *
 *  1. THE RELIGIOUS HOLD IS IN THE QUERY. 528 segments are withheld on production today by an
 *     unset `LP_612_RELIGIOUS_ENABLED`. A hold enforced by the caller is a hold that can be
 *     asked not to apply.
 *  2. READINESS IS ASKED ABOUT TODAY'S TEMPLATE. The template version is part of the cache key.
 *     11 of the 473 renders on production sit on the previous template and would NOT be served
 *     to a tap; reporting them ready promises an instant download that takes three minutes.
 *  3. EVERY READ IS PAGED. PostgREST caps an unbounded select at 1,000 rows and says nothing
 *     about the rest. Grade 10 has 912 segments — one page from silent truncation. This exact
 *     bug shipped once already on the WhatsApp grade picker, which offered "6, 7, 8, 10, 11".
 */

const mockLogToFile = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLogToFile(...a) }));

// Every query the service builds, recorded as a flat list of the filters it applied, so a test
// can assert WHERE a rule was enforced rather than only that its effect showed up.
let queries = [];
let responder = () => ({ data: [], error: null });

function mockBuilder(table) {
  const q = { table, filters: {}, columns: null, ranged: null, limited: null };
  queries.push(q);
  const api = {
    select: (c) => { q.columns = c; return api; },
    eq: (k, v) => { q.filters[k] = v; return api; },
    gte: (k, v) => { q.filters[`${k}>=`] = v; return api; },
    lte: (k, v) => { q.filters[`${k}<=`] = v; return api; },
    in: (k, v) => { q.filters[`${k} in`] = v; return api; },
    contains: (k, v) => { q.filters[`${k} contains`] = v; return api; },
    order: (k, o) => { q.order = [k, o]; return api; },
    limit: (n) => { q.limited = n; return Promise.resolve(responder(q)); },
    range: (a, b) => { q.ranged = [a, b]; return Promise.resolve(responder(q)); },
    maybeSingle: () => Promise.resolve(responder(q)),
    then: (r, j) => Promise.resolve(responder(q)).then(r, j),
  };
  return api;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockBuilder(t) }));

const SEGMENTS = 'niete_lp612_segments';
const RENDERS = 'niete_lp612_renders';

let Browse;
beforeEach(() => {
  jest.resetModules();
  mockLogToFile.mockReset();
  queries = [];
  process.env.LP_612_TEMPLATE_VERSION = 'v9.2';
  delete process.env.LP_612_RELIGIOUS_ENABLED;
  Browse = require('../../bot/shared/services/lp612-browse.service');
});

const segQueries = () => queries.filter((q) => q.table === SEGMENTS);
const renderQueries = () => queries.filter((q) => q.table === RENDERS);

describe('the religious hold is enforced in the query, not by the caller', () => {
  test('every segment read filters is_religious=false while the flag is unset', async () => {
    responder = () => ({ data: [], error: null });
    await Browse.listSubjects(9);

    expect(segQueries().length).toBeGreaterThan(0);
    for (const q of segQueries()) {
      expect(q.filters.is_religious).toBe(false);
      // The other two invariants ride along on the same helper.
      expect(q.filters.is_current).toBe(true);
      expect(q.filters['grade>=']).toBe(6);
      expect(q.filters['grade<=']).toBe(12);
    }
  });

  test('the filter is dropped only when the operator turns the hold off', async () => {
    process.env.LP_612_RELIGIOUS_ENABLED = 'true';
    jest.resetModules();
    Browse = require('../../bot/shared/services/lp612-browse.service');
    queries = [];
    responder = () => ({ data: [], error: null });

    await Browse.listSubjects(9);
    for (const q of segQueries()) {
      expect(q.filters).not.toHaveProperty('is_religious');
    }
  });
});

describe('readiness is asked about the template that would actually be served', () => {
  const ROWS = [
    { segment_id: 's1', subtopic_title: 'Distance and displacement', order_index: 1, printed_page_start: 21, printed_page_end: 24 },
    { segment_id: 's2', subtopic_title: 'Speed and velocity', order_index: 2, printed_page_start: 25, printed_page_end: 25 },
  ];

  test('a render on the CURRENT template marks the lesson ready', async () => {
    responder = (q) => (q.table === SEGMENTS
      ? { data: ROWS, error: null }
      : { data: [{ segment_id: 's1' }], error: null });

    const out = await Browse.listLessons(9, 'Physics', 'c02');

    expect(out.map((l) => [l.segment_id, l.ready]))
      .toEqual([['s1', true], ['s2', false]]);

    // The lookup is scoped to today's template and language — not "any render that exists".
    const r = renderQueries()[0];
    expect(r.filters.template_version).toBe('v9.2');
    expect(r.filters.status).toBe('ready');
    expect(r.filters.lang).toBe('en');
  });

  test('a render on an OLDER template does not count as ready', async () => {
    // The render table is asked for v9.2 and holds only a v9.1 row, so it answers with nothing.
    responder = (q) => (q.table === SEGMENTS
      ? { data: ROWS, error: null }
      : { data: [], error: null });

    const out = await Browse.listLessons(9, 'Physics', 'c02');

    // Both must read false. Reporting a stale render as ready promises an instant download and
    // delivers a three-minute wait, because the request path keys on the template too.
    expect(out.every((l) => l.ready === false)).toBe(true);
  });

  test('a readiness lookup that fails degrades to "not ready", never to an error', async () => {
    responder = (q) => (q.table === SEGMENTS
      ? { data: ROWS, error: null }
      : { data: null, error: { message: 'boom' } });

    const out = await Browse.listLessons(9, 'Physics', 'c02');

    // She still gets the catalogue. Readiness is an optimisation; the request path re-asks the
    // same question and will serve a cache hit correctly whatever this said.
    expect(out).toHaveLength(2);
    expect(out.every((l) => l.ready === false)).toBe(true);
    expect(mockLogToFile).toHaveBeenCalled();
  });
});

describe('no read can be silently truncated by PostgREST', () => {
  test('a full page is followed by another read, so row 1001 is not lost', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ subject: `S${i}` }));
    let call = 0;
    responder = (q) => {
      if (q.table !== SEGMENTS) return { data: [], error: null };
      call += 1;
      return call === 1
        ? { data: page1, error: null }
        : { data: [{ subject: 'LAST' }], error: null };
    };

    const out = await Browse.listSubjects(10);

    // Two ranged reads, and the subject that lived past the cap survived.
    const ranges = segQueries().filter((q) => q.ranged).map((q) => q.ranged);
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(out.some((s) => s.subject === 'LAST')).toBe(true);
  });

  test('the grade probe is bounded — one limit(1) per grade, never a scan', async () => {
    responder = (q) => ({ data: q.filters.grade === 9 ? [{ grade: 9 }] : [], error: null });

    const out = await Browse.listGrades();

    expect(out).toEqual([{ grade: 9 }]);
    // Seven probes, 6..12, each bounded.
    expect(segQueries()).toHaveLength(7);
    for (const q of segQueries()) expect(q.limited).toBe(1);
  });
});

describe('the shape a browser needs', () => {
  test('titles are returned in full, never clipped to the Flow cap', async () => {
    const long = 'Ingestion, digestion and the structures of the alimentary canal';
    responder = (q) => (q.table === SEGMENTS
      ? { data: [{ segment_id: 's1', subtopic_title: long, menu_title: 'Alimentary canal', order_index: 1 }], error: null }
      : { data: [], error: null });

    const [lesson] = await Browse.listLessons(10, 'Biology', 'c01');

    expect(lesson.title).toBe(long);
    expect(lesson.title.length).toBeGreaterThan(30);
  });

  test('chapters that share a number across two books stay distinct', async () => {
    responder = (q) => (q.table === SEGMENTS
      ? {
        data: [
          { chapter_key: 'c01', chapter_number: 1, chapter_title: 'Sets', book_stem: 'book_a' },
          { chapter_key: 'c01', chapter_number: 1, chapter_title: 'Motion', book_stem: 'book_b' },
        ],
        error: null,
      }
      : { data: [], error: null });

    const out = await Browse.listChapters(9, 'Mathematics');

    // Keyed by book+chapter, so one does not swallow the other.
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.chapter_title).sort()).toEqual(['Motion', 'Sets']);
  });
});

/**
 * THE EMPTIED WAITER LIST — the trap this suite exists to keep shut.
 *
 * `lp612_claim_waiters` reads the waiter list and EMPTIES it in one locked statement the moment
 * a render reaches a terminal state. Verified on production: all 473 completed renders carry
 * `waiters = []`.
 *
 * So the obvious ownership predicate — "she may see it if she is waiting on it" — is correct for
 * about three minutes and wrong for ever afterwards. It stops matching at exactly the instant the
 * lesson becomes available, which is the instant she is polling for it. A "My lesson plans" list
 * built that way would show in-flight jobs and silently lose every lesson it ever finished.
 *
 * `requested_by` survives the claim, but names only whoever tapped FIRST — so on a shared render
 * every teacher after the first would be refused a lesson she legitimately waited for. Neither
 * field alone is the answer.
 */
describe('ownership survives the waiter list being emptied', () => {
  const DONE = {
    id: 'r1',
    segment_id: 's1',
    status: 'ready',
    r2_key: 'lp612/v9.2/en/s1.pdf',
    // What a COMPLETED render actually looks like on production.
    waiters: [],
    requested_by: 'teacher-1',
  };

  test('the teacher who started it can still read a finished render', async () => {
    responder = () => ({ data: DONE, error: null });

    const out = await Browse.renderStatus('r1', 'teacher-1');

    expect(out).toBeTruthy();
    expect(out.status).toBe('ready');
    expect(out.r2_key).toBe('lp612/v9.2/en/s1.pdf');
    // The ownership columns are not leaked to the caller.
    expect(out).not.toHaveProperty('waiters');
    expect(out).not.toHaveProperty('requested_by');
  });

  test('a teacher who JOINED a run in flight is entitled to it too', async () => {
    responder = () => ({
      data: { ...DONE, status: 'authoring', requested_by: 'someone-else', waiters: [{ user_id: 'teacher-2' }] },
      error: null,
    });

    // The shared-render case. Refusing her here is the bug that `requested_by` alone would cause.
    expect(await Browse.renderStatus('r1', 'teacher-2')).toBeTruthy();
  });

  test('a teacher with no claim on the render gets nothing', async () => {
    responder = () => ({ data: DONE, error: null });
    expect(await Browse.renderStatus('r1', 'a-stranger')).toBeNull();
  });

  test('My lesson plans finds a finished lesson, not just running ones', async () => {
    // The requested_by read returns the finished render; the waiters read returns nothing,
    // because the claim emptied the list.
    responder = (q) => (q.filters.requested_by
      ? { data: [DONE], error: null }
      : { data: [], error: null });

    const out = await Browse.myRenders('teacher-1');

    expect(out.map((r) => r.id)).toEqual(['r1']);
  });

  test('a lesson she both started and waited on is listed once, not twice', async () => {
    // In flight, she is on BOTH sides: requester and (via the atomic self-append) a waiter.
    responder = () => ({ data: [{ ...DONE, status: 'authoring' }], error: null });

    const out = await Browse.myRenders('teacher-1');

    expect(out).toHaveLength(1);
  });
});
