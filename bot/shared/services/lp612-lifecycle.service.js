'use strict';
/**
 * Grades 6-12: one teacher's ask → its lesson-plan lifecycle row, on WhatsApp or in the portal.
 *
 * The 6-12 lane sees an ask reach its outcome in these places — deliverRender (the one function
 * the WhatsApp cache hit and the worker's waiter loop both call), the portal cache hit and the
 * worker's portal waiters (recordPortalReady: the lesson is ready in her portal), the requestLesson
 * wrapper (outcomes that end the ask there), and the worker's fail() — and all of them record through
 * this module, so they cannot drift on what a 6-12 row says. The writer itself is
 * lesson-plan-lifecycle.service: switched by LP_LIFECYCLE_PATHS, soft-fail, terminal rows only.
 *
 * A PORTAL ask (the portal and the teacher app) carries her id and no phone; the writer reads the
 * phone from users. Its channel is 'portal', and it is delivered when the lesson is ready in her
 * portal — the portal serves it on her next poll, the way a WhatsApp ask is delivered when Meta took
 * the document.
 *
 * A module of its own, rather than an export of lp612-serving: suites stand the worker up against a
 * PARTIAL double of lp612-serving, and a new export there would be missing from every such double.
 */

const Lifecycle = require('./lesson-plan-lifecycle.service');

const { SOURCES, ERROR_CODES, CHANNELS } = Lifecycle.LIFECYCLE;
const SOURCE = SOURCES.NIETE_LP612;

/** The portal and the teacher app park a waiter / an ask with surface 'portal' and no phone. */
const isPortal = (surface) => surface === 'portal';

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
  errorCode, errorMessage, correlationId, channel = CHANNELS.WHATSAPP,
} = {}) {
  const segId = (segment && segment.segment_id) || segmentId || null;
  return Lifecycle.recordOutcome({
    userId,
    phone,
    status,
    errorCode,
    errorMessage,
    source: SOURCE,
    channel,
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

/**
 * A PORTAL ask whose lesson is ready for her — at the cache hit (it already existed: generated when
 * she asked) or when the worker finished it (generated = ready). Ready in her portal is delivered:
 * the portal serves it on her next poll. Resolves to the row id or null; never throws.
 */
function recordPortalReady({ userId, segment, segmentId, lang, askedAt, generatedAt, readyAt, correlationId } = {}) {
  return recordAsk({
    userId,
    segment,
    segmentId,
    lang,
    status: 'completed',
    channel: CHANNELS.PORTAL,
    askedAt,
    generatedAt,
    deliveredAt: readyAt || new Date().toISOString(),
    correlationId,
  });
}

/** The lifecycle code for a render the worker failed with this error code. */
function codeForRenderError(code) {
  return code === 'RENDER_FAILED' ? ERROR_CODES.RENDER_FAILED : ERROR_CODES.GENERATION_FAILED;
}

/**
 * A render failed: one failed row per waiter — a WhatsApp waiter (the worker tells her so) and a
 * portal waiter (she reads it off her next poll; channel portal, her phone read from users).
 * Resolves to the number of rows written; never throws.
 */
async function recordWaitersFailed({ waiters, segment, segmentId, lang, code, detail } = {}) {
  if (!Lifecycle.enabled(SOURCE)) return 0;
  let written = 0;
  for (const w of waiters || []) {
    if (!w || !w.user_id) continue;
    const portal = isPortal(w.surface);
    if (!portal && !w.phone) continue;
    // Sequential on purpose: a handful of waiters at most, and the job is already in its failure path.
    // eslint-disable-next-line no-await-in-loop
    const id = await recordAsk({
      userId: w.user_id,
      phone: portal ? null : w.phone,
      channel: portal ? CHANNELS.PORTAL : CHANNELS.WHATSAPP,
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

/** Record a requestLesson outcome that ends an ask — WhatsApp or portal. Resolves to the row id or null. */
async function recordRequestOutcome({ req, outcome, result, askedAt } = {}) {
  const errorCode = ENDS_THE_ASK[outcome];
  if (!errorCode || !req) return null;
  const surface = req.surface || 'whatsapp';
  const portal = isPortal(surface);
  if (portal ? !req.userId : (surface !== 'whatsapp' || !req.phone)) return null;
  return recordAsk({
    userId: req.userId,
    phone: portal ? null : req.phone,
    channel: portal ? CHANNELS.PORTAL : CHANNELS.WHATSAPP,
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
  recordPortalReady,
  recordWaitersFailed,
  recordRequestOutcome,
  waiterFields,
};
