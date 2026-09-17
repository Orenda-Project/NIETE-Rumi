/**
 * bd-60119 — I-SAPS lists MODULES first, then the units inside one.
 *
 * The level screen's dropdown was handed every module in the level. For NIETE
 * and the partner vendors that is a handful of rows; for I-SAPS it is 54 units
 * in one flat list with the module name demoted to a subtitle, which is not
 * the structure the content has. I-SAPS is 9 modules, each holding its own
 * units and its own end-of-module assessment.
 *
 * WHY THIS IS A SERVER-SIDE BRANCH AND NOT A NEW FLOW SCREEN
 * ---------------------------------------------------------
 * One Flow serves every vendor, and a published Flow's JSON cannot be edited
 * in place (.claude/skills/whatsapp-flows) — adding a screen means
 * re-publishing to Meta and changing TEACHER_TRAINING_FLOW_ID, which would
 * touch NIETE, Beacon House and Oxbridge for a change none of them asked for.
 *
 * But a dropdown row is just {id, title, description} that the SERVER fills,
 * and nothing requires the id to be a module id. So for I-SAPS the same screen
 * is re-entered carrying course rows, tagged with a prefix the server
 * recognises. No Flow change, no re-publish, and every other vendor runs the
 * path it ran before.
 *
 * Every export here is gated on the vendor key for that reason.
 */

/**
 * Marks a dropdown row as a COURSE rather than a module.
 *
 * A module row id is the bare numeric `training_modules.id`, so the prefix has
 * to be something a number can never produce. The colon is deliberate: `c12`
 * would collide with nothing today but reads as ambiguous, and a future id
 * scheme could produce it.
 */
const COURSE_ROW_PREFIX = 'c:';

/** WhatsApp caps an interactive row title at 24 characters. */
const ROW_TITLE_MAX = 24;

/**
 * Does this vendor use the module-then-unit listing?
 *
 * ONLY I-SAPS. Every other vendor keeps the flat list it has always had —
 * this is the guard that makes the change safe to ship without re-testing
 * three other trainings.
 *
 * @param {string|null} vendorKey
 * @returns {boolean}
 */
function usesModuleScopedListing(vendorKey) {
  return String(vendorKey || '').trim().toUpperCase() === 'ISAPS';
}

/**
 * @param {number|string} courseId training_courses.id
 * @returns {string}
 */
function courseRowId(courseId) {
  return `${COURSE_ROW_PREFIX}${courseId}`;
}

/**
 * @param {string|number|null} rowId
 * @returns {boolean}
 */
function isCourseRowId(rowId) {
  return typeof rowId === 'string' && rowId.startsWith(COURSE_ROW_PREFIX);
}

/**
 * The numeric course id behind a course row, or null.
 *
 * Returns null rather than NaN for anything malformed: a NaN would reach a
 * database lookup and fail far from the cause.
 *
 * @param {string|number|null} rowId
 * @returns {number|null}
 */
function parseCourseRowId(rowId) {
  if (!isCourseRowId(rowId)) return null;
  const raw = rowId.slice(COURSE_ROW_PREFIX.length);
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Fit a title to the row cap, keeping a visible ellipsis when it is cut. */
function fitTitle(title) {
  const chars = [...String(title || '')];
  if (chars.length <= ROW_TITLE_MAX) return chars.join('');
  return `${chars.slice(0, ROW_TITLE_MAX - 1).join('')}…`;
}

/**
 * One dropdown row per MODULE, carrying that module's own unit progress.
 *
 * @param {Array<{id:number, title:string, total:number, done:number}>} courses
 * @returns {Array<{id:string, title:string, description:string}>}
 */
function buildCourseRows(courses) {
  if (!Array.isArray(courses)) return [];
  return courses.map((c) => {
    const total = Number(c.total) || 0;
    const done = Number(c.done) || 0;
    const complete = total > 0 && done >= total;
    return {
      id: courseRowId(c.id),
      title: fitTitle(c.title),
      description: complete
        ? `${done}/${total} units · ✓ Complete`
        : `${done}/${total} units`,
    };
  });
}

module.exports = {
  COURSE_ROW_PREFIX,
  ROW_TITLE_MAX,
  usesModuleScopedListing,
  courseRowId,
  isCourseRowId,
  parseCourseRowId,
  buildCourseRows,
};
