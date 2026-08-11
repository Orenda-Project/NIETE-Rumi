/**
 * bd-2531 — STEPS "S" score reads. THE documented entry point for s_pct.
 *
 * WHY THIS FILE EXISTS: the score is computed by a Postgres VIEW
 * (v_supervisor_remark_scores, defined in V1.1.0__supervisor_remarks.sql), so
 * one definition serves every reader — the export worker, the portal, an
 * analyst in psql — and none of them can forget the two safety rules.
 *
 * But a view is INVISIBLE to grep: `SELECT ... FROM v_supervisor_remark_scores`
 * reads exactly like a table, so the next agent looking for "where is s_pct
 * calculated?" finds nothing in JS and writes their own SUM. Then there are two
 * formulas and no error. This accessor is the fix: callers use these functions,
 * grep finds these functions, and these functions name the view.
 *
 * DO NOT compute s_score/s_pct anywhere else. If you need it in JS before a row
 * is persisted (e.g. the review screen), use remark-rubric.js :: computeS(),
 * which enforces the identical rules and throws on a partial.
 *
 * The view guarantees, by construction:
 *   * only submitted remarks appear (submitted_at IS NOT NULL)
 *   * only fully-answered remarks appear (all 5 indicators)
 * so an absent row means "no score yet" — never "a low score".
 */

// config/supabase exports the client itself (module.exports = supabase), NOT
// a { supabase } object — destructuring here yields undefined at call time.
const supabase = require('../../config/supabase');

const VIEW = 'v_supervisor_remark_scores';

// The flat sub-score columns STEPS consumes (design spec §8). Kept in the same
// order as remark-rubric.js INDICATORS so the two read alike side by side.
const SCORE_COLUMNS = [
  'score_growth',
  'score_collaboration',
  'score_leadership',
  'score_student_support',
  'score_parents',
];

const BASE_SELECT = [
  'remark_id', 'cycle_id', 'teacher_id', 'principal_user_id', 'school_id',
  'submitted_at', ...SCORE_COLUMNS, 's_score', 's_pct',
].join(', ');

/**
 * One teacher's score for one cycle.
 * @returns {Promise<object|null>} null when not submitted or not yet complete —
 *   the caller must treat null as "no score", NEVER as zero.
 */
async function getTeacherScore(teacherId, cycleId) {
  const { data, error } = await supabase
    .from(VIEW)
    .select(BASE_SELECT)
    .eq('teacher_id', teacherId)
    .eq('cycle_id', cycleId)
    .maybeSingle();
  if (error) throw new Error(`remark-score: getTeacherScore failed — ${error.message}`);
  return data || null;
}

/**
 * Every completed score in a cycle — the nightly STEPS export's source.
 * Partials are absent by construction, so the exporter needs no filter of its own.
 */
async function getCycleScores(cycleId) {
  const { data, error } = await supabase
    .from(VIEW)
    .select(BASE_SELECT)
    .eq('cycle_id', cycleId);
  if (error) throw new Error(`remark-score: getCycleScores failed — ${error.message}`);
  return data || [];
}

/**
 * A principal's school-wide view for one cycle (her copy — scores included).
 */
async function getPrincipalScores(principalUserId, cycleId) {
  const { data, error } = await supabase
    .from(VIEW)
    .select(BASE_SELECT)
    .eq('principal_user_id', principalUserId)
    .eq('cycle_id', cycleId);
  if (error) throw new Error(`remark-score: getPrincipalScores failed — ${error.message}`);
  return data || [];
}

module.exports = {
  VIEW,
  SCORE_COLUMNS,
  getTeacherScore,
  getCycleScores,
  getPrincipalScores,
};
