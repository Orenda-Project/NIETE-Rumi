/**
 * The CLASS screen costs a CONSTANT number of queries. (bd-2728)
 *
 * Reported: "/attendance takes quite a bit of time to load the classes, like 15-20
 * seconds". Measured against live staging with 3 classes: 8 sequential queries,
 * ~2s inside Railway and ~7s from a laptop —
 *
 *   users -> student_lists -> (class_enrollments -> students) x N
 *
 * i.e. 2 + 2N round trips, each waiting on the last, purely to render "3 students"
 * or "No students yet" beside each class. At 20 classes — the case the Dropdown was
 * introduced to support — that is 42 serial round trips.
 *
 * Worse, it fetched every roster in FULL to display a count.
 *
 * So the count is now two bulk reads keyed by the whole id set, and the guard is
 * that adding classes must not add queries. A per-class query is the kind of thing
 * that creeps back in one innocent `await` at a time, and it is invisible in tests
 * that only assert output.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const marking = require('../../bot/shared/routes/attendance-marking-endpoint');

let queries;

function builder(rows) {
  const p = Promise.resolve({ data: rows, error: null });
  p.eq = () => builder(rows);
  p.in = () => builder(rows);
  p.order = () => builder(rows);
  p.limit = (n) => builder(rows.slice(0, n));
  p.maybeSingle = () => Promise.resolve({ data: rows[0] || null, error: null });
  return p;
}

/** @param {number} n how many classes the teacher holds */
function db(n, { enrolled = {}, legacy = {} } = {}) {
  const lists = Array.from({ length: n }, (_, i) => ({
    id: `l${i}`, class_name: `Grade ${i + 1}`, section: 'A', class_id: `c${i}`,
  }));
  queries = [];
  mockSupabase.from.mockImplementation((table) => {
    queries.push(table);
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { id: 't1', role: 'teacher' }, error: null }),
            eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
          }),
        }),
      };
    }
    if (table === 'student_lists') {
      return {
        select: () => ({
          eq: (col, val) => ({
            eq: () => ({ order: () => Promise.resolve({ data: lists, error: null }) }),
            maybeSingle: () => Promise.resolve({ data: lists.find((l) => l.id === val) || null, error: null }),
          }),
        }),
      };
    }
    if (table === 'class_enrollments') {
      const rows = Object.entries(enrolled).flatMap(([cid, k]) =>
        Array.from({ length: k }, (_, j) => ({ class_id: cid, student_id: `${cid}-s${j}` })));
      return { select: () => builder(rows) };
    }
    if (table === 'students') {
      const rows = Object.entries(legacy).flatMap(([lid, k]) =>
        Array.from({ length: k }, (_, j) => ({ id: `${lid}-s${j}`, list_id: lid, student_name: `S${j}` })));
      return { select: () => builder(rows) };
    }
    return {};
  });
  return lists;
}

beforeEach(() => jest.clearAllMocks());

describe('query cost does not scale with class count', () => {
  it('costs the same for 20 classes as for 1', async () => {
    db(1);
    await marking.handleMarkingInit('t1');
    const one = queries.length;

    db(20);
    await marking.handleMarkingInit('t1');
    const twenty = queries.length;

    expect(twenty).toBe(one);
    // A small constant, not 2 + 2N. 3 classes used to cost 8.
    expect(twenty).toBeLessThanOrEqual(5);
  });

  it('never queries class_enrollments or students more than once', async () => {
    db(20);
    await marking.handleMarkingInit('t1');

    expect(queries.filter((q) => q === 'class_enrollments')).toHaveLength(1);
    expect(queries.filter((q) => q === 'students')).toHaveLength(1);
  });
});

describe('the counts are still right', () => {
  it('prefers enrollment counts, exactly as the roster read does', async () => {
    db(2, { enrolled: { c0: 3 }, legacy: { l0: 99, l1: 4 } });

    const res = await marking.handleMarkingInit('t1');

    const byId = new Map(res.data.classes.map((c) => [c.id, c.description]));
    // c0 has enrollments, so the stale legacy 99 must be ignored.
    expect(byId.get('student:l0')).toMatch(/3 students/);
    // l1 has no enrollments, so it falls back to legacy.
    expect(byId.get('student:l1')).toMatch(/4 students/);
  });

  it('says "no students yet" when both sources are empty', async () => {
    db(1);
    const res = await marking.handleMarkingInit('t1');
    expect(res.data.classes[0].description).toMatch(/no students/i);
  });
});
