/**
 * I-SAPS recommended reading — the partner's per-module reading list.
 *
 * Source: I-SAPS "Reading Resources Level 1" (Sept 2026), transcribed into
 * isaps-readings.data.json. It is static partner material — 95 rows that change
 * when the partner sends a new document — so it ships as reviewed data with the
 * code rather than as a new table (schema-first / anti-sprawl: no existing
 * training table has a place for it, and nothing queries it).
 *
 * A course is matched by vendor NAME + level order_index + the "Module N" in
 * its title, never by numeric id: sandbox, staging and production each seeded
 * their own training rows, so the ids differ. The module-exam gate reads the
 * module number off the title the same way (internal-api module-exam-gate).
 *
 * Optional material. It gates nothing and counts toward nothing.
 */

const DATA = require('./isaps-readings.data.json');

const MODULE_IN_TITLE = /Module (\d+)/;

/**
 * @param {object} args
 * @param {string} args.vendorName     training_vendors.name
 * @param {number} args.levelOrderIndex training_levels.order_index
 * @param {string} args.courseTitle    training_courses.title
 * @returns {null|{available: object[], unavailable: object[]}}
 *   null when this course has no reading list. `available` items carry an
 *   http(s) url; `unavailable` ones (no free copy yet, per the partner) carry
 *   url null and are still named so a teacher can look for them.
 */
function readingsForCourse({ vendorName, levelOrderIndex, courseTitle } = {}) {
  if (vendorName !== DATA.vendor) return null;
  const level = DATA.levels[String(levelOrderIndex)];
  if (!level) return null;
  const m = MODULE_IN_TITLE.exec(courseTitle || '');
  if (!m) return null;
  const rows = level[String(parseInt(m[1], 10))];
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const shape = r => ({
    title: r.title,
    author: r.author || '',
    type: r.type || '',
    description: r.description || '',
    url: typeof r.url === 'string' && /^https?:\/\//.test(r.url) ? r.url : null,
  });
  const all = rows.map(shape);
  return {
    available: all.filter(r => r.url !== null),
    unavailable: all.filter(r => r.url === null),
  };
}

module.exports = { readingsForCourse };
