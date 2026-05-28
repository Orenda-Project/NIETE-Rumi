/**
 * Centralized scoring constants for classroom coaching reports.
 *
 * OECD constants exported directly for backward compat with the OECD
 * framework module + the legacy PDFKit reporter. Other frameworks own their
 * own constants (e.g. MEWAKA's MAX_MARKS = 75 lives inside mewaka-framework.js).
 *
 * Strictly a data module — no requires of framework-registry or any framework
 * module. This file used to expose `getFrameworkMaxMarks` and
 * `getFrameworkDisplayName` helpers that lazy-required the framework registry,
 * creating a conceptual cycle (constants → registry → framework → constants).
 * Both helpers had zero callers and were removed.
 */

// ─── OECD-specific constants (backward compat) ───────────────────────

const CLASSROOM_MARKS_BASE = 103; // Existing rubric without lesson plan criteria
const LP_CRITERIA_MARKS = 14;     // Additional marks unlocked when LP is available
const CLASSROOM_MARKS_WITH_LP = CLASSROOM_MARKS_BASE + LP_CRITERIA_MARKS;
const DEBRIEF_MARKS = 15;
const PRIOR_FEEDBACK_MARKS = 5;

module.exports = {
  CLASSROOM_MARKS_BASE,
  LP_CRITERIA_MARKS,
  CLASSROOM_MARKS_WITH_LP,
  DEBRIEF_MARKS,
  PRIOR_FEEDBACK_MARKS,
};
