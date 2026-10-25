/**
 * Lesson Plan Queue Service
 * Handles async lesson plan generation via SQS queue
 *
 * Flow:
 * 1. Handler creates request in DB + queues to SQS
 * 2. Worker picks up job, generates with Gamma, sends result
 * 3. Survives server restarts - job persists in queue
 */

const { logToFile } = require('../utils/logger');
const supabase = require('../config/supabase');
const SQSQueueService = require('./queue');
const Lifecycle = require('./lesson-plan-lifecycle.service');
const { MAX_ATTEMPTS } = require('../config/lesson-plan-generation');

// The lifecycle path of every request row this service writes (lesson-plan-lifecycle.service);
// with LP_LIFECYCLE_PATHS off for it, every insert and update below is exactly the old one.
const LIFECYCLE_SOURCE = Lifecycle.LIFECYCLE.SOURCES.NIETE_GROUNDED;
// The free-form engine's track. It is NOT a source (F50): the request row keeps source='gamma_standard'
// and carries the track in textbook_metadata.fflp_track; the SQS payload's `track` is a copy the worker
// never routes on alone.
const FREEFORM_TRACK = 'freeform_v1';
const FREEFORM_SOURCE = 'gamma_standard';
const FFLP_TRACKS = new Set([FREEFORM_TRACK]);

/**
 * The free-form track of a lesson_plan_requests row: textbook_metadata.fflp_track when it is a known
 * track, else null. Never derived from `source` (F50) — a row with source='freeform_v1' and no key is
 * not a free-form row.
 */
function fflpTrackOf(row) {
  const t = row && row.textbook_metadata && row.textbook_metadata.fflp_track;
  return FFLP_TRACKS.has(t) ? t : null;
}

/**
 * Whether this request row is one the grounded path recorded — the only rows its stage columns and
 * events belong on. markCompleted and markFailed run for every row the generation worker finishes; a
 * deployment that still generates freeform Gamma plans sends those through here too, and a row asked
 * before the path was switched on has no source either. Those are updated exactly as before.
 * Switched off: false, with no read. A read that fails stamps nothing and is reported like a failed lifecycle
 * write: counted every time, said at error level at most once per ten minutes per kind (a read failing on every
 * finished request — the switch set before V1.6.4 — must not bury the one line that says what to do).
 */
async function isOwnRow(requestId) {
  if (!Lifecycle.enabled(LIFECYCLE_SOURCE)) return false;
  try {
    const { data, error } = await supabase
      .from('lesson_plan_requests')
      .select('source')
      .eq('id', requestId)
      .maybeSingle();
    if (error) throw error;
    return !!(data && data.source === LIFECYCLE_SOURCE);
  } catch (err) {
    Lifecycle.writeFailed(err, { id: requestId, source: LIFECYCLE_SOURCE }, { table: 'lesson_plan_requests' });
    return false;
  }
}

class LessonPlanQueueService {
  // createAndQueue (freeform LP / presentation via Gamma) was removed with
  // the partial Gamma strip. The teacher-facing paths are
  // createAndQueueGrounded (a pre-authored AST row) and createAndQueueFreeform
  // (the free-form engine, behind app_settings.freeform_lp; off by default).

  /**
   * Create a GROUNDED lesson plan request (curriculum_lp_ast row) and queue
   * it for async Gamma rendering. Same DB row shape as createAndQueue, but the
   * SQS payload carries `sourceLpUuid` — the worker uses that to dispatch to
   * the grounded render path (fetch AST → Gamma with curriculumLpAst → upload
   * to R2 → setRenderedPdfKey → send doc).
   *
   * Deliberately no schema migration: `lesson_plan_requests` stores just
   * status/retry tracking; sourceLpUuid rides in the SQS message body.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.phoneNumber
   * @param {string} params.sourceLpUuid — curriculum_lp_ast.source_lp_uuid
   * @param {string} params.topic
   * @param {string} [params.chapterTitle]
   * @param {'en'|'ur'} [params.language]
   * @param {number} [params.grade]     — for the lifecycle row only
   * @param {string} [params.subject]   — for the lifecycle row only
   * @param {'whatsapp'|'portal'} [params.channel] — where she asked; defaults to whatsapp
   * @returns {Promise<string>} Request ID
   */
  static async createAndQueueGrounded(params) {
    const {
      userId, phoneNumber,
      sourceLpUuid, topic, chapterTitle,
      language = 'en',
      grade, subject, channel,
    } = params;

    if (!sourceLpUuid) throw new Error('createAndQueueGrounded: sourceLpUuid is required');

    // 1. Create the tracking row (same table as the freeform path). The lifecycle columns ride along
    // when switched on; a database that refuses them gets the old row instead (writeWithFallback).
    const { data: request, error } = await Lifecycle.writeWithFallback((extra) => supabase
      .from('lesson_plan_requests')
      .insert({
        user_id: userId,
        phone_number: phoneNumber,
        topic,
        full_message: topic,
        language,
        content_type: 'lesson_plan',
        status: 'pending',
        ...extra,
      })
      .select('id')
      .single(), Lifecycle.askColumns({
      source: LIFECYCLE_SOURCE, channel, grade, subject, artifactRef: sourceLpUuid,
    }), { source: LIFECYCLE_SOURCE, table: 'lesson_plan_requests' });
    if (error) throw new Error(`Failed to create grounded LP request: ${error.message}`);

    const requestId = request.id;
    logToFile('Grounded LP request created', { requestId, userId, sourceLpUuid, topic, language });
    Lifecycle.queueEvent(LIFECYCLE_SOURCE, 'lesson_plan.request.created', {
      requestId, userId, artifactRef: sourceLpUuid, grade, subject,
    });

    // 2. Queue to SQS. Payload carries sourceLpUuid — worker routes on that.
    try {
      await SQSQueueService.queueCoachingJob(requestId, 'lesson_plan_generation', {
        requestId,
        userId,
        phoneNumber,
        topic,
        fullMessage: topic,
        language,
        contentType: 'lesson_plan',
        sourceLpUuid,
        chapterTitle: chapterTitle || null,
      });
      logToFile('Grounded LP job queued to SQS', { requestId, sourceLpUuid });
    } catch (sqsError) {
      await Lifecycle.writeWithFallback((extra) => supabase
        .from('lesson_plan_requests')
        .update({
          status: 'pending',
          error_message: `SQS queue failed: ${sqsError.message}`,
          ...extra,
        })
        .eq('id', requestId), Lifecycle.queueColumns(LIFECYCLE_SOURCE, 'queue_failed'), { source: LIFECYCLE_SOURCE, table: 'lesson_plan_requests', requestId });
      Lifecycle.queueEvent(LIFECYCLE_SOURCE, 'lesson_plan.queue.failed', { requestId, errorCode: 'QUEUE_FAILED' });
      logToFile('Failed to queue grounded LP to SQS, marked for retry', { requestId, error: sqsError.message });
    }

    return requestId;
  }

  /**
   * Create a FREE-FORM lesson plan request and queue it for the free-form engine.
   *
   * Reached only from the typed-topic seam (text-message.handler handleLessonPlanRequest) when the
   * topic is in neither catalogue AND app_settings.freeform_lp sends this teacher there; with the
   * switch off nothing calls it. The row carries source='gamma_standard' and the track in
   * textbook_metadata.fflp_track='freeform_v1' (F50; the column is added by V1.7.8). The generation
   * worker routes on the ROW's key; the SQS payload's `track` and `entry` (the door the teacher came
   * through) are copies for the engine and the logs. No sourceLpUuid, so the grounded branch never sees it.
   *
   * Throws when the row cannot be written, and when the job cannot be queued after the row exists:
   * nothing reads pending free-form rows back, so the row is marked failed at once and the caller
   * gives today's catalogue answer.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.phoneNumber
   * @param {string} params.topic          — what the teacher typed (trimmed to the column's 500)
   * @param {string} [params.fullMessage]  — the whole message; defaults to topic
   * @param {'en'|'ur'} [params.language]
   * @param {string} [params.entry]        — the door, for the engine and the logs
   * @returns {Promise<string>} Request ID
   */
  static async createAndQueueFreeform(params) {
    const {
      userId, phoneNumber, topic, fullMessage, language = 'en', entry = 'unknown',
    } = params || {};
    const topicCol = [...String(topic || '')].slice(0, 500).join('');

    const { data: request, error } = await supabase
      .from('lesson_plan_requests')
      .insert({
        user_id: userId,
        phone_number: phoneNumber,
        topic: topicCol,
        full_message: fullMessage || topic,
        language,
        content_type: 'lesson_plan',
        status: 'pending',
        source: FREEFORM_SOURCE,
        textbook_metadata: { fflp_track: FREEFORM_TRACK },
      })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to create free-form LP request: ${error.message}`);

    const requestId = request.id;
    logToFile('Free-form LP request created', { requestId, userId, entry, language });

    try {
      await SQSQueueService.queueCoachingJob(requestId, 'lesson_plan_generation', {
        requestId,
        userId,
        phoneNumber,
        topic: topicCol,
        fullMessage: fullMessage || topic,
        language,
        contentType: 'lesson_plan',
        track: FREEFORM_TRACK,
        entry,
      });
      logToFile('Free-form LP job queued to SQS', { requestId });
    } catch (sqsError) {
      try {
        await supabase
          .from('lesson_plan_requests')
          .update({ status: 'failed', error_message: `SQS queue failed: ${sqsError.message}` })
          .eq('id', requestId);
      } catch (markErr) {
        logToFile('Failed to mark the unqueued free-form LP row failed', { requestId, error: markErr.message }, 'warn');
      }
      logToFile('Failed to queue free-form LP to SQS, row marked failed', { requestId, error: sqsError.message }, 'warn');
      throw new Error(`Failed to queue free-form LP request: ${sqsError.message}`);
    }

    return requestId;
  }

  /**
   * Update request status to processing
   * @param {string} requestId - Request UUID
   */
  static async markProcessing(requestId) {
    await supabase
      .from('lesson_plan_requests')
      .update({
        status: 'processing',
        processing_started_at: new Date().toISOString()
      })
      .eq('id', requestId);

    logToFile('Lesson plan request marked processing', { requestId });
  }

  /**
   * Mark request as completed with results
   * @param {string} requestId - Request UUID
   * @param {Object} result - { gammaUrl, pdfUrl, generatedAt?, sent? } — generatedAt (when the PDF
   *   existed) and sent (did WhatsApp accept it) feed the lifecycle columns only
   */
  static async markCompleted(requestId, result) {
    const own = await isOwnRow(requestId);
    await Lifecycle.writeWithFallback((extra) => supabase
      .from('lesson_plan_requests')
      .update({
        status: 'completed',
        gamma_url: result.gammaUrl,
        pdf_url: result.pdfUrl,
        completed_at: new Date().toISOString(),
        ...extra,
      })
      .eq('id', requestId), own ? Lifecycle.queueColumns(LIFECYCLE_SOURCE, 'completed', { generatedAt: result.generatedAt, sent: result.sent }) : {},
    { source: LIFECYCLE_SOURCE, table: 'lesson_plan_requests', requestId });

    logToFile('Lesson plan request completed', { requestId });
    if (own) Lifecycle.queueEvent(LIFECYCLE_SOURCE, result.sent === false
      ? 'lesson_plan.delivery.failed'
      : (result.sent === true ? 'lesson_plan.delivery.sent' : 'lesson_plan.generation.completed'), { requestId });
  }

  /**
   * Mark request as failed
   * @param {string} requestId - Request UUID
   * @param {string} errorMessage - Error description
   * @param {string} [errorCode] - the lifecycle error code (NO_ASSET, RENDER_FAILED, …); default GENERATION_FAILED
   */
  static async markFailed(requestId, errorMessage, errorCode, { final } = {}) {
    const { data: request } = await supabase
      .from('lesson_plan_requests')
      .select('retry_count')
      .eq('id', requestId)
      .single();
    // This failure's attempt number, and whether the queue will try again. The caller knows when a
    // failure is the last one (a dropped job is final on its first attempt); otherwise the limit says.
    const attempt = (request?.retry_count || 0) + 1;
    const isFinal = typeof final === 'boolean' ? final : attempt >= MAX_ATTEMPTS;

    const own = await isOwnRow(requestId);
    const failed = own ? Lifecycle.queueColumns(LIFECYCLE_SOURCE, 'failed', { errorCode }) : {};
    await Lifecycle.writeWithFallback((extra) => supabase
      .from('lesson_plan_requests')
      .update({
        status: 'failed',
        error_message: errorMessage,
        retry_count: attempt,
        last_retry_at: new Date().toISOString(),
        ...extra,
      })
      .eq('id', requestId), failed, { source: LIFECYCLE_SOURCE, table: 'lesson_plan_requests', requestId });

    logToFile('Lesson plan request failed', { requestId, errorMessage });
    if (own) Lifecycle.queueEvent(LIFECYCLE_SOURCE, 'lesson_plan.generation.failed', {
      requestId, errorCode: failed.error_code || errorCode || 'GENERATION_FAILED', attempt, final: isFinal,
    });
  }

  /**
   * Get request by ID
   * @param {string} requestId - Request UUID
   * @returns {Promise<Object>} Request data
   */
  static async getRequest(requestId) {
    const { data, error } = await supabase
      .from('lesson_plan_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (error) {
      throw new Error(`Failed to get lesson plan request: ${error.message}`);
    }

    return data;
  }

  /**
   * Get stale processing requests (for recovery on startup)
   * @param {number} staleMinutes - Minutes after which a processing request is considered stale
   * @returns {Promise<Array>} Stale requests
   */
  static async getStaleRequests(staleMinutes = 10) {
    const staleTime = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('lesson_plan_requests')
      .select('*')
      .eq('status', 'processing')
      .lt('processing_started_at', staleTime);

    if (error) {
      logToFile('Error fetching stale requests', { error: error.message });
      return [];
    }

    return data || [];
  }

  /**
   * Get pending requests that weren't queued (for recovery)
   * @returns {Promise<Array>} Pending requests
   */
  static async getPendingRequests() {
    const { data, error } = await supabase
      .from('lesson_plan_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      logToFile('Error fetching pending requests', { error: error.message });
      return [];
    }

    return data || [];
  }

  /**
   * Requeue a request for retry
   * @param {Object} request - Request data from DB
   */
  static async requeueRequest(request) {
    try {
      // Reset status to pending
      await supabase
        .from('lesson_plan_requests')
        .update({
          status: 'pending',
          processing_started_at: null
        })
        .eq('id', request.id);

      // Queue to SQS. A row the grounded path recorded names its curriculum row (artifact_ref): carry it
      // as sourceLpUuid, the field the worker routes on — without it the job is taken for a freeform one.
      const grounded = request.source === LIFECYCLE_SOURCE && request.artifact_ref;
      await SQSQueueService.queueCoachingJob(request.id, 'lesson_plan_generation', {
        requestId: request.id,
        userId: request.user_id,
        phoneNumber: request.phone_number,
        topic: request.topic,
        fullMessage: request.full_message,
        language: request.language,
        contentType: request.content_type,
        ...(grounded ? { sourceLpUuid: request.artifact_ref } : {}),
        // A free-form row keeps its track (read from textbook_metadata.fflp_track, never from source), or the
        // worker would take it for a stale job and drop it.
        ...(fflpTrackOf(request) ? { track: fflpTrackOf(request) } : {}),
      });

      logToFile('Lesson plan request requeued', { requestId: request.id, grounded: Boolean(grounded) });
    } catch (error) {
      logToFile('Error requeuing lesson plan request', {
        requestId: request.id,
        error: error.message
      });
    }
  }
}

LessonPlanQueueService.fflpTrackOf = fflpTrackOf;

module.exports = LessonPlanQueueService;
