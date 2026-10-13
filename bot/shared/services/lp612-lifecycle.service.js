'use strict';
/**
 * Grades 6-12: one teacher's ask → its lesson-plan lifecycle row.
 *
 * The 6-12 lane sees an ask reach its outcome in three places — deliverRender (the one function
 * the cache hit and the worker's waiter loop both call), the requestLesson wrapper (outcomes that
 * end the ask there), and the worker's fail() — and all three record through this module, so the
 * three cannot drift on what a 6-12 row says. The writer itself is lesson-plan-lifecycle.service:
 * switched by LP_LIFECYCLE_PATHS, soft-fail, terminal rows only.
 *
 * A module of its own, rather than an export of lp612-serving: suites stand the worker up against a
 * PARTIAL double of lp612-serving, and a new export there would be missing from every such double.
 */

const Lifecycle = require('./lesson-plan-lifecycle.service');

const { SOURCES, ERROR_CODES } = Lifecycle.LIFECYCLE;
const SOURCE = SOURCES.NIETE_LP612;

/** grade_8_mathematics.c05.p071-073 → 8; anything else → null. */
function gradeOfSegmentId(segmentId) {
  const m = /^grade_(\d{1,2})_/.exec(String(segmentId || ''));
  return m ? Number(m[1]) : null;
}

/** grade_8_social_studies.c03.p010-012 → 'social_studies'; anything else → null. */
function subjectOfSegmentId(segmentId) {
  const m = /^grade_\d{1,2}_([a-z0-9_]+?)\.c\d/i.exec(String(segmentId || ''));
  return m ? m[1] : null;
}

function lessonTitle(segment) {
  return (segment && (segment.menu_title || segment.subtopic_title || segment.chapter_title)) || null;
}

/**
 * Record one teacher's 6-12 ask at its outcome. Soft-fail: resolves to the row id, or null (switched
 * off, not recordable, or the write failed). Never throws.
 */
function recordAsk({
  userId, phone, segment, segmentId, lang, status, askedAt, generatedAt, deliveredAt,
  errorCode, errorMessage, correlationId,
} = {}) {
  const segId = (segment && segment.segment_id) || segmentId || null;
  return Lifecycle.recordOutcome({
    userId,
    phone,
    status,
    errorCode,
    errorMessage,
    source: SOURCE,
    channel: Lifecycle.LIFECYCLE.CHANNELS.WHATSAPP,
    topic: lessonTitle(segment) || segId,
    grade: (segment && segment.grade) || gradeOfSegmentId(segId),
    subject: (segment && segment.subject) || subjectOfSegmentId(segId),
    artifactRef: segId,
    language: lang,
    askedAt,
    generatedAt,
    deliveredAt,
    correlationId,
  });
}

/** The lifecycle code for a render the worker failed with this error code. */
function codeForRenderError(code) {
  return code === 'RENDER_FAILED' ? ERROR_CODES.RENDER_FAILED : ERROR_CODES.GENERATION_FAILED;
}

/**
 * A render failed: one failed row per WhatsApp waiter the worker tells so. A portal waiter has no
 * phone (she reads the outcome off the row) and gets none. Resolves to the number of rows written;
 * never throws.
 */
async function recordWaitersFailed({ waiters, segment, segmentId, lang, code, detail } = {}) {
  if (!Lifecycle.enabled(SOURCE)) return 0;
  let written = 0;
  for (const w of waiters || []) {
    if (!w || !w.phone) continue;
    // Sequential on purpose: a handful of waiters at most, and the job is already in its failure path.
    // eslint-disable-next-line no-await-in-loop
    const id = await recordAsk({
      userId: w.user_id,
      phone: w.phone,
      segment,
      segmentId,
      lang,
      status: 'failed',
      askedAt: w.requested_at,
      errorCode: codeForRenderError(code),
      errorMessage: `${code || 'UNKNOWN'}: ${detail || ''}`,
      correlationId: w.correlation_id,
    });
    if (id) written += 1;
  }
  return written;
}

/** Outcomes of requestLesson that end the ask there and then, and the code each records. Delivery
 *  outcomes (cache_hit, deliver_failed) are recorded by deliverRender itself; queued/joined/retry
 *  asks are recorded when the worker reaches their outcome. */
const ENDS_THE_ASK = Object.freeze({
  not_found: ERROR_CODES.NO_ASSET,
  held: ERROR_CODES.NOT_ELIGIBLE,
  error: ERROR_CODES.GENERATION_FAILED,
});

/** Record a requestLesson outcome that ends a WhatsApp ask. Resolves to the row id or null. */
async function recordRequestOutcome({ req, outcome, result, askedAt } = {}) {
  const errorCode = ENDS_THE_ASK[outcome];
  if (!errorCode || !req || (req.surface || 'whatsapp') !== 'whatsapp' || !req.phone) return null;
  return recordAsk({
    userId: req.userId,
    phone: req.phone,
    segmentId: req.segmentId,
    lang: req.lang,
    status: 'failed',
    askedAt,
    errorCode,
    errorMessage: (result && result.error) || outcome,
    correlationId: req.correlationId,
  });
}

/** The fields a waiter entry carries for the lifecycle: her ask's log id. `{}` when switched off,
 *  so the entry is exactly the old shape. */
function waiterFields({ correlationId } = {}) {
  return Lifecycle.enabled(SOURCE) && correlationId ? { correlation_id: String(correlationId).slice(0, 200) } : {};
}

module.exports = {
  recordAsk,
  recordWaitersFailed,
  recordRequestOutcome,
  waiterFields,
};
