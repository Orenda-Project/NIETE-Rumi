/**
 * bd-2531 — submit a Supervisor Remark and deliver its two outputs.
 *
 * ONE evaluation event, TWO audiences:
 *   * the TEACHER gets the coaching narrative, in HER language, with no scores;
 *   * the PRINCIPAL gets a copy WITH the five scores and S_pct.
 *
 * ── The ordering contract (design spec §6/§10) ─────────────────────────────
 *   1. scores + submitted_at persist       ← durable; must never be lost
 *   2. narrative generated                 ← may fail (LLM)
 *   3. narrative delivered                 ← may fail (WhatsApp 24h window)
 *
 * "A submission is never lost to an LLM error." A principal who spent ten
 * minutes scoring a teacher must not see that work vanish because an upstream
 * model returned a 503. So this function does NOT throw on a generation or
 * delivery failure: it persists, records how far it got, tells the principal
 * "saved — feedback sending", and leaves the remark retriable.
 *
 * ── Why there is no jobs table ─────────────────────────────────────────────
 * `coaching_jobs` exists in the schema with full retry/attempt machinery — and
 * NOTHING processes it (zero non-DDL references in the tree). The LIVE pattern
 * here is workers/stale-session.worker.js: a cron that SWEEPS A TABLE BY STATUS.
 *
 * supervisor_remarks already carries narrative_generated_at / narrative_sent_at,
 * so the queue needs no storage of its own — "submitted but not yet delivered"
 * IS the queue, derived the same way a principal's in-progress position is
 * derived from her score rows. One less table, one less thing to drift, and a
 * crashed process cannot lose a job it never wrote down.
 */

const { logToFile } = require('../../utils/logger');
const { computeS } = require('./remark-rubric');

/** Why a swept remark needs work. */
const PENDING_REASON = Object.freeze({
  GENERATE: 'generate',   // submitted, narrative never produced
  DELIVER: 'deliver',     // narrative exists, teacher never reached
});

/**
 * Which submitted remarks still owe the teacher something?
 *
 * Pure and row-driven so the cron worker stays a thin shell around it (and so
 * this is testable without a database).
 *
 * @param {Array<object>} rows supervisor_remarks rows
 * @returns {Array<{id: string, reason: string}>}
 */
function findPendingNarratives(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    // An UNSUBMITTED remark is not a queue entry. This exclusion is the most
    // important line in the file: a principal mid-rubric must never have a
    // narrative generated and fired at her teacher.
    if (!r || !r.submitted_at) continue;
    if (r.narrative_sent_at) continue;                       // done
    if (r.narrative_generated_at && r.narrative_text) {
      out.push({ id: r.id, reason: PENDING_REASON.DELIVER }); // don't re-generate
    } else {
      out.push({ id: r.id, reason: PENDING_REASON.GENERATE });
    }
  }
  return out;
}

/**
 * The teacher's language wins over the form's.
 * Spec §2: feedback is delivered "in the teacher's language (fallback to form
 * language)" — a principal may fill the form in English for a teacher who
 * reads Urdu. NEVER `user.language` (dead column); `preferred_language` only.
 */
function resolveTeacherLanguage(teacher, formLanguage) {
  return (teacher && teacher.preferred_language) || formLanguage || 'en';
}

/**
 * Submit a remark: persist, generate, deliver.
 *
 * Never throws for a generation/delivery failure — the caller renders the
 * returned flags. It DOES propagate a persistence failure, because if step 1
 * failed there is nothing to be optimistic about.
 *
 * @returns {Promise<{saved: boolean, narrativePending: boolean, deliveryPending: boolean}>}
 */
async function submitRemark({ remark, formLanguage = 'en' }, deps) {
  const {
    persistSubmission, loadScores, loadTeacher, generateNarrative,
    sendToTeacher, sendToPrincipal, markNarrative,
  } = deps;

  // ─ 1. Durable first. A throw here is real: nothing was saved. ─
  const saved = await persistSubmission(remark);

  const scores = await loadScores(remark.id);
  const teacher = await loadTeacher(remark.teacher_id);
  const language = resolveTeacherLanguage(teacher, formLanguage);
  // The principal's copy carries the numbers; computeS throws on a partial, so
  // an incomplete rubric cannot reach either audience.
  const { s_score, s_pct } = computeS(scores);

  // ─ 2. Generate. Failure is EXPECTED occasionally, not exceptional. ─
  let narrative = null;
  try {
    narrative = await generateNarrative({
      scores,
      comment: remark.comment_text || '',
      teacherName: (teacher && teacher.first_name) || 'Teacher',
      language,
    });
    await markNarrative(remark.id, {
      narrative_text: JSON.stringify(narrative),
      narrative_generated_at: new Date().toISOString(),
    });
  } catch (err) {
    // Includes a scrubScores rejection — a narrative that leaked a score is a
    // FAILURE, never something to send raw.
    logToFile('⚠️ remark: narrative generation failed — queued for retry', {
      remarkId: remark.id, error: err.message,
    });
    await sendToPrincipal({
      remarkId: remark.id, teacherId: remark.teacher_id,
      scores, s_score, s_pct, narrativePending: true,
    });
    return { saved: !!saved, narrativePending: true, deliveryPending: false };
  }

  // ─ 3. Deliver. The teacher's copy carries NO numbers. ─
  let deliveryPending = false;
  try {
    await sendToTeacher({ teacher, narrative, language });
    await markNarrative(remark.id, { narrative_sent_at: new Date().toISOString() });
  } catch (err) {
    // Spec §10: stored + web-viewable, delivery marked pending. Deliberately
    // NOT re-generated on retry — that would burn an LLM call and could hand
    // the teacher different words for the same evaluation.
    logToFile('⚠️ remark: teacher delivery failed — narrative stored, retry queued', {
      remarkId: remark.id, error: err.message,
    });
    deliveryPending = true;
  }

  // The principal always hears back, even when the teacher could not be reached.
  await sendToPrincipal({
    remarkId: remark.id, teacherId: remark.teacher_id,
    scores, s_score, s_pct, narrative, deliveryPending,
  });

  return { saved: !!saved, narrativePending: false, deliveryPending };
}

module.exports = {
  PENDING_REASON,
  findPendingNarratives,
  resolveTeacherLanguage,
  submitRemark,
};
