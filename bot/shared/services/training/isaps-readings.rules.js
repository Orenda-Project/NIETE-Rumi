/**
 * I-SAPS required reading — the partner's per-module reading list.
 *
 * Source: I-SAPS "Level 1 Reading Material (Mandatory)" (2026-10-08, after FDE
 * feedback), transcribed into isaps-readings.data.json: 13 readings, each with
 * the SECTION to read, a rationale and the outcome ("teachers will be able
 * to …"). It replaced the Sept 2026 recommended list of 95; the partner's
 * supplementary readings go to teachers as a Word document, not through here
 * (bd-klecr.9). It is static partner material that changes when the partner
 * sends a new document, so it ships as reviewed data with the code rather than
 * as a new table (schema-first / anti-sprawl: no existing training table has a
 * place for it, and nothing queries it).
 *
 * A course is matched by vendor NAME + level order_index + the "Module N" in
 * its title, never by numeric id: sandbox, staging and production each seeded
 * their own training rows, so the ids differ. The module-exam gate reads the
 * module number off the title the same way (internal-api module-exam-gate).
 *
 * Mandatory in the partner's words, but nothing is gated on it (operator,
 * 2026-10-08): it is shown as "Required reading" and counts toward nothing.
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
 *   http(s) url; `unavailable` ones (no free copy yet) carry url null and are
 *   still named so a teacher can look for them. Each item: title, author, type,
 *   section (what to read), rationale, outcome, url — and description, which
 *   older screens read, equal to the rationale.
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
    section: r.section || '',
    rationale: r.rationale || '',
    outcome: r.outcome || '',
    description: r.description || r.rationale || '',
    url: typeof r.url === 'string' && /^https?:\/\//.test(r.url) ? r.url : null,
  });
  const all = rows.map(shape);
  return {
    available: all.filter(r => r.url !== null),
    unavailable: all.filter(r => r.url === null),
  };
}

module.exports = { readingsForCourse };
