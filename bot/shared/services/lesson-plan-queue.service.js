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

// The lifecycle path of every request row this service writes (lesson-plan-lifecycle.service);
// with LP_LIFECYCLE_PATHS off for it, every insert and update below is exactly the old one.
const LIFECYCLE_SOURCE = Lifecycle.LIFECYCLE.SOURCES.NIETE_GROUNDED;

class LessonPlanQueueService {
  /**
   * Create a lesson plan request and queue it for processing
   * @param {Object} params - Request parameters
   * @param {string} params.userId - User's UUID
   * @param {string} params.phoneNumber - User's phone number
   * @param {string} params.topic - Extracted topic
   * @param {string} params.fullMessage - Full user message for context
   * @param {string} params.language - Language code (en, ur, ar, es)
   * @param {string} params.contentType - 'lesson_plan' or 'presentation'
   * @returns {Promise<string>} Request ID
   */
  static async createAndQueue(params) {
    const { userId, phoneNumber, topic, fullMessage, language = 'en', contentType = 'lesson_plan' } = params;

    try {
      // 1. Create request in database
      const { data: request, error } = await supabase
        .from('lesson_plan_requests')
        .insert({
          user_id: userId,
          phone_number: phoneNumber,
          topic,
          full_message: fullMessage,
          language,
          content_type: contentType,
          status: 'pending'
        })
        .select('id')
        .single();

      if (error) {
        throw new Error(`Failed to create lesson plan request: ${error.message}`);
      }

      const requestId = request.id;

      logToFile('Lesson plan request created', {
        requestId,
        userId,
        topic,
        contentType
      });

      // 2. Queue to SQS for async processing
      try {
        await SQSQueueService.queueCoachingJob(requestId, 'lesson_plan_generation', {
          requestId,
          userId,
          phoneNumber,
          topic,
          fullMessage,
          language,
          contentType
        });

        logToFile('Lesson plan job queued to SQS', { requestId });
      } catch (sqsError) {
        // If SQS fails, mark request for retry and log error
        await supabase
          .from('lesson_plan_requests')
          .update({
            status: 'pending',
            error_message: `SQS queue failed: ${sqsError.message}`
          })
          .eq('id', requestId);

        logToFile('Failed to queue lesson plan to SQS, marked for retry', {
          requestId,
          error: sqsError.message
        });
      }

      return requestId;

    } catch (error) {
      logToFile('Error in lesson plan queue service', {
        error: error.message,
        userId,
        topic
      });
      throw error;
    }
  }

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
    await Lifecycle.writeWithFallback((extra) => supabase
      .from('lesson_plan_requests')
      .update({
        status: 'completed',
        gamma_url: result.gammaUrl,
        pdf_url: result.pdfUrl,
        completed_at: new Date().toISOString(),
        ...extra,
      })
      .eq('id', requestId), Lifecycle.queueColumns(LIFECYCLE_SOURCE, 'completed', { generatedAt: result.generatedAt, sent: result.sent }),
    { source: LIFECYCLE_SOURCE, table: 'lesson_plan_requests', requestId });

    logToFile('Lesson plan request completed', { requestId });
    Lifecycle.queueEvent(LIFECYCLE_SOURCE, result.sent === false
      ? 'lesson_plan.delivery.failed'
      : (result.sent === true ? 'lesson_plan.delivery.sent' : 'lesson_plan.generation.completed'), { requestId });
  }

  /**
   * Mark request as failed
   * @param {string} requestId - Request UUID
   * @param {string} errorMessage - Error description
   * @param {string} [errorCode] - the lifecycle error code (NO_ASSET, RENDER_FAILED, …); default GENERATION_FAILED
   */
  static async markFailed(requestId, errorMessage, errorCode) {
    const { data: request } = await supabase
      .from('lesson_plan_requests')
      .select('retry_count')
      .eq('id', requestId)
      .single();

    const failed = Lifecycle.queueColumns(LIFECYCLE_SOURCE, 'failed', { errorCode });
    await Lifecycle.writeWithFallback((extra) => supabase
      .from('lesson_plan_requests')
      .update({
        status: 'failed',
        error_message: errorMessage,
        retry_count: (request?.retry_count || 0) + 1,
        last_retry_at: new Date().toISOString(),
        ...extra,
      })
      .eq('id', requestId), failed, { source: LIFECYCLE_SOURCE, table: 'lesson_plan_requests', requestId });

    logToFile('Lesson plan request failed', { requestId, errorMessage });
    Lifecycle.queueEvent(LIFECYCLE_SOURCE, 'lesson_plan.generation.failed', {
      requestId, errorCode: failed.error_code || errorCode || 'GENERATION_FAILED',
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

      // Queue to SQS
      await SQSQueueService.queueCoachingJob(request.id, 'lesson_plan_generation', {
        requestId: request.id,
        userId: request.user_id,
        phoneNumber: request.phone_number,
        topic: request.topic,
        fullMessage: request.full_message,
        language: request.language,
        contentType: request.content_type
      });

      logToFile('Lesson plan request requeued', { requestId: request.id });
    } catch (error) {
      logToFile('Error requeuing lesson plan request', {
        requestId: request.id,
        error: error.message
      });
    }
  }
}

module.exports = LessonPlanQueueService;
