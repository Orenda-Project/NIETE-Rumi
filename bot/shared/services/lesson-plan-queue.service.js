/**
 * Lesson Plan Queue Service
 * Handles async lesson plan generation via SQS queue
 *
 * Flow:
 * 1. Handler creates request in DB + queues to SQS
 * 2. Worker picks up job, generates with Gamma, sends result
 * 3. Survives server restarts - job persists in queue
 */

const crypto = require('crypto');
const { logToFile } = require('../utils/logger');
const { logEvent, getCurrentCorrelationId } = require('../utils/structured-logger');
const supabase = require('../config/supabase');
const SQSQueueService = require('./queue');

// ─── Lesson-plan lifecycle ──────────────────────────────────────────────────────────────────────
// Every lesson-plan ask leaves ONE row in lesson_plan_requests, on every path: which path served it,
// when each stage happened, how it ended, and the correlation id of its logs — so a plan seen in the
// portal can be traced to its ask, its outcome and its logs. This module is the only writer of those
// columns. Switched per path by LP_LIFECYCLE_PATHS ('all', or a comma list of SOURCES values);
// unset, nothing below touches the database. The lists are the CHECK constraints of migration
// V1.6.4; tests/lesson-plan-lifecycle/vocabulary.test.js pins code and database to one list.
const LIFECYCLE = Object.freeze({
  STATUSES: Object.freeze(['pending', 'processing', 'completed', 'failed', 'cancelled']),
  // One value per path, shared with the other Rumi deployment so the two databases speak one
  // vocabulary. The niete_* paths are this deployment's own.
  SOURCES: Object.freeze({
    GAMMA_STANDARD: 'gamma_standard',
    GAMMA_ENRICHED: 'gamma_enriched',
    UG_LP: 'ug_lp',
    PS_PREGEN: 'ps_pregen',
    V7_SEGMENT: 'v7_segment',
    V7_CHAPTER: 'v7_chapter',
    GAMMA_CHAPTER: 'gamma_chapter',
    PRE_GEN_CHAPTER: 'pre_gen_chapter',
    HOMEWORK_BUNDLE: 'homework_bundle',
    PIC_TO_LP_KIEAI: 'pic_to_lp_kieai',
    KENYA_BROWSE: 'kenya_browse',
    MULTIGRADE_LP: 'multigrade_lp',
    NIETE_GROUNDED: 'niete_grounded',
    NIETE_V8_SEGMENT: 'niete_v8_segment',
    NIETE_LP612: 'niete_lp612',
  }),
  CHANNELS: Object.freeze({ WHATSAPP: 'whatsapp', PORTAL: 'portal' }),
  ERROR_CODES: Object.freeze({
    GENERATION_FAILED: 'GENERATION_FAILED',
    RENDER_FAILED: 'RENDER_FAILED',
    DELIVERY_FAILED: 'DELIVERY_FAILED',
    QUEUE_FAILED: 'QUEUE_FAILED',
    NO_ASSET: 'NO_ASSET',
    NO_PHONE: 'NO_PHONE',
    NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  }),
});
const SOURCE_SET = new Set(Object.values(LIFECYCLE.SOURCES));
const CHANNEL_SET = new Set(Object.values(LIFECYCLE.CHANNELS));
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
// A missing column/table means the migration is not applied yet: said at error level at most once
// per ten minutes (never once per delivery), and retried every time, so applying it needs no restart.
const SCHEMA_MISSING_CODES = new Set(['PGRST204', 'PGRST205', '42703', '42P01']);
const LOUD_EVERY_MS = 10 * 60 * 1000;
let lastSchemaWarningAt = 0;

function isoOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function gradeOrNull(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

function textOrNull(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

class LessonPlanQueueService {
  // createAndQueue (freeform LP / presentation via Gamma) was removed with
  // bd-2540 (Option A partial Gamma strip). The only remaining teacher-facing
  // path is createAndQueueGrounded below, which renders a pre-authored AST row.

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
   * @returns {Promise<string>} Request ID
   */
  static async createAndQueueGrounded(params) {
    const {
      userId, phoneNumber,
      sourceLpUuid, topic, chapterTitle,
      language = 'en',
    } = params;

    if (!sourceLpUuid) throw new Error('createAndQueueGrounded: sourceLpUuid is required');

    // 1. Create the tracking row (same table as the freeform path)
    const { data: request, error } = await supabase
      .from('lesson_plan_requests')
      .insert({
        user_id: userId,
        phone_number: phoneNumber,
        topic,
        full_message: topic,
        language,
        content_type: 'lesson_plan',
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to create grounded LP request: ${error.message}`);

    const requestId = request.id;
    logToFile('Grounded LP request created', { requestId, userId, sourceLpUuid, topic, language });

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
      await supabase
        .from('lesson_plan_requests')
        .update({ status: 'pending', error_message: `SQS queue failed: ${sqsError.message}` })
        .eq('id', requestId);
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
   * @param {Object} result - { gammaUrl, pdfUrl }
   */
  static async markCompleted(requestId, result) {
    await supabase
      .from('lesson_plan_requests')
      .update({
        status: 'completed',
        gamma_url: result.gammaUrl,
        pdf_url: result.pdfUrl,
        completed_at: new Date().toISOString()
      })
      .eq('id', requestId);

    logToFile('Lesson plan request completed', { requestId });
  }

  /**
   * Mark request as failed
   * @param {string} requestId - Request UUID
   * @param {string} errorMessage - Error description
   */
  static async markFailed(requestId, errorMessage) {
    const { data: request } = await supabase
      .from('lesson_plan_requests')
      .select('retry_count')
      .eq('id', requestId)
      .single();

    await supabase
      .from('lesson_plan_requests')
      .update({
        status: 'failed',
        error_message: errorMessage,
        retry_count: (request?.retry_count || 0) + 1,
        last_retry_at: new Date().toISOString()
      })
      .eq('id', requestId);

    logToFile('Lesson plan request failed', { requestId, errorMessage });
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

  // ─── Lesson-plan lifecycle (see LIFECYCLE above) ──────────────────────────────────────────────

  /**
   * Is the lifecycle writer switched on for this path? LP_LIFECYCLE_PATHS is 'all' or a comma list
   * of SOURCES values. Read on every call, so a test (or a restart) sees the current value.
   * @param {string} source
   * @returns {boolean}
   */
  static lifecycleEnabled(source) {
    if (!SOURCE_SET.has(source)) return false;
    const raw = String(process.env.LP_LIFECYCLE_PATHS || '').trim();
    if (!raw) return false;
    const paths = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return paths.includes('all') || paths.includes(source);
  }

  /** A fresh id for an ask, for a caller that must name the ask before its row is written. */
  static newRequestId() {
    return crypto.randomUUID();
  }

  /**
   * Record a lesson-plan ask that has reached its end — delivered, failed or cancelled — on a path
   * that keeps no queue row of its own (grade 1-5 v8, grade 6-12, pic-to-LP). ONE upsert on the
   * ask's id: a retried call rewrites the same row, never adds a second.
   *
   * Soft-fail: never throws. Returns the ask's id, or null when the path is switched off, the input
   * is not recordable (no teacher, no phone, an unknown path/status/channel), or the write failed —
   * in every one of those cases the caller carries on delivering exactly as before.
   *
   * @param {Object} o
   * @param {string} [o.id]            the ask's id when the caller named it up front (newRequestId)
   * @param {string} o.userId
   * @param {string} o.phone
   * @param {string} o.topic
   * @param {string} [o.fullMessage]   defaults to the topic
   * @param {string} [o.language]      'en' | 'ur'
   * @param {string} [o.contentType]   defaults to 'lesson_plan'
   * @param {string} o.source          a LIFECYCLE.SOURCES value
   * @param {string} [o.channel]       a LIFECYCLE.CHANNELS value; defaults to whatsapp
   * @param {number|string} [o.grade]
   * @param {string} [o.subject]
   * @param {string} [o.artifactRef]   the delivered artefact's id in the path's own catalogue
   * @param {'completed'|'failed'|'cancelled'} o.status
   * @param {Date|string} [o.askedAt]  when the teacher asked (defaults to now)
   * @param {Date|string} [o.startedAt]
   * @param {Date|string} [o.generatedAt]
   * @param {Date|string} [o.deliveredAt] defaults to now when status is completed
   * @param {string} [o.errorCode]     a LIFECYCLE.ERROR_CODES value, for a failed ask
   * @param {string} [o.errorMessage]
   * @param {string} [o.correlationId] defaults to the request context's correlation id
   * @returns {Promise<string|null>}
   */
  static async recordOutcome(o = {}) {
    let row = null;
    try {
      row = LessonPlanQueueService._outcomeRow(o);
      if (!row) return null;
      const { error } = await supabase
        .from('lesson_plan_requests')
        .upsert(row, { onConflict: 'id' });
      if (error) {
        LessonPlanQueueService._lifecycleWriteFailed(error, row);
        return null;
      }
      logEvent(LessonPlanQueueService._outcomeEvent(row), LessonPlanQueueService._eventFields(row));
      return row.id;
    } catch (err) {
      LessonPlanQueueService._lifecycleWriteFailed({ code: 'THROWN', message: err && err.message }, row);
      return null;
    }
  }

  /** The row recordOutcome writes, or null (switched off / not recordable). Pure: no I/O. */
  static _outcomeRow(o) {
    if (!LessonPlanQueueService.lifecycleEnabled(o.source)) return null;
    const refuse = (reason) => {
      logEvent('lesson_plan.lifecycle.refused', { reason, source: o.source, status: o.status, channel: o.channel });
      return null;
    };
    if (!TERMINAL.has(o.status)) return refuse('status');
    const channel = o.channel || LIFECYCLE.CHANNELS.WHATSAPP;
    if (!CHANNEL_SET.has(channel)) return refuse('channel');
    if (!o.userId) return refuse('no_user');
    const phone = String(o.phone || '').replace(/\D/g, '').slice(0, 20);
    if (!phone) return refuse('no_phone');

    const topic = textOrNull(o.topic, 500) || 'lesson plan';
    const deliveredAt = o.status === 'completed' ? (isoOrNull(o.deliveredAt) || new Date().toISOString()) : null;
    const failed = o.status === 'failed';
    return {
      id: o.id || crypto.randomUUID(),
      user_id: o.userId,
      phone_number: phone,
      topic,
      full_message: textOrNull(o.fullMessage, 4000) || topic,
      language: textOrNull(o.language, 10) || 'en',
      content_type: textOrNull(o.contentType, 20) || 'lesson_plan',
      status: o.status,
      source: o.source,
      channel,
      region: textOrNull(process.env.REGION, 40),
      grade: gradeOrNull(o.grade),
      subject: textOrNull(o.subject, 100),
      artifact_ref: textOrNull(o.artifactRef, 300),
      created_at: isoOrNull(o.askedAt) || new Date().toISOString(),
      processing_started_at: isoOrNull(o.startedAt),
      generated_at: isoOrNull(o.generatedAt),
      delivered_at: deliveredAt,
      completed_at: deliveredAt,
      error_code: failed ? (textOrNull(o.errorCode, 40) || LIFECYCLE.ERROR_CODES.GENERATION_FAILED) : null,
      error_message: failed ? textOrNull(o.errorMessage, 1000) : null,
      correlation_id: textOrNull(o.correlationId || getCurrentCorrelationId(), 200),
    };
  }

  /** The canonical event for a recorded outcome — the same names the other deployment emits. */
  static _outcomeEvent(row) {
    if (row.status === 'completed') return 'lesson_plan.delivery.sent';
    if (row.status === 'cancelled') return 'lesson_plan.request.cancelled';
    return row.generated_at ? 'lesson_plan.delivery.failed' : 'lesson_plan.generation.failed';
  }

  /** The fields every lifecycle event carries: the ids an analyst joins on, never a phone. */
  static _eventFields(row) {
    const ms = (a, b) => (a && b ? Date.parse(b) - Date.parse(a) : undefined);
    return {
      requestId: row.id,
      userId: row.user_id,
      source: row.source,
      channel: row.channel,
      region: row.region,
      status: row.status,
      grade: row.grade,
      subject: row.subject,
      artifactRef: row.artifact_ref,
      errorCode: row.error_code || undefined,
      correlationId: row.correlation_id,
      askToDeliveredMs: ms(row.created_at, row.delivered_at),
      askToGeneratedMs: ms(row.created_at, row.generated_at),
    };
  }

  /** A lifecycle write failed: counted every time, said loudly at most once per ten minutes. */
  static _lifecycleWriteFailed(error, row) {
    const code = (error && error.code) || 'UNKNOWN';
    const message = (error && error.message) || '';
    logEvent('lesson_plan.lifecycle.write_failed', {
      code, message: message.slice(0, 300), requestId: row && row.id, source: row && row.source,
    });
    const schemaMissing = SCHEMA_MISSING_CODES.has(code) || /schema cache/i.test(message);
    if (!schemaMissing) {
      logToFile('Lesson-plan lifecycle write failed (the lesson was still delivered)', { code, message }, 'warn');
      return;
    }
    const now = Date.now();
    if (now - lastSchemaWarningAt < LOUD_EVERY_MS) return;
    lastSchemaWarningAt = now;
    logToFile('lesson_plan_requests is missing the lifecycle columns — apply migration V1.6.4. '
      + 'Lessons are still delivered; their lifecycle rows are not written until it is applied.',
    { code, message }, 'error');
  }

  /** Test seam: forget the once-per-ten-minutes state between tests. */
  static __resetLifecycleForTests() {
    lastSchemaWarningAt = 0;
  }
}

LessonPlanQueueService.LIFECYCLE = LIFECYCLE;

module.exports = LessonPlanQueueService;
