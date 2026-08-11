/**
 * bd-2531 — evaluation cycles + a principal's roster and progress.
 *
 * THE resume mechanism lives here. There is no session table: a principal's
 * position in her quarterly work is DERIVED from the rows she has already
 * written — her teachers, minus the ones with a submitted remark, and for the
 * in-progress one, the indicators already scored.
 *
 * That is why she can be interrupted mid-rubric, switch to another flow, come
 * back on a different device a week later, and land exactly where she stopped:
 * the answer is recomputed from facts rather than remembered. Interruption is
 * the normal case, not an error path — no expiry, no cleanup job, no "session
 * timed out".
 */

const { INDICATOR_COUNT } = require('./remark-rubric');

// config/supabase calls process.exit(78) without env vars — lazy-require so a
// test importing the pure helpers does not kill the process. (Third sighting
// of this trap in this feature; see capability.js and remark-narrative.)
function db() {
  return require('../../config/supabase');
}

/**
 * The cycle containing NOW — never asked of the principal.
 *
 * Unambiguous ONLY because overlapping cycles are impossible at the storage
 * layer (the btree_gist EXCLUDE in V1.1.0__supervisor_remarks.sql). Bounds are
 * half-open [starts_at, ends_at): the instant one cycle ends the next begins,
 * and exactly one contains any moment.
 *
 * null means "no cycle open" — which is the same condition as "no permission
 * to remark right now", by design.
 */
async function getActiveCycle(now = new Date()) {
  const iso = now.toISOString();
  const { data, error } = await db()
    .from('evaluation_cycles')
    .select('id, name, starts_at, ends_at')
    .lte('starts_at', iso)
    .gt('ends_at', iso)        // exclusive end — adjacent cycles never both match
    .maybeSingle();
  if (error) throw new Error(`remark-cycle: getActiveCycle failed — ${error.message}`);
  return data || null;
}

/**
 * The teachers of this principal's school.
 * Scoped by school_id: a principal only ever sees her own school (spec §9).
 */
async function listSchoolTeachers(principal) {
  if (!principal || !principal.school_id) return [];
  const { data, error } = await db()
    .from('users')
    .select('id, first_name, phone_number, preferred_language')
    .eq('school_id', principal.school_id)
    .eq('role', 'teacher')
    .order('first_name', { ascending: true });
  if (error) throw new Error(`remark-cycle: listSchoolTeachers failed — ${error.message}`);
  return data || [];
}

/**
 * Turn raw rows into per-teacher progress. Pure, so the derivation is testable
 * without a database.
 *
 * @param {Array<{id,teacher_id,submitted_at}>} remarks
 * @param {Array<{remark_id,indicator_ordinal}>} scores
 * @returns {Object<string, {state:'done'|'in_progress', answered:number, remarkId:string, resumeAt:number|null}>}
 */
function deriveProgress(remarks, scores) {
  const byRemark = new Map();
  for (const s of scores || []) {
    if (!byRemark.has(s.remark_id)) byRemark.set(s.remark_id, new Set());
    byRemark.get(s.remark_id).add(s.indicator_ordinal);
  }
  const out = {};
  for (const r of remarks || []) {
    const answered = byRemark.get(r.id) || new Set();
    // Comment state is THREE-valued and nextStep() branches on it:
    //   NULL → not asked yet        (offer the comment step)
    //   ''   → asked and SKIPPED    (spec §10: comment is optional)
    //   text → written              (go to review)
    // saveComment writes '' deliberately for a skip so "skipped" is
    // distinguishable from "not asked". Collapsing the two here made REVIEW —
    // and therefore SUBMIT — unreachable (caught by the staging E2E, not units).
    const hasComment = typeof r.comment_text === 'string' && r.comment_text.trim().length > 0;
    const commentSkipped = typeof r.comment_text === 'string' && r.comment_text.trim().length === 0;
    if (r.submitted_at) {
      out[r.teacher_id] = {
        state: 'done', answered: answered.size, remarkId: r.id, resumeAt: null,
        hasComment, commentSkipped,
      };
    } else {
      // Resume at the first UNANSWERED ordinal — not max+1, which would skip a
      // gap if she jumped around or an earlier write failed.
      let resumeAt = null;
      for (let i = 1; i <= INDICATOR_COUNT; i += 1) {
        if (!answered.has(i)) { resumeAt = i; break; }
      }
      out[r.teacher_id] = {
        state: 'in_progress', answered: answered.size, remarkId: r.id, resumeAt,
        hasComment, commentSkipped,
      };
    }
  }
  // A teacher with no remark row is absent from this map — the caller renders
  // that as "not started". Absence is the third state; it needs no row.
  return out;
}

/**
 * Where is this principal, right now, in this cycle?
 */
async function getProgress(principalUserId, cycleId) {
  const { data: remarks, error } = await db()
    .from('supervisor_remarks')
    // comment_text is REQUIRED here — deriveProgress derives the three-valued
    // comment state from it, and nextStep cannot reach REVIEW without it.
    .select('id, teacher_id, submitted_at, comment_text')
    .eq('principal_user_id', principalUserId)
    .eq('cycle_id', cycleId);
  if (error) throw new Error(`remark-cycle: getProgress failed — ${error.message}`);
  if (!remarks || remarks.length === 0) return {};

  const { data: scores, error: sErr } = await db()
    .from('supervisor_remark_scores')
    .select('remark_id, indicator_ordinal')
    .in('remark_id', remarks.map((r) => r.id));
  if (sErr) throw new Error(`remark-cycle: getProgress scores failed — ${sErr.message}`);

  return deriveProgress(remarks, scores);
}

module.exports = {
  getActiveCycle,
  listSchoolTeachers,
  deriveProgress,
  getProgress,
};
