/**
 * bd-60119 — I-SAPS lists MODULES, then units inside one.
 *
 * The level screen's dropdown is filled by the server with {id, title,
 * description} rows, and it was handed every module in the level: for I-SAPS
 * that is 54 units in one flat list, with the module name demoted to a
 * subtitle. The I-SAPS structure is 9 modules, each holding its own units and
 * its own end-of-module assessment, so the teacher should pick a module first.
 *
 * WHY THIS IS DONE SERVER-SIDE, with no Flow change: the Flow is SHARED by
 * every vendor and a published Flow's JSON cannot be edited in place — a new
 * screen would mean re-publishing to Meta and would touch NIETE, Beacon House
 * and Oxbridge. But nothing requires a dropdown row's id to be a module id. So
 * for I-SAPS the same screen is re-entered with course rows carrying a `c:`
 * prefix, and the server branches on it.
 *
 * Every helper here is therefore gated on the vendor. The tests that matter
 * most are the ones proving the OTHER vendors are untouched.
 */

const {
  COURSE_ROW_PREFIX,
  isCourseRowId,
  courseRowId,
  parseCourseRowId,
  usesModuleScopedListing,
  buildCourseRows,
} = require('../../bot/shared/services/training/isaps-listing.rules');

describe('bd-60119 — vendor gating', () => {
  test('only I-SAPS uses the module-then-unit listing', () => {
    expect(usesModuleScopedListing('ISAPS')).toBe(true);
    expect(usesModuleScopedListing('isaps')).toBe(true);
  });

  test('every other vendor keeps the flat listing exactly as before', () => {
    expect(usesModuleScopedListing('TALEEMABAD')).toBe(false);
    expect(usesModuleScopedListing('BEACONHOUSE')).toBe(false);
    expect(usesModuleScopedListing('OXBRIDGE')).toBe(false);
    expect(usesModuleScopedListing('')).toBe(false);
    expect(usesModuleScopedListing(null)).toBe(false);
    expect(usesModuleScopedListing(undefined)).toBe(false);
  });
});

describe('bd-60119 — course row ids', () => {
  test('a course row id is distinguishable from a module row id', () => {
    expect(courseRowId(12)).toBe(`${COURSE_ROW_PREFIX}12`);
    expect(isCourseRowId(courseRowId(12))).toBe(true);
    // A bare numeric id is a MODULE id and must never be read as a course.
    expect(isCourseRowId('385')).toBe(false);
    expect(isCourseRowId(385)).toBe(false);
  });

  test('round-trips back to the numeric course id', () => {
    expect(parseCourseRowId(courseRowId(7))).toBe(7);
    expect(parseCourseRowId('c:123')).toBe(123);
  });

  test('a malformed course id yields null rather than a NaN lookup', () => {
    expect(parseCourseRowId('c:')).toBeNull();
    expect(parseCourseRowId('c:abc')).toBeNull();
    expect(parseCourseRowId('385')).toBeNull();
    expect(parseCourseRowId(null)).toBeNull();
    expect(parseCourseRowId('')).toBeNull();
  });

  test('never collides with a module id that happens to start with c', () => {
    expect(isCourseRowId('course-12')).toBe(false);
    expect(isCourseRowId('c12')).toBe(false);
  });
});

describe('bd-60119 — buildCourseRows', () => {
  const COURSES = [
    { id: 11, title: 'Module 1 - Philosophical Foundations', total: 6, done: 6 },
    { id: 12, title: 'Module 2 - Affective Development', total: 8, done: 3 },
    { id: 13, title: 'Module 3 - Classroom Management', total: 3, done: 0 },
  ];

  test('one row per module, not per unit', () => {
    const rows = buildCourseRows(COURSES);
    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe('c:11');
  });

  test('each row shows that module\'s own unit progress', () => {
    const rows = buildCourseRows(COURSES);
    expect(rows[0].description).toMatch(/6\/6/);
    expect(rows[1].description).toMatch(/3\/8/);
    expect(rows[2].description).toMatch(/0\/3/);
  });

  test('a finished module is marked as complete', () => {
    const rows = buildCourseRows(COURSES);
    expect(rows[0].description).toMatch(/complete/i);
    expect(rows[1].description).not.toMatch(/complete/i);
  });

  test('titles stay inside the WhatsApp row-title cap of 24 characters', () => {
    for (const r of buildCourseRows(COURSES)) {
      expect([...r.title].length).toBeLessThanOrEqual(24);
    }
  });

  test('a long module name is truncated, not dropped', () => {
    const rows = buildCourseRows([
      { id: 9, title: 'Module 9 - An Extremely Long Module Name That Will Not Fit', total: 2, done: 0 },
    ]);
    expect(rows[0].title.length).toBeGreaterThan(0);
    expect([...rows[0].title].length).toBeLessThanOrEqual(24);
  });

  test('no courses yields no rows rather than throwing', () => {
    expect(buildCourseRows([])).toEqual([]);
    expect(buildCourseRows(null)).toEqual([]);
  });
});
